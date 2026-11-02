"""
edge/reid.py - Poultry Re-ID primitives shared by the edge engine and the analytics tracker.

ByteTrack only re-associates a lost bird by spatial IoU while it is still inside the short
Kalman cooldown window. In a broiler pen birds sit on the floor (near-zero vertical motion)
and bodies overlap heavily, so once a hen leaves the frame or is hidden for longer than the
window, ByteTrack re-spawns it with a brand-new ID.

The helpers below supply a *second, non-spatial* signal for re-acquisition:

* ``leg_band_detection``   - the current frame's leg-band evidence, built on the shared
  leg-anchored detector in ``legband.py`` (colour + band geometry + leg continuity).
* ``band_state_snapshot`` - the colour identity (green/white/blue/yellow/pink leg band)
  that was already established for a track through temporal voting.
* ``appearance_descriptor`` - a cheap HSV histogram patch around the band location, used only
  as a weak tie-breaker when two birds share the same band colour class (or the band is
  invisible because the bird is feeding / occluded).
* ``iou`` helpers used to gate candidates before any appearance test is run.

Everything here is NumPy/OpenCV only (no torch, no classifier) so it stays cheap on the
Dell OptiPlex CPU and is unit-testable without a model.
"""

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

Box = Sequence[float]


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def box_iou(a: Box, b: Box) -> float:
    """Standard IoU between two [x1, y1, x2, y2] boxes."""
    left = max(float(a[0]), float(b[0]))
    top = max(float(a[1]), float(b[1]))
    right = min(float(a[2]), float(b[2]))
    bottom = min(float(a[3]), float(b[3]))
    inter = max(0.0, right - left) * max(0.0, bottom - top)
    if inter <= 0.0:
        return 0.0
    area_a = max(0.0, float(a[2]) - float(a[0])) * max(0.0, float(a[3]) - float(a[1]))
    area_b = max(0.0, float(b[2]) - float(b[0])) * max(0.0, float(b[3]) - float(b[1]))
    union = area_a + area_b - inter
    return inter / union if union > 0.0 else 0.0


def center(box: Box) -> Tuple[float, float]:
    return ((float(box[0]) + float(box[2])) / 2.0, (float(box[1]) + float(box[3])) / 2.0)


def center_distance(a: Box, b: Box) -> float:
    ax, ay = center(a)
    bx, by = center(b)
    return math.hypot(ax - bx, ay - by)


def box_size(box: Box) -> float:
    """Geometric mean side length; scale-invariant measure of how big a bird is."""
    w = max(1.0, float(box[2]) - float(box[0]))
    h = max(1.0, float(box[3]) - float(box[1]))
    return math.sqrt(w * h)


def gated_candidates(
    track_box: Box,
    track_velocity: Tuple[float, float],
    detections: Sequence[Tuple[object, Box]],
    gate_multiplier: float = 1.25,
    size_tolerance: float = 0.45,
) -> List[Tuple[object, float, float]]:
    """
    Spatial gate applied before an appearance test.

    Returns ``(payload, distance, size_delta)`` for every detection whose body box overlaps the
    track box, sits inside an expanded gate radius around the velocity-predicted box, and whose
    size differs by less than ``size_tolerance`` (relative). Keeping this gate tight is what
    stops two neighbouring hens from swapping colours -- a positive appearance score is never
    trusted on its own.
    """
    predicted = [
        float(track_box[0]) + track_velocity[0],
        float(track_box[1]) + track_velocity[1],
        float(track_box[2]) + track_velocity[0],
        float(track_box[3]) + track_velocity[1],
    ]
    ref_size = box_size(predicted)
    max_distance = ref_size * (1.0 + gate_multiplier)
    max_edge = ref_size * 0.5

    out: List[Tuple[object, float, float]] = []
    for payload, det_box in detections:
        overlap = box_iou(track_box, det_box)
        distance = center_distance(predicted, det_box)
        edge_gap = distance - (float(det_box[2]) - float(det_box[0])) / 2.0
        if overlap <= 0.0 and edge_gap > max_edge:
            continue
        if distance > max_distance:
            continue
        size_delta = abs(box_size(det_box) - ref_size) / max(ref_size, 1.0)
        if size_delta > size_tolerance:
            continue
        out.append((payload, distance, size_delta))
    return out


# ---------------------------------------------------------------------------
# Band evidence + appearance descriptor
# ---------------------------------------------------------------------------

@dataclass
class BandSignature:
    """Colour-qualified leg-band evidence for one detection in one frame."""

    label: str
    confidence: float          # 0..1, from the dominance of the winning colour cluster
    box: Tuple[int, int, int, int]   # absolute pixel box of the band cluster


