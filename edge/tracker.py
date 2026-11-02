"""
edge/tracker.py - ByteTrack tuned for dense poultry pens.

``bytetrack_poultry.yaml`` still configures every threshold -- this module only fixes the one
structural blind spot that no YAML value can express:

    In ByteTrack every detection and every Kalman-predicted "ghost" box is a *rectangle*. In a
    crowded broiler pen two birds sitting side by side produce heavily overlapping rectangles,
    so ``iou_distance`` on the torso is close to a coin flip and the Hungarian assignment hands a
    lost identity to the neighbouring bird.

``AgriByteTracker.multi_predict`` therefore stores, for each active track, the IoU of the
prediction against the apex of the torso (the lower ~40% of the box, where the legs and the band
are) together with the predicted box height. ``get_dists`` then adds a motion-severity penalty:
a track whose *apex* prediction still lands inside a detection (``apex_iou >= apex_agree`` and
the size is stable) is the true owner of that detection and is favoured, while a track whose apex
has diverged keeps the plain torso IoU.

The tracker is registered through ``ultralytics.trackers.track.TRACKER_MAP`` -- there is no
subclassing of Ultralytics code, so a future ultralytics upgrade only breaks this file if
``multi_predict`` / ``get_dists`` signatures change (they are stable in 8.x).
"""

from typing import List

import numpy as np

from ultralytics.trackers.byte_tracker import BYTETracker
from ultralytics.trackers.utils import matching

from .reid import box_iou


def apex_box(box: List[float], height_ratio: float = 0.60) -> List[float]:
    """Lower part of a [x1, y1, x2, y2] box (feet / leg-band region)."""
    x1, y1, x2, y2 = box
    return [x1, y1 + (y2 - y1) * height_ratio, x2, y2]


class AgriByteTracker(BYTETracker):
    """ByteTrack + apex-anchored association. Configured entirely by the YAML."""

    apex_height_ratio = 0.60
    apex_agree = 0.35

    def __init__(self, args):
        super().__init__(args)
        self._apex_by_track = {}
        self._size_by_track = {}

    def multi_predict(self, tracks):
        super().multi_predict(tracks)
        for track in tracks:
            try:
                x1, y1, x2, y2 = track.xyxy
                self._size_by_track[track.track_id] = max(1.0, float(y2) - float(y1))
                self._apex_by_track[track.track_id] = apex_box(
                    [float(x1), float(y1), float(x2), float(y2)], self.apex_height_ratio
                )
            except Exception:
                continue

    def get_dists(self, tracks, detections):
        dists = matching.iou_distance(tracks, detections)

        if tracks and detections:
            for ti, track in enumerate(tracks):
                track_h = self._size_by_track.get(track.track_id)
                if not track_h:
                    continue
                apex_iou = np.zeros(len(detections), dtype=np.float32)
                size_ok = np.zeros(len(detections), dtype=bool)
                predicted_apex = self._apex_by_track.get(track.track_id)
                for di, det in enumerate(detections):
                    dx1, dy1, dx2, dy2 = det.xyxy
                    det_h = max(1.0, float(dy2) - float(dy1))
                    size_ok[di] = abs(det_h - track_h) / track_h <= 0.35
                    if predicted_apex is not None:
                        apex_iou[di] = box_iou(
                            predicted_apex,
                            apex_box([float(dx1), float(dy1), float(dx2), float(dy2)]),
                        )
                agreed = (apex_iou >= self.apex_agree) & size_ok
                if agreed.any():
                    penalty = np.where(agreed, 0.20, 0.0)
                    dists[ti] = np.clip(dists[ti] - penalty, 0.0, 1.0)

        if self.args.fuse_score:
            dists = matching.fuse_score(dists, detections)
        return dists

    def reset(self):
        super().reset()
        self._apex_by_track.clear()
        self._size_by_track.clear()


def register_tracker() -> None:
    """Expose ``tracker_type: agribytetrack`` to Ultralytics' tracker registry."""
    try:
        from ultralytics.trackers.track import TRACKER_MAP

        TRACKER_MAP["agribytetrack"] = AgriByteTracker
    except Exception as exc:  # pragma: no cover - ultralytics internals moved
        print(f"[TRACKER] AgriByteTracker not registered ({exc}); falling back to stock ByteTrack")


__all__ = ["AgriByteTracker", "apex_box", "register_tracker"]
