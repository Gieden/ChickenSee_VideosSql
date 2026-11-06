"""
analytics/tracker.py
Ultralytics YOLO26 Nano + ByteTrack Multi-Object Tracking Engine for Dell OptiPlex.
Executes model.track(..., tracker="bytetrack.yaml", persist=True) for temporal bird tracking.
"""

import math
import os
import cv2
import numpy as np
from collections import Counter, deque
from pathlib import Path
from typing import List, Dict, Tuple, Optional, Any
from dataclasses import dataclass
from ultralytics import YOLO

from .config import BASE_DIR, CONFIG, PROJECT_ROOT
from legband import (
    BAND_CLASS_TO_HEN,
    detect_leg_band_color,
    suppress_overlapping_equipment,
)


def _register_custom_tracker() -> bool:
    """Make ``agribytetrack`` known to Ultralytics. Returns True when it is available."""
    try:
        from ultralytics.trackers.track import TRACKER_MAP

        if "agribytetrack" in TRACKER_MAP:
            return True
        from edge.tracker import register_tracker

        register_tracker()
        return "agribytetrack" in TRACKER_MAP
    except Exception:
        return False


def resolve_tracker_config(tracker_path: str) -> str:
    """
    Return a tracker YAML name Ultralytics can actually load.

    ``bytetrack_poultry.yaml`` declares ``tracker_type: agribytetrack``, which is registered by
    ``edge/tracker.py``. If that registration is unavailable (partial install, ultralytics
    internals moved), running the YAML as-is aborts every video with "Only ['botsort',
    'bytetrack', ...] are supported". In that case the same file is written to a temp copy with
    ``tracker_type: bytetrack`` -- identical thresholds, stock association -- and a warning is
    logged once.
    """
    try:
        from ultralytics.utils import YAML

        config = YAML.load(tracker_path)
    except Exception:
        return tracker_path
    if str(config.get("tracker_type", "bytetrack")).lower() != "agribytetrack":
        return tracker_path
    if _register_custom_tracker():
        return tracker_path

    import tempfile

    fallback = dict(config)
    fallback["tracker_type"] = "bytetrack"
    path = Path(tempfile.gettempdir()) / "chickensee_bytetrack_fallback.yaml"
    path.write_text(
        "\n".join(f"{key}: {value}" for key, value in fallback.items()) + "\n",
        encoding="utf-8",
    )
    print(
        f"[TRACKER] 'agribytetrack' is not registered; using stock ByteTrack with the same "
        f"thresholds ({path})"
    )
    return str(path)


LABEL_COLORS_BGR = {
    "Rooster": (0, 0, 255),
    "Chicken": (0, 165, 255),
    "Hen1 (Green)": (0, 255, 0),
    "Hen2 (White)": (255, 255, 255),
    "Hen3 (Blue)": (255, 0, 0),
    "Hen4 (Yellow)": (0, 255, 255),
    "Hen5 (Pink)": (180, 105, 255),
    "Feeder": (128, 128, 128),
    "Drinker": (128, 128, 128),
    "Default": (128, 128, 128),
}


@dataclass
class TrackedDetection:
    box: List[int]                     # [x1, y1, x2, y2]
    centroid: Tuple[int, int]          # (cx, cy)
    confidence: float
    class_id: int
    class_name: str
    track_id: Optional[int]            # ByteTrack persistent ID
    bird_label: str                    # Hen1-5, Rooster, or Chicken


@dataclass
class TrackerFrameOutput:
    frame_idx: int
    timestamp_s: float
    birds: List[TrackedDetection]
    feeders: List[TrackedDetection]
    drinkers: List[TrackedDetection]