def patch_descriptor(
    frame: np.ndarray,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
) -> Optional[np.ndarray]:
    """Fixed-length HSV histogram fingerprint of a rectangular patch (16x16 grey -> None)."""
    if frame is None:
        return None
    h, w = frame.shape[:2]
    x1, y1 = max(0, int(x1)), max(0, int(y1))
    x2, y2 = min(w, int(x2)), min(h, int(y2))
    if x2 - x1 < 2 or y2 - y1 < 2:
        return None
    roi = frame[y1:y2, x1:x2]
    resized = cv2.resize(roi, (16, 16), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)
    total = float(resized.shape[0] * resized.shape[1])

    hist_h = cv2.calcHist([hsv], [0], None, [16], [0, 180]).flatten() / total
    hist_s = cv2.calcHist([hsv], [1], None, [8], [0, 256]).flatten() / total
    hist_v = cv2.calcHist([hsv], [2], None, [8], [0, 256]).flatten() / total

    sat = hsv[:, :, 1].astype(np.float32)
    val = hsv[:, :, 2].astype(np.float32)
    saturated = sat > 60
    sat_ratio = float(np.count_nonzero(saturated)) / total
    if np.count_nonzero(saturated) > 0:
        hues = hsv[:, :, 0][saturated].astype(np.float32)
        bins = np.clip((hues * (16.0 / 180.0)).astype(np.int32), 0, 15)
        hue_vector = np.bincount(bins, minlength=16).astype(np.float32)
        hue_vector /= max(1.0, float(hues.size))
    else:
        hue_vector = np.zeros(16, dtype=np.float32)

    descriptor = np.concatenate(
        [
            hist_h.astype(np.float32),
            hist_s.astype(np.float32),
            hist_v.astype(np.float32),
            hue_vector,
            np.array(
                [
                    sat_ratio,
                    float(val.mean()) / 255.0,
                    float(val.std()) / 255.0,
                ],
                dtype=np.float32,
            ),
        ]
    )
    norm = float(np.linalg.norm(descriptor))
    if norm <= 1e-6:
        return None
    return descriptor / norm


def appearance_descriptor(
    frame: np.ndarray,
    bird_box: Box,
    band_box: Optional[Sequence[float]] = None,
) -> Optional[np.ndarray]:
    """
    Re-ID texture fingerprint of a bird.

    The patch is a 2x2 grid centred on the *band location* (or the lower body if the band is not
    visible). It is intentionally small and low-resolution: it is a weak disambiguator between
    same-colour birds, not a biometric, so it never overrides a colour decision.
    """
    bx1, by1, bx2, by2 = [float(v) for v in bird_box]
    bw, bh = max(1.0, bx2 - bx1), max(1.0, by2 - by1)
    if band_box is not None:
        u = ((float(band_box[0]) + float(band_box[2])) / 2.0 - bx1) / bw
        v = ((float(band_box[1]) + float(band_box[3])) / 2.0 - by1) / bh
    else:
        u, v = 0.5, 0.72
    u = min(0.9, max(0.1, u))
    v = min(0.95, max(0.35, v))

    vectors: List[np.ndarray] = []
    for cell in range(4):
        u0, u1 = (u - 0.12, u + 0.12) if cell % 2 == 0 else (u + 0.12, u + 0.36)
        v0, v1 = (v - 0.12, v + 0.12) if cell < 2 else (v - 0.36, v - 0.12)
        vec = patch_descriptor(
            frame,
            bx1 + u0 * bw,
            by1 + v0 * bh,
            bx1 + u1 * bw,
            by1 + v1 * bh,
        )
        if vec is None:
            return None
        vectors.append(vec)
    merged = np.concatenate(vectors)
    norm = float(np.linalg.norm(merged))
    return merged / norm if norm > 1e-6 else None


def descriptor_similarity(a: Optional[np.ndarray], b: Optional[np.ndarray]) -> float:
    """Cosine similarity in [-1, 1]; 0.0 when either side has no fingerprint."""
    if a is None or b is None or a.shape != b.shape:
        return 0.0
    return float(np.clip(np.dot(a, b), -1.0, 1.0))


def leg_band_signature(frame: np.ndarray, bird_box: Box) -> Optional[BandSignature]:
    """
    Locate the coloured leg band inside a bird box and report how *dominant* it is.

    Same colour statistics as ``legband.detect_leg_band_color`` (compact cluster, not a
    feather-sheen stripe), but it returns the confidence and the absolute band box so the
    caller can (a) vote over time, (b) use the band location as the Re-ID patch anchor.
    """
    if frame is None:
        return None
    frame_height, frame_width = frame.shape[:2]
    x1, y1, x2, y2 = (int(round(v)) for v in bird_box)
    box_width, box_height = x2 - x1, y2 - y1
    if box_width <= 0 or box_height <= 0:
        return None
    if (box_width / max(1, box_height) > 1.35) or box_height < 40:
        return None

    crop_x1 = max(0, min(frame_width, x1 + int(box_width * 0.12)))
    crop_x2 = max(0, min(frame_width, x2 - int(box_width * 0.12)))
    crop_y1 = max(0, min(frame_height, y1 + int(box_height * 0.70)))
    crop_y2 = max(0, min(frame_height, y2 + int(box_height * 0.08)))
    if crop_x2 <= crop_x1 or crop_y2 <= crop_y1:
        return None

    roi = frame[crop_y1:crop_y2, crop_x1:crop_x2]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    roi_h = roi.shape[0]
    max_cw = max(4, int(box_width * 0.28))
    max_ch = max(4, int(box_height * 0.32))

    best_label: Optional[str] = None
    best_area = 0.0
    second_area = 0.0
    best_worker = None

    for label, (lower, upper) in LEG_BAND_HSV_RANGES.items():
        mask = cv2.inRange(
            hsv, np.asarray(lower, dtype=np.uint8), np.asarray(upper, dtype=np.uint8)
        )
        num_labels, _, stats, centroids = cv2.connectedComponentsWithStats(mask)
        valid_area = 0.0
        worker = None
        for j in range(1, num_labels):
            area = stats[j, cv2.CC_STAT_AREA]
            cw = stats[j, cv2.CC_STAT_WIDTH]
            ch = stats[j, cv2.CC_STAT_HEIGHT]
            cy = centroids[j][1]
            if 10 <= area <= 350 and 3 <= cw <= max_cw and 3 <= ch <= max_ch and cy >= roi_h * 0.20:
                aspect = cw / max(1, ch)
                if 0.20 <= aspect <= 3.8 and area > valid_area:
                    valid_area = float(area)
                    worker = (j, stats[j])

        if valid_area > 0:
            if valid_area > best_area:
                second_area = best_area
                best_area = valid_area
                best_label = label
                best_worker = worker
            elif valid_area > second_area:
                second_area = valid_area

    if not best_label or best_worker is None:
        return None
    if second_area >= best_area * 0.60:
        return None

    _, stats_row = best_worker
    bx = crop_x1 + int(stats_row[cv2.CC_STAT_LEFT])
    by = crop_y1 + int(stats_row[cv2.CC_STAT_TOP])
    bw = int(stats_row[cv2.CC_STAT_WIDTH])
    bh = int(stats_row[cv2.CC_STAT_HEIGHT])
    dominance = 1.0 - (second_area / best_area if best_area > 0 else 0.0)
    return BandSignature(label=best_label, confidence=float(dominance), box=(bx, by, bx + bw, by + bh))


# Imported at the bottom so the HSV table lives in exactly one place (legband.py).
from legband import LEG_BAND_HSV_RANGES  # noqa: E402


# ---------------------------------------------------------------------------
# Temporal band identity
# ---------------------------------------------------------------------------

class BandVoteBank:
    """
    Exponentially-decayed vote bank for leg-band colours of one track.

    A YOLO leg-band box is decisive (three votes at once). An HSV observation is worth one vote.
    The identity *locks* after ``votes[s] >= lock_after_votes`` AND ``p(s) >= lock_ratio`` where p
    is the softmax over per-class vote mass -- so 3 green + 2 white is still ambiguous and never
    produces a Hen label from noise. Once locked the identity is sticky: the challenger needs
    ``switch_margin`` more raw votes than the winner, which mirrors the analytics tracker.
    """

    def __init__(self, lock_after_votes: float = 3.0, lock_ratio: float = 0.70, switch_margin: float = 2.0):
        self.lock_after_votes = lock_after_votes
        self.lock_ratio = lock_ratio
        self.switch_margin = switch_margin
        self.votes: Dict[str, float] = {}
        self.locked_label: Optional[str] = None

    def add(self, label: str, weight: float = 1.0) -> None:
        self.votes[label] = self.votes.get(label, 0.0) + weight
        self._resolve()

    def decay(self, factor: float) -> None:
        """Forget unsupported votes so a dispute resolves itself within a few seconds."""
        self.votes = {k: v * factor for k, v in self.votes.items() if v * factor >= 0.05}
        self._resolve()

    def _resolve(self) -> None:
        if not self.votes:
            return
        total = sum(self.votes.values())
        winner, mass = max(self.votes.items(), key=lambda item: item[1])
        share = mass / total if total > 0 else 0.0
        if self.locked_label is None:
            if mass >= self.lock_after_votes and share >= self.lock_ratio:
                self.locked_label = winner
            return

        locked_mass = self.votes.get(self.locked_label, 0.0)
        challenger_mass = self.votes.get(winner, 0.0)
        if (
            winner != self.locked_label
            and challenger_mass >= locked_mass + self.switch_margin
            and mass >= self.lock_after_votes
        ):
            self.locked_label = winner

    def is_locked(self) -> bool:
        return self.locked_label is not None

    def support(self, label: str) -> float:
        """Normalised vote share for ``label`` (0..1)."""
        total = sum(self.votes.values())
        return self.votes.get(label, 0.0) / total if total > 0 else 0.0

    def pending_label(self) -> Optional[str]:
        """Current leader even before the lock (used as evidence during Re-ID scoring)."""
        if not self.votes:
            return None
        return max(self.votes.items(), key=lambda item: item[1])[0]

    def reidentify(self, label: str, weight: float = 2.0) -> None:
        """Re-assert an identity after a Re-ID match so it never drifts from isolated noise."""
        self.add(label, weight)


__all__ = [
    "BandSignature",
    "BandVoteBank",
    "appearance_descriptor",
    "box_iou",
    "box_size",
    "center",
    "center_distance",
    "descriptor_similarity",
    "gated_candidates",
    "leg_band_signature",
    "patch_descriptor",
]