class ZampenYOLOTracker:
    """
    YOLO26 Nano + ByteTrack edge inference wrapper.
    Optimized for Dell OptiPlex multi-core CPU / Intel OpenVINO / CUDA execution.
    """

    # Requires 10 more observations than current class before switching —
    # prevents a handful of mislabelled frames from flipping Rooster→Hen.
    CLASS_SWITCH_MARGIN = 10
    # Keep per-track class history alive for 600 frames (~20 s at 30 fps).
    CLASS_HISTORY_TTL_FRAMES = 600
    MIN_DETECTION_CONFIDENCE = 0.70  # Set to 70% for strict chicken detection
    MIN_LEG_BAND_CONFIDENCE = 0.035  # Sensitive threshold for small leg-band boxes
    REIDENTIFICATION_MAX_GAP_FRAMES = 30
    # Radius = max(MIN_DISTANCE_PX, frame_diagonal * RATIO). On a 2880x1620 flyover the old
    # 0.02 ratio gave a ~650 px gate, i.e. "anywhere on the frame": every occluded detection
    # was allowed to steal any nearby bird's ID. These values keep ~6% of the diagonal for the
    # first 2 s (~7.5 px/frame of ground speed) and halve it after that, plus a body-size cap.
    REIDENTIFICATION_DISTANCE_RATIO = 0.06
    REIDENTIFICATION_MIN_DISTANCE_PX = 12.5
    REIDENTIFICATION_STALE_RATIO = 0.03
    REIDENTIFICATION_STALE_AFTER_FRAMES = 30
    REIDENTIFICATION_SIZE_TOLERANCE = 0.60
    # A colour identity may not be reused by another track within this many frames
    # (prevents two adjacent birds from swapping Hen1/Hen3 when their boxes overlap).
    LABEL_REUSE_COOLDOWN_FRAMES = 90

    def __init__(self, model_weights: Optional[str] = None, tracker_yaml: Optional[str] = None):
        self.weights_path = self._resolve_weights(model_weights or CONFIG.model_name)
        self.tracker_yaml = resolve_tracker_config(tracker_yaml or CONFIG.tracker_config)
        self.device = CONFIG.device
        self.conf = CONFIG.conf_threshold
        self.iou = CONFIG.iou_threshold
        self.imgsz = CONFIG.imgsz
        # min() of the two class-specific gates: leg-band boxes are tiny/low-contrast and must
        # survive NMS, while the 70% gate is re-applied per class in the parsing pass below.
        self.track_conf = min(self.conf, self.MIN_LEG_BAND_CONFIDENCE)

        print(f"[TRACKER] Initializing YOLO26 Nano from: {self.weights_path}")
        print(f"[TRACKER] Using ByteTrack config: {self.tracker_yaml}")

        # Last line of defence: if a tracker YAML ever becomes unloadable, run detection-only
        # instead of failing every video in the queue.
        self._tracking_enabled = True
        self.model = YOLO(self.weights_path)

        # Standard poultry class mapping
        self.class_map = {
            0: "Chicken",
            1: "Drinker",
            2: "Feeder",
            3: "Leg_Band_Green",
            4: "Leg_Band_Pink",
            5: "Leg_Band_Violet",
            6: "Leg_Band_White",
            7: "Leg_Band_Yellow",
            8: "Rooster",
        }

        # Persistent ID Re-ID cache: track_id -> confirmed label
        self.track_label_cache: Dict[int, str] = {}
        self.track_label_votes: Dict[int, deque] = {}
        self.track_label_last_seen: Dict[int, int] = {}
        self.track_tag_confirmed: set[int] = set()
        self.track_class_history: Dict[int, Dict[int, Tuple[int, float]]] = {}
        self.track_resolved_classes: Dict[int, int] = {}
        self.track_class_last_seen: Dict[int, int] = {}
        self.processed_frame_count = 0
        self.short_id_map: Dict[int, int] = {}
        self._next_short_id = 1
        # Fixed-population ID pool: when flock_size > 0 display IDs are drawn
        # from {1..flock_size} and reserved (not retired) when a bird leaves the
        # frame, so IDs never exceed flock_size and a returning bird always gets
        # its original slot back.
        self.flock_size: int = CONFIG.flock_size
        self.short_track_positions: Dict[int, Tuple[Tuple[float, float], int]] = {}
        self.short_track_sizes: Dict[int, float] = {}
        self.track_last_label: Dict[int, str] = {}
        self.label_owner: Dict[str, Tuple[int, int]] = {}   # label -> (display id, frame)

    def _resolve_short_id(self, raw_track_id: Optional[int]) -> Optional[int]:
        if raw_track_id is None:
            return None
        if raw_track_id not in self.short_id_map:
            self.short_id_map[raw_track_id] = self._next_short_id
            self._next_short_id += 1
        return self.short_id_map[raw_track_id]

    def _next_pool_id(self, assigned_ids: set) -> int:
        """Return the smallest available display ID respecting the flock pool."""
        flock_size = getattr(self, "flock_size", 0)
        if flock_size > 0:
            used = set(self.short_id_map.values()) | assigned_ids
            for candidate in range(1, flock_size + 1):
                if candidate not in used:
                    return candidate
            # Pool exhausted (more tracks than known flock size) — fall through to monotonic
        new_id = self._next_short_id
        self._next_short_id += 1
        return new_id

    def reset_video_state(self) -> None:
        self.track_label_cache.clear()
        self.track_label_votes.clear()
        self.track_label_last_seen.clear()
        getattr(self, "track_tag_confirmed", set()).clear()
        self.track_class_history.clear()
        self.track_resolved_classes.clear()
        self.track_class_last_seen.clear()
        self.processed_frame_count = 0
        self.short_id_map.clear()
        self._next_short_id = 1
        # Re-read flock_size from config in case the env var was changed between videos
        if not hasattr(self, "flock_size"):
            self.flock_size = CONFIG.flock_size
        self.short_track_positions.clear()
        self.short_track_sizes.clear()
        self.track_last_label.clear()
        self.label_owner.clear()

        predictor = getattr(self.model, "predictor", None)
        for tracker in getattr(predictor, "trackers", []):
            tracker.reset()

    def _assign_display_ids(
        self,
        birds: List[TrackedDetection],
        frame_shape: Tuple[int, ...],
    ) -> None:
        if not hasattr(self, "short_track_sizes"):
            self.short_track_sizes: Dict[int, float] = {}
        if not hasattr(self, "short_track_positions"):
            self.short_track_positions: Dict[int, Tuple[Tuple[float, float], int]] = {}
        if not hasattr(self, "short_id_map"):
            self.short_id_map: Dict[int, int] = {}
        if not hasattr(self, "_next_short_id"):
            self._next_short_id = 1
        frame_diagonal = math.hypot(frame_shape[0], frame_shape[1])
        max_distance = max(
            self.REIDENTIFICATION_MIN_DISTANCE_PX,
            frame_diagonal * self.REIDENTIFICATION_DISTANCE_RATIO,
        )
        stale_distance = max(
            self.REIDENTIFICATION_MIN_DISTANCE_PX,
            frame_diagonal * self.REIDENTIFICATION_STALE_RATIO,
        )
        current_frame = self.processed_frame_count
        pending = []
        assigned_ids = set()

        for bird in birds:
            raw_track_id = bird.track_id
            if raw_track_id is None:
                continue

            display_id = self.short_id_map.get(raw_track_id)
            if display_id is not None:
                position = self.short_track_positions.get(display_id)
                if (
                    position is not None
                    and current_frame - position[1] > self.REIDENTIFICATION_MAX_GAP_FRAMES
                ):
                    self.short_id_map.pop(raw_track_id, None)
                    display_id = None

            if display_id is None:
                pending.append((bird, raw_track_id))
            else:
                bird.track_id = display_id
                assigned_ids.add(display_id)

        candidate_pairs = []
        for bird, raw_track_id in pending:
            x1, y1, x2, y2 = bird.box
            center = ((x1 + x2) / 2, (y1 + y2) / 2)
            bird_size = math.sqrt(max(1, x2 - x1) * max(1, y2 - y1))
            for display_id, (last_center, last_seen) in list(self.short_track_positions.items()):
                gap = current_frame - last_seen
                if display_id in assigned_ids or not 1 <= gap <= self.REIDENTIFICATION_MAX_GAP_FRAMES:
                    continue
                # The longer the bird has been gone the less it can have moved, and a
                # bird cannot double in apparent size while it is out of sight.
                allowed = max_distance if gap < self.REIDENTIFICATION_STALE_AFTER_FRAMES else stale_distance
                distance = math.dist(center, last_center)
                if distance > allowed:
                    continue
                last_size = self.short_track_sizes.get(display_id)
                if last_size and abs(bird_size - last_size) / max(last_size, 1.0) > self.REIDENTIFICATION_SIZE_TOLERANCE:
                    continue
                candidate_pairs.append(
                    (distance, display_id, raw_track_id, bird, center)
                )

        matched_raw_ids = set()
        for _, display_id, raw_track_id, bird, _ in sorted(
            candidate_pairs, key=lambda pair: pair[:3]
        ):
            if display_id in assigned_ids or raw_track_id in matched_raw_ids:
                continue
            for previous_raw_id, previous_display_id in list(self.short_id_map.items()):
                if previous_display_id == display_id:
                    self.short_id_map.pop(previous_raw_id)
            self.short_id_map[raw_track_id] = display_id
            bird.track_id = display_id
            assigned_ids.add(display_id)
            matched_raw_ids.add(raw_track_id)

        for bird, raw_track_id in pending:
            if raw_track_id in matched_raw_ids:
                continue
            display_id = self.short_id_map.get(raw_track_id)
            if display_id is not None and display_id in assigned_ids:
                # Ultra duplicate raw id in one frame (or an id already donated by re-ID)
                display_id = None
            if display_id is None:
                display_id = self._next_pool_id(assigned_ids)
            self.short_id_map[raw_track_id] = display_id
            bird.track_id = display_id
            assigned_ids.add(display_id)

        for bird in birds:
            if bird.track_id is None:
                continue
            x1, y1, x2, y2 = bird.box
            self.short_track_positions[bird.track_id] = (
                ((x1 + x2) / 2, (y1 + y2) / 2),
                current_frame,
            )
            self.short_track_sizes[bird.track_id] = math.sqrt(
                max(1, x2 - x1) * max(1, y2 - y1)
            )

        # Forget positions whose display id was pruned, otherwise the size gate above keeps
        # comparing against birds that no longer exist (slow leak on 12-hour shifts).
        if len(self.short_track_positions) > 512:
            live_ids = {
                self.short_id_map[raw]
                for raw in self.short_id_map
                if current_frame - self.short_track_positions.get(self.short_id_map[raw], ((0, 0), current_frame))[1]
                <= self.REIDENTIFICATION_MAX_GAP_FRAMES
            }
            for display_id in list(self.short_track_positions):
                if display_id not in live_ids:
                    self.short_track_positions.pop(display_id, None)
                    self.short_track_sizes.pop(display_id, None)

    def _record_track_label(self, track_id: int, label: str) -> None:
        last_seen = self.track_label_last_seen.get(track_id)
        # 15-frame rolling window; clear only after 90 consecutive unseen frames
        # so a bird that briefly ducks behind the feeder doesn't lose its identity.
        votes = self.track_label_votes.setdefault(track_id, deque(maxlen=15))
        if last_seen is not None and self.processed_frame_count - last_seen > 90:
            votes.clear()
        votes.append(label)
        self.track_label_last_seen[track_id] = self.processed_frame_count
        # Require 8 consistent observations before committing a label so random
        # per-frame HSV noise cannot flip a hen's colour identity.
        vote_counts = Counter(votes)
        resolved_label, count = vote_counts.most_common(1)[0]
        if count >= 8:
            # Once a label is locked, only replace it if the new winner has ≥8
            # votes AND beats the current cache by a large absolute margin.
            current = self.track_label_cache.get(track_id)
            if current is None or current == resolved_label:
                self.track_label_cache[track_id] = resolved_label
            else:
                current_count = vote_counts.get(current, 0)
                if count >= current_count + 5:
                    self.track_label_cache[track_id] = resolved_label

    def _resolve_weights(self, desired_name: str) -> str:
        """Finds or resolves the weights path, checking local files and fallbacks."""
        # 1. Exact path or in current/root directory
        candidates = [
            Path(desired_name),
            PROJECT_ROOT / desired_name,
            BASE_DIR / desired_name,
            Path(CONFIG.custom_weights_path),
            PROJECT_ROOT / "custom_poultry.pt",
            PROJECT_ROOT / "yolo26n.pt",
            PROJECT_ROOT / "yolo11n.pt",
            PROJECT_ROOT / "yolov8n.pt",
        ]

        for cand in candidates:
            if cand and cand.is_file():
                return str(cand.resolve())

        # If desired is a standard ultralytics weight name, YOLO will auto-download
        return desired_name

    def _resolve_track_class(
        self, cls_id: int, confidence: float, track_id: Optional[int]
    ) -> Tuple[int, str, float]:
        class_name = self.class_map.get(
            cls_id, self.model.names.get(cls_id, f"class_{cls_id}")
        )
        if track_id is None:
            return cls_id, class_name, confidence

        if class_name not in ("Chicken", "Rooster") and not class_name.startswith("Hen"):
            self.track_class_history.pop(track_id, None)
            self.track_resolved_classes.pop(track_id, None)
            self.track_class_last_seen.pop(track_id, None)
            return cls_id, class_name, confidence

        class_history = self.track_class_history.setdefault(track_id, {})
        observations, confidence_sum = class_history.get(cls_id, (0, 0.0))
        class_history[cls_id] = (observations + 1, confidence_sum + confidence)
        self.track_class_last_seen[track_id] = self.processed_frame_count

        candidate_cls_id = max(
            class_history,
            key=lambda candidate_id: (
                class_history[candidate_id][0],
                class_history[candidate_id][1] / class_history[candidate_id][0],
            ),
        )
        resolved_cls_id = self.track_resolved_classes.get(track_id, candidate_cls_id)
        if candidate_cls_id != resolved_cls_id:
            resolved_count = class_history.get(resolved_cls_id, (0, 0.0))[0]
            candidate_count = class_history[candidate_cls_id][0]
            # Extra protection: a track confirmed as Rooster (class 8) can only
            # switch away if the challenger has CLASS_SWITCH_MARGIN * 2 more
            # observations, guarding against occasional Rooster→Chicken flips.
            rooster_cls_id = next(
                (k for k, v in self.class_map.items() if v == "Rooster"), 8
            )
            margin = (
                self.CLASS_SWITCH_MARGIN * 2
                if resolved_cls_id == rooster_cls_id
                else self.CLASS_SWITCH_MARGIN
            )
            if candidate_count >= resolved_count + margin:
                resolved_cls_id = candidate_cls_id
        self.track_resolved_classes[track_id] = resolved_cls_id

        resolved_observations, resolved_confidence_sum = class_history[resolved_cls_id]
        resolved_name = self.class_map.get(
            resolved_cls_id,
            self.model.names.get(resolved_cls_id, f"class_{resolved_cls_id}"),
        )
        return (
            resolved_cls_id,
            resolved_name,
            resolved_confidence_sum / resolved_observations,
        )

    def _prune_track_class_history(self) -> None:
        if self.processed_frame_count % self.CLASS_HISTORY_TTL_FRAMES:
            return

        cutoff = self.processed_frame_count - self.CLASS_HISTORY_TTL_FRAMES
        expired = [
            track_id
            for track_id, last_seen in self.track_class_last_seen.items()
            if last_seen < cutoff
        ]
        for track_id in expired:
            self.track_class_history.pop(track_id, None)
            self.track_resolved_classes.pop(track_id, None)
            self.track_class_last_seen.pop(track_id, None)
            self.track_label_cache.pop(track_id, None)
            self.track_label_votes.pop(track_id, None)
            self.track_label_last_seen.pop(track_id, None)
            getattr(self, "track_tag_confirmed", set()).discard(track_id)

    def process_frame(self, frame: np.ndarray, frame_idx: int, fps: float = 30.0) -> TrackerFrameOutput:
        """
        Executes YOLO26 Nano inference with ByteTrack persistence.
        """
        self.processed_frame_count += 1
        self._prune_track_class_history()
        timestamp_s = frame_idx / fps if fps > 0 else 0.0

        # Run ByteTrack prediction workflow
        track_kwargs = dict(
            persist=True,
            tracker=self.tracker_yaml,
            # Keep small leg-band candidates visible to the association pass.
            # Bird detections are filtered below with their stricter threshold.
            conf=getattr(self, "track_conf", min(self.conf, self.MIN_LEG_BAND_CONFIDENCE)),
            iou=self.iou,
            imgsz=self.imgsz,
            device=self.device,
            verbose=False,
        )
        if getattr(self, "_tracking_enabled", True):
            try:
                results = self.model.track(frame, **track_kwargs)[0]
            except Exception as exc:
                # A tracker problem must not sink the whole video: keep analysing it without
                # temporal IDs (the Re-ID bank still gives every bird a stable short ID).
                print(
                    f"[TRACKER] WARNING: tracking unavailable ({type(exc).__name__}: {exc}); "
                    "continuing with detection-only analysis for this video."
                )
                self._tracking_enabled = False
                results = self.model.predict(
                    frame,
                    conf=track_kwargs["conf"],
                    iou=self.iou,
                    imgsz=self.imgsz,
                    device=self.device,
                    verbose=False,
                )[0]
        else:
            results = self.model.predict(
                frame,
                conf=track_kwargs["conf"],
                iou=self.iou,
                imgsz=self.imgsz,
                device=self.device,
                verbose=False,
            )[0]

        birds: List[TrackedDetection] = []
        feeders: List[TrackedDetection] = []
        drinkers: List[TrackedDetection] = []
        band_dets: List[Tuple[List[int], str]] = []

        if results.boxes is None or len(results.boxes) == 0:
            return TrackerFrameOutput(
                frame_idx=frame_idx,
                timestamp_s=timestamp_s,
                birds=[],
                feeders=[],
                drinkers=[]
            )

        boxes = results.boxes.xyxy.cpu().numpy()
        confs = results.boxes.conf.cpu().numpy()
        classes = results.boxes.cls.int().cpu().tolist()
        track_ids = (
            results.boxes.id.int().cpu().tolist()
            if results.boxes.id is not None
            else [None] * len(boxes)
        )

        # First pass: parse raw detections
        for box, conf, cls_id, track_id in zip(boxes, confs, classes, track_ids):
            class_name = self.class_map.get(
                cls_id, self.model.names.get(cls_id, f"class_{cls_id}")
            )
            confidence = float(conf)
            if (
                not class_name.startswith("Leg_Band_")
                and confidence < self.MIN_DETECTION_CONFIDENCE
            ):
                continue
            if (
                class_name.startswith("Leg_Band_")
                and confidence < self.MIN_LEG_BAND_CONFIDENCE
            ):
                continue
            x1, y1, x2, y2 = [int(v) for v in box]
            cx, cy = int((x1 + x2) / 2), int((y1 + y2) / 2)

            det = TrackedDetection(
                box=[x1, y1, x2, y2],
                centroid=(cx, cy),
                confidence=confidence,
                class_id=cls_id,
                class_name=class_name,
                track_id=track_id,
                bird_label=class_name,
            )

            if class_name in ("Chicken", "Rooster") or class_name.startswith("Hen"):
                det.bird_label = class_name
                birds.append(det)
            elif class_name == "Feeder":
                det.bird_label = "Feeder"
                det.track_id = None
                feeders.append(det)
            elif class_name == "Drinker":
                det.bird_label = "Drinker"
                det.track_id = None
                drinkers.append(det)
            elif class_name.startswith("Leg_Band_"):
                band_dets.append(([x1, y1, x2, y2], class_name))

        # Convert raw ByteTrack IDs before recording any class or band history.
        # This keeps identity memory attached to the stable displayed ID when
        # ByteTrack recreates a raw track after a brief occlusion.
        self._assign_display_ids(birds, frame.shape)
        for bird in birds:
            if bird.track_id is None:
                continue
            resolved_cls_id, resolved_name, resolved_confidence = self._resolve_track_class(
                bird.class_id, bird.confidence, bird.track_id
            )
            bird.class_id = resolved_cls_id
            bird.class_name = resolved_name
            bird.confidence = resolved_confidence
            bird.bird_label = resolved_name

        # Re-ID lock for leg bands if present.
        # Re-ID lock for leg bands if present.
        # Associate each detected band with the nearest chicken lower body/leg region
        for band_box, band_name in band_dets:
            bx1, by1, bx2, by2 = band_box
            bcx, bcy = (bx1 + bx2) // 2, (by1 + by2) // 2
            hen_label = BAND_CLASS_TO_HEN.get(band_name)
            if not hen_label:
                continue

            best_bird = None
            best_dist = float("inf")
            for bird in birds:
                if bird.track_id is None or bird.class_name == "Rooster":
                    continue
                x1, y1, x2, y2 = bird.box
                bw = max(1, x2 - x1)
                bh = max(1, y2 - y1)
                # Lower body and leg zone (lower 65% of torso down to 25% below box)
                if (x1 - 0.25 * bw <= bcx <= x2 + 0.25 * bw) and (y1 + 0.35 * bh <= bcy <= y2 + 0.25 * bh):
                    dist = abs(bcx - (x1 + x2) / 2) + abs(bcy - y2)
                    if dist < best_dist:
                        best_dist = dist
                        best_bird = bird

            if best_bird is not None:
                # Cast 4 votes per YOLO band detection (2 consecutive observations reach 8 votes)
                for _ in range(4):
                    self._record_track_label(best_bird.track_id, hen_label)
                if best_bird.track_id in self.track_label_cache:
                    self.track_tag_confirmed.add(best_bird.track_id)

        # A compact, color-qualified tag is a valid tag observation even when
        # the YOLO tag box is missed. Inspect lower leg region of unconfirmed chickens.
        if not hasattr(self, "track_tag_confirmed"):
            self.track_tag_confirmed: set = set()
        for bird in birds:
            if bird.track_id is None or bird.class_name == "Rooster":
                continue
            # Keep tracks that are already locked in track_label_cache confirmed
            if bird.track_id in self.track_label_cache:
                self.track_tag_confirmed.add(bird.track_id)
                continue
            hen_label = detect_leg_band_color(frame, bird.box)
            if hen_label:
                # Cast 3 votes per observation; accumulates across frames until 8 votes reached
                for _ in range(3):
                    self._record_track_label(bird.track_id, hen_label)
                if bird.track_id in self.track_label_cache:
                    self.track_tag_confirmed.add(bird.track_id)

        # Resolve active bird labels, enforcing 1-to-1 uniqueness in the current frame.
        # Stage A keeps each track's previously displayed colour, so two birds whose boxes
        # overlap can never swap Hen1 <-> Hen3 for a frame (the old code kept "last wins",
        # which relabelled whichever bird was drawn last).
        if not hasattr(self, "track_last_label"):
            self.track_last_label: Dict[int, str] = {}
        if not hasattr(self, "label_owner"):
            self.label_owner: Dict[str, Tuple[int, int]] = {}
        used_labels = set()

        def _label_priority(b: TrackedDetection) -> int:
            if b.track_id is None:
                return 0
            lbl = self.track_label_cache.get(b.track_id)
            if not lbl:
                return 0
            votes = self.track_label_votes.get(b.track_id, [])
            return votes.count(lbl)

        sorted_birds = sorted(birds, key=_label_priority, reverse=True)
        for bird in sorted_birds:
            if bird.class_name != "Chicken" or bird.track_id is None:
                continue
            candidate = self.track_last_label.get(bird.track_id)
            if (
                candidate
                and self.track_label_cache.get(bird.track_id) == candidate
                and candidate not in used_labels
            ):
                bird.bird_label = candidate
                used_labels.add(candidate)

        # Stage B applies newly confirmed colours.
        for bird in sorted_birds:
            if (
                bird.track_id is not None
                and bird.track_id in getattr(self, "track_tag_confirmed", set())
                and bird.track_id in self.track_label_cache
            ):
                assigned = self.track_label_cache[bird.track_id]
                if assigned not in used_labels:
                    bird.bird_label = assigned
                    used_labels.add(assigned)
                else:
                    # Duplicate hen identity in the same frame is invalid; retain generic Chicken
                    bird.bird_label = "Chicken"
            elif bird.class_name == "Chicken":
                bird.bird_label = "Chicken"

        # Stage C: a colour that was already shown by another active track in the current frame cannot be shown twice.
        active_tids = {bird.track_id for bird in birds if bird.track_id is not None}
        owner_of_label = {label: tid for tid, label in self.track_last_label.items() if tid in active_tids}
        for bird in birds:
            if bird.track_id is None or not bird.bird_label.startswith("Hen"):
                continue
            current_owner = owner_of_label.get(bird.bird_label)
            if current_owner is not None and current_owner != bird.track_id:
                bird.bird_label = "Chicken"

        for bird in birds:
            if bird.track_id is not None and bird.bird_label.startswith("Hen"):
                self.track_last_label[bird.track_id] = bird.bird_label
                self.label_owner[bird.bird_label] = (bird.track_id, self.processed_frame_count)

        # Reclaim identities of tracks that are inactive
        stale = [
            tid for tid in list(self.track_last_label)
            if tid not in active_tids
            and self.processed_frame_count - self.track_label_last_seen.get(tid, 0) > 45
        ]
        for tid in stale:
            label = self.track_last_label.pop(tid, None)
            if label is not None and self.label_owner.get(label, (None, 0))[0] == tid:
                self.label_owner.pop(label, None)

        equipment = suppress_overlapping_equipment(
            [
                (detection.box, detection.confidence, detection.class_name, detection)
                for detection in feeders + drinkers
            ]
        )
        feeders = [
            detection for _, _, label, detection in equipment if label == "Feeder"
        ]
        drinkers = [
            detection for _, _, label, detection in equipment if label == "Drinker"
        ]

        return TrackerFrameOutput(
            frame_idx=frame_idx,
            timestamp_s=timestamp_s,
            birds=birds,
            feeders=feeders,
            drinkers=drinkers
        )

    def annotate_frame(self, frame: np.ndarray, frame_out: TrackerFrameOutput) -> np.ndarray:
        """Draws bounding boxes, track IDs, leg tag anchors, and a detection HUD onto a copy of the frame."""
        vis = frame.copy()
        w = vis.shape[1]

        identified_hens = set()

        def _draw(det: TrackedDetection, fallback_name: str):
            x1, y1, x2, y2 = det.box
            if fallback_name in ("Feeder", "Drinker"):
                label = fallback_name
            else:
                label = det.bird_label if det.bird_label else det.class_name or fallback_name

            is_identified_hen = label.startswith("Hen")
            if is_identified_hen:
                identified_hens.add(label)

            color = LABEL_COLORS_BGR.get(label, LABEL_COLORS_BGR.get(det.class_name, LABEL_COLORS_BGR["Default"]))

            # Draw primary bounding box
            cv2.rectangle(vis, (x1, y1), (x2, y2), color, 2)

            # Top pill badge
            tid = f"#{det.track_id} " if det.track_id is not None else ""
            tag_prefix = "TAG: " if is_identified_hen else ""
            text = f"{tid}{tag_prefix}{label} ({det.confidence:.2f})"
            # Badge background
            (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            y_text = max(th + 4, y1)
            cv2.rectangle(vis, (x1, y_text - th - 6), (x1 + tw + 6, y_text + 2), color, -1)
            ink = (0, 0, 0) if sum(color) > 400 else (255, 255, 255)
            cv2.putText(vis, text, (x1 + 3, y_text - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, ink, 1)

            # For identified hens, draw a leg-band tag indicator at the bottom edge
            if is_identified_hen:
                cx = (x1 + x2) // 2
                cy_leg = min(vis.shape[0] - 5, y2 - 3)
                cv2.circle(vis, (cx, cy_leg), 5, (20, 24, 30), -1, cv2.LINE_AA)
                cv2.circle(vis, (cx, cy_leg), 4, color, -1, cv2.LINE_AA)
                cv2.circle(vis, (cx, cy_leg), 1, (255, 255, 255), -1, cv2.LINE_AA)

        for bird in frame_out.birds:
            _draw(bird, "Chicken")
        for feeder in frame_out.feeders:
            _draw(feeder, "Feeder")
        for drinker in frame_out.drinkers:
            _draw(drinker, "Drinker")

        # Top HUD bar
        overlay = vis.copy()
        cv2.rectangle(overlay, (0, 0), (w, 36), (15, 20, 28), -1)
        cv2.addWeighted(overlay, 0.88, vis, 0.12, 0, vis)

        # Build hen roster indicator (G W B Y P)
        tag_status = []
        for hen_key, short_code in [("Hen1 (Green)", "G"), ("Hen2 (White)", "W"), ("Hen3 (Blue)", "B"), ("Hen4 (Yellow)", "Y"), ("Hen5 (Pink)", "P")]:
            if hen_key in identified_hens:
                tag_status.append(f"{short_code}:[OK]")
            else:
                tag_status.append(f"{short_code}:-")
        tag_str = " ".join(tag_status)

        hud_left = (
            f"FRAME {frame_out.frame_idx} | BIRDS: {len(frame_out.birds)} | "
            f"HENS TAGGED: {len(identified_hens)}/5 ({tag_str})"
        )
        cv2.putText(vis, hud_left, (12, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.50, (255, 255, 255), 1, cv2.LINE_AA)
        return vis