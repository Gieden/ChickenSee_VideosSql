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
from saddle import (
    ANIMAL_TO_FIXED_ID,
    FIXED_ID_TO_HEN,
    HEN_TO_FIXED_ID,
    SADDLE_CLASS_TO_HEN,
    animal_display_label,
    detect_pen_equipment,
    detect_saddle_color,
    equipment_boxes_overlap,
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
    "Rooster":                 (0, 0, 255),
    "Chicken":                 (0, 165, 255),
    "Hen1 (Yellow)":           (0, 255, 255),
    "Saddle_Yellow(Hen1)":     (0, 255, 255),
    "Hen2 (Blue)":             (255, 0, 0),
    "Saddle_Blue(Hen2)":       (255, 0, 0),
    "Hen3 (Red)":              (0, 0, 255),
    "Saddle_Red(Hen3)":        (0, 0, 255),
    "Hen4 (White)":            (255, 255, 255),
    "Saddle_White(Hen4)":      (255, 255, 255),
    "Hen5 (YellowGreen)":      (50, 205, 154),
    "Saddle_YellowGreen(Hen5)":(50, 205, 154),
    "Feeder":                  (128, 128, 128),
    "Drinker":                 (128, 128, 128),
    "Default":                 (128, 128, 128),
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

    # Requires 10 more observations than current class before switching â€”
    # prevents a handful of mislabelled frames from flipping Roosterâ†’Hen.
    CLASS_SWITCH_MARGIN = 10
    # Keep per-track class history alive for 600 frames (~20 s at 30 fps).
    CLASS_HISTORY_TTL_FRAMES = 600
    MIN_DETECTION_CONFIDENCE = 0.25  # Calibrated for poultry_v7 (Chicken/Rooster mAP50=96.5%+)
    MIN_EQUIPMENT_CONFIDENCE = 0.20  # Calibrated for poultry_v7 (Feeder/Drinker mAP50=96.7-97.0%)
    MIN_SADDLE_CONFIDENCE = 0.15     # Default saddle gate
    # Per-saddle confidence gates calibrated from poultry_v7 validation recall/precision:
    # Blue has the lowest recall (0.467) on dark feathers -> lower gate (0.12) recovers missed detections;
    # Red & YellowGreen have high recall (0.81-0.86) -> tighter gate (0.18) reduces false swaps.
    MIN_SADDLE_CONFIDENCE_BY_CLASS = {
        "Saddle_Color_Blue": 0.12,
        "Saddle_Color_White": 0.15,
        "Saddle_Color_Yellow": 0.15,
        "Saddle_Color_Red": 0.18,
        "Saddle_Color_YellowGreen": 0.18,
    }
    REIDENTIFICATION_MAX_GAP_FRAMES = 90
    REIDENTIFICATION_DISTANCE_RATIO = 0.22
    REIDENTIFICATION_MIN_DISTANCE_PX = 30.0
    REIDENTIFICATION_STALE_RATIO = 0.15
    REIDENTIFICATION_STALE_AFTER_FRAMES = 45
    REIDENTIFICATION_SIZE_TOLERANCE = 0.75
    # A colour identity may not be reused by another track within this many frames
    # (prevents two adjacent birds from swapping Hen1/Hen3 when their boxes overlap).
    LABEL_REUSE_COOLDOWN_FRAMES = 90

    @staticmethod
    def _normalize_class_names(names: Any) -> Dict[int, str]:
        if isinstance(names, dict):
            class_map = {int(class_id): str(name) for class_id, name in names.items()}
        elif isinstance(names, (list, tuple)):
            class_map = {class_id: str(name) for class_id, name in enumerate(names)}
        else:
            raise TypeError("YOLO model.names must be a class-name dictionary or sequence")
        if not class_map:
            raise ValueError("YOLO model has no class names")
        return class_map

    def __init__(self, model_weights: Optional[str] = None, tracker_yaml: Optional[str] = None):
        self.weights_path = self._resolve_weights(model_weights or CONFIG.model_name)
        self.tracker_yaml = resolve_tracker_config(tracker_yaml or CONFIG.tracker_config)
        self.device = CONFIG.device
        self.conf = CONFIG.conf_threshold
        self.iou = CONFIG.iou_threshold
        self.imgsz = CONFIG.imgsz
        # min() of the class-specific gates: equipment, saddle, and bird boxes survive NMS
        min_saddle_gate = min(
            [self.MIN_SADDLE_CONFIDENCE] + list(self.MIN_SADDLE_CONFIDENCE_BY_CLASS.values())
        )
        self.track_conf = min(self.conf, self.MIN_EQUIPMENT_CONFIDENCE, min_saddle_gate)

        print(f"[TRACKER] Initializing YOLO26 Nano from: {self.weights_path}")
        print(f"[TRACKER] Using ByteTrack config: {self.tracker_yaml}")

        # Last line of defence: if a tracker YAML ever becomes unloadable, run detection-only
        # instead of failing every video in the queue.
        self._tracking_enabled = True
        self.model = YOLO(self.weights_path)
        # Dedicated equipment model (separate predictor state so .track() calls don't interfere)
        self._equip_model = YOLO(self.weights_path)
        self.class_map = self._normalize_class_names(self.model.names)

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
        self._unidentified_id_map: Dict[int, int] = {}
        self._next_short_id = 1
        # Fixed-population ID pool: when flock_size > 0 display IDs are drawn
        # from {1..flock_size}
        self.flock_size: int = CONFIG.flock_size
        self.short_track_positions: Dict[int, Tuple[Tuple[float, float], int]] = {}
        self.short_track_sizes: Dict[int, float] = {}
        self.short_track_velocities: Dict[int, Tuple[float, float]] = {}
        self.track_appearance_hist: Dict[int, np.ndarray] = {}
        self.track_last_label: Dict[int, str] = {}
        self.label_owner: Dict[str, Tuple[int, int]] = {}   # label -> (display id, frame)
        self.cached_feeders: List[TrackedDetection] = []
        self.cached_drinkers: List[TrackedDetection] = []
        # Hen saddle ownership & confidence tracking (ensures higher-confidence saddle stays with hen)
        self.hen_track_owners: Dict[str, int] = {}          # hen_label -> display_id of owner
        self.hen_owner_conf: Dict[str, float] = {}          # hen_label -> highest confirmed saddle confidence
        self.hen_owner_last_frame: Dict[str, int] = {}      # hen_label -> frame when owner was last detected/confirmed
        self.hen_last_yolo_saddle_frame: Dict[str, int] = {}  # hen_label -> last frame with a live YOLO saddle box on owner
        self.track_saddle_conf: Dict[int, float] = {}       # track_id -> highest saddle confidence detected on this bird
        # Rooster stable-ID cache: positional Re-ID for roosters across ByteTrack resets.
        # Maps display_id -> (last_centroid, last_frame), and raw_track_id -> display_id.
        self._rooster_display_map: Dict[int, int] = {}       # raw_track_id -> display_id
        self._rooster_positions: Dict[int, Tuple[Tuple[float, float], int]] = {}  # display_id -> (centroid, frame)
        self._next_rooster_id: int = 6  # First available rooster display ID

    def _resolve_short_id(self, raw_track_id: Optional[int]) -> Optional[int]:
        if raw_track_id is None:
            return None
        cached_label = self.track_label_cache.get(raw_track_id)
        if cached_label in ANIMAL_TO_FIXED_ID:
            fixed_id = ANIMAL_TO_FIXED_ID[cached_label]
            self.short_id_map[raw_track_id] = fixed_id
            return fixed_id
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
        self._unidentified_id_map.clear()
        self._next_short_id = 1
        getattr(self, "cached_feeders", []).clear()
        getattr(self, "cached_drinkers", []).clear()
        # Re-read flock_size from config in case the env var was changed between videos
        if not hasattr(self, "flock_size"):
            self.flock_size = CONFIG.flock_size
        self.short_track_positions.clear()
        self.short_track_sizes.clear()
        getattr(self, "short_track_velocities", {}).clear()
        getattr(self, "track_appearance_hist", {}).clear()
        self.track_last_label.clear()
        self.label_owner.clear()
        getattr(self, "hen_track_owners", {}).clear()
        getattr(self, "hen_owner_conf", {}).clear()
        getattr(self, "hen_owner_last_frame", {}).clear()
        getattr(self, "hen_last_yolo_saddle_frame", {}).clear()
        getattr(self, "track_saddle_conf", {}).clear()
        getattr(self, "_rooster_display_map", {}).clear()
        getattr(self, "_rooster_positions", {}).clear()
        self._next_rooster_id = 6

        predictor = getattr(self.model, "predictor", None)
        for tracker in getattr(predictor, "trackers", []):
            tracker.reset()

    @staticmethod
    def _box_iou(box_a: List[int], box_b: List[int]) -> float:
        ax1, ay1, ax2, ay2 = box_a
        bx1, by1, bx2, by2 = box_b
        ix1, iy1 = max(ax1, bx1), max(ay1, by1)
        ix2, iy2 = min(ax2, bx2), min(ay2, by2)
        inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
        if inter <= 0:
            return 0.0
        area_a = max(1, ax2 - ax1) * max(1, ay2 - ay1)
        area_b = max(1, bx2 - bx1) * max(1, by2 - by1)
        return float(inter) / float(area_a + area_b - inter)

    @staticmethod
    def _extract_appearance_hist(frame: Optional[np.ndarray], box: List[int]) -> Optional[np.ndarray]:
        """Extract a normalized 2D HSV histogram over the bird's upper-back/saddle region."""
        if frame is None or frame.size == 0 or frame.ndim != 3:
            return None
        fh, fw = frame.shape[:2]
        x1, y1, x2, y2 = box
        bw = max(1, x2 - x1)
        bh = max(1, y2 - y1)
        # Focus on torso/saddle zone (15%..75% height, 15%..85% width) to minimize background clutter
        cx1 = max(0, min(fw - 1, int(x1 + 0.15 * bw)))
        cx2 = max(cx1 + 1, min(fw, int(x2 - 0.15 * bw)))
        cy1 = max(0, min(fh - 1, int(y1 + 0.15 * bh)))
        cy2 = max(cy1 + 1, min(fh, int(y1 + 0.75 * bh)))
        crop = frame[cy1:cy2, cx1:cx2]
        if crop.size == 0 or crop.shape[0] < 4 or crop.shape[1] < 4:
            return None
        try:
            hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
            # Exclude very dark shadows (V < 35)
            mask = cv2.inRange(hsv, np.array([0, 20, 35], dtype=np.uint8), np.array([180, 255, 255], dtype=np.uint8))
            if cv2.countNonZero(mask) < 12:
                mask = None
            hist = cv2.calcHist([hsv], [0, 1], mask, [16, 8], [0, 180, 0, 256])
            cv2.normalize(hist, hist, alpha=0.0, beta=1.0, norm_type=cv2.NORM_MINMAX)
            flat = hist.flatten().astype(np.float32)
            norm = float(np.linalg.norm(flat))
            if norm > 1e-6:
                flat /= norm
            return flat
        except Exception:
            return None

    @staticmethod
    def _hist_similarity(hist_a: Optional[np.ndarray], hist_b: Optional[np.ndarray]) -> Optional[float]:
        """Cosine similarity in [0, 1] between two normalized HSV histograms."""
        if hist_a is None or hist_b is None or hist_a.shape != hist_b.shape:
            return None
        sim = float(np.dot(hist_a, hist_b))
        return max(0.0, min(1.0, sim))

    @classmethod
    def _find_occluded_bird_ids(cls, birds: List[TrackedDetection], iou_thresh: float = 0.12) -> set:
        """Return object ids `id(bird)` of birds currently overlapping another bird."""
        occluded = set()
        n = len(birds)
        for i in range(n):
            for j in range(i + 1, n):
                if cls._box_iou(birds[i].box, birds[j].box) >= iou_thresh:
                    occluded.add(id(birds[i]))
                    occluded.add(id(birds[j]))
        return occluded

    def _assign_display_ids(
        self,
        birds: List[TrackedDetection],
        frame_shape: Tuple[int, ...],
        frame: Optional[np.ndarray] = None,
    ) -> None:
        if not hasattr(self, "short_track_sizes"):
            self.short_track_sizes: Dict[int, float] = {}
        if not hasattr(self, "short_track_positions"):
            self.short_track_positions: Dict[int, Tuple[Tuple[float, float], int]] = {}
        if not hasattr(self, "short_track_velocities"):
            self.short_track_velocities: Dict[int, Tuple[float, float]] = {}
        if not hasattr(self, "track_appearance_hist"):
            self.track_appearance_hist: Dict[int, np.ndarray] = {}
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
        occluded_objs = self._find_occluded_bird_ids(birds, iou_thresh=0.12)
        pending = []
        assigned_ids = set()

        for bird in birds:
            raw_track_id = bird.track_id
            bird.raw_track_id = raw_track_id
            if raw_track_id is None:
                pending.append((bird, None))
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
            if raw_track_id is None:
                continue  # No ByteTrack ID -> no prior position history to re-ID against
            x1, y1, x2, y2 = bird.box
            center = ((x1 + x2) / 2, (y1 + y2) / 2)
            bird_size = math.sqrt(max(1, x2 - x1) * max(1, y2 - y1))
            bird_hist = self._extract_appearance_hist(frame, bird.box) if frame is not None else None
            # Quick HSV color check if bird is clearly visible (not occluded)
            bird_hsv_label = (
                detect_saddle_color(frame, bird.box)
                if frame is not None and id(bird) not in occluded_objs and bird.class_name != "Rooster"
                else None
            )
            for display_id, (last_center, last_seen) in list(self.short_track_positions.items()):
                gap = current_frame - last_seen
                if display_id in assigned_ids or not 1 <= gap <= self.REIDENTIFICATION_MAX_GAP_FRAMES:
                    continue
                # Velocity-predicted position (clamped to <= 6 frames of motion to avoid overshoot)
                vx, vy = self.short_track_velocities.get(display_id, (0.0, 0.0))
                pred_steps = min(gap, 6)
                pred_center = (last_center[0] + vx * pred_steps, last_center[1] + vy * pred_steps)
                allowed = max_distance if gap < self.REIDENTIFICATION_STALE_AFTER_FRAMES else stale_distance
                raw_dist = math.dist(center, last_center)
                pred_dist = math.dist(center, pred_center)
                distance = min(raw_dist, pred_dist)
                if distance > allowed:
                    continue
                last_size = self.short_track_sizes.get(display_id)
                if last_size and abs(bird_size - last_size) / max(last_size, 1.0) > self.REIDENTIFICATION_SIZE_TOLERANCE:
                    continue

                # Saddle-color veto: if returning bird clearly shows a different saddle color
                # than the candidate display_id's confirmed hen label, reject the swap!
                cand_confirmed_label = getattr(self, "track_label_cache", {}).get(display_id)
                if bird_hsv_label and cand_confirmed_label and bird_hsv_label != cand_confirmed_label:
                    continue

                # Combine normalized spatial distance with HSV appearance similarity
                norm_dist = distance / max(allowed, 1.0)
                hist_sim = self._hist_similarity(bird_hist, self.track_appearance_hist.get(display_id))
                if hist_sim is not None:
                    # Strong appearance mismatch veto prevents crossing birds from swapping IDs
                    if hist_sim < 0.20 and id(bird) not in occluded_objs:
                        continue
                    cost = norm_dist + 0.85 * (1.0 - hist_sim)
                else:
                    cost = norm_dist

                candidate_pairs.append(
                    (cost, distance, display_id, raw_track_id, bird, center)
                )

        matched_raw_ids = set()
        matched_birds = set()
        for _, _, display_id, raw_track_id, bird, _ in sorted(
            candidate_pairs,
            key=lambda pair: (
                float(pair[0]),
                float(pair[1]),
                pair[2] if pair[2] is not None else -1,
                pair[3] if pair[3] is not None else -1,
            ),
        ):
            if display_id in assigned_ids or id(bird) in matched_birds or (raw_track_id is not None and raw_track_id in matched_raw_ids):
                continue
            if raw_track_id is not None:
                prev_id = None
                for previous_raw_id, previous_display_id in list(self.short_id_map.items()):
                    if previous_display_id == display_id:
                        prev_id = previous_raw_id
                        self.short_id_map.pop(previous_raw_id)
                        if hasattr(self, "track_label_votes") and previous_raw_id in self.track_label_votes:
                            self.track_label_votes[raw_track_id] = self.track_label_votes.pop(previous_raw_id)
                        if hasattr(self, "track_label_cache") and previous_raw_id in self.track_label_cache:
                            self.track_label_cache[raw_track_id] = self.track_label_cache.pop(previous_raw_id)
                        if hasattr(self, "track_tag_confirmed") and previous_raw_id in self.track_tag_confirmed:
                            self.track_tag_confirmed.discard(previous_raw_id)
                            self.track_tag_confirmed.add(raw_track_id)
                self.short_id_map[raw_track_id] = display_id
                matched_raw_ids.add(raw_track_id)
                if display_id in FIXED_ID_TO_HEN:
                    hen_label = FIXED_ID_TO_HEN[display_id]
                    if hasattr(self, "hen_track_owners") and prev_id is not None and self.hen_track_owners.get(hen_label) in (display_id, prev_id):
                        self.hen_track_owners[hen_label] = raw_track_id
                        self.hen_owner_last_frame[hen_label] = current_frame
            bird.track_id = display_id
            assigned_ids.add(display_id)
            matched_birds.add(id(bird))

        for bird, raw_track_id in pending:
            if id(bird) in matched_birds:
                continue
            if raw_track_id is not None and raw_track_id in matched_raw_ids:
                continue
            display_id = self.short_id_map.get(raw_track_id) if raw_track_id is not None else None
            if display_id is not None and display_id in assigned_ids:
                # Ultra duplicate raw id in one frame (or an id already donated by re-ID)
                display_id = None
            if display_id is None:
                display_id = self._next_pool_id(assigned_ids)
            if raw_track_id is not None:
                self.short_id_map[raw_track_id] = display_id
            bird.track_id = display_id
            assigned_ids.add(display_id)

        for bird in birds:
            if bird.track_id is None:
                continue
            x1, y1, x2, y2 = bird.box
            new_center = ((x1 + x2) / 2, (y1 + y2) / 2)
            prev_pos_info = self.short_track_positions.get(bird.track_id)
            if prev_pos_info is not None:
                prev_center, prev_frame = prev_pos_info
                dt_frames = current_frame - prev_frame
                if 1 <= dt_frames <= 5:
                    vx = (new_center[0] - prev_center[0]) / dt_frames
                    vy = (new_center[1] - prev_center[1]) / dt_frames
                    old_vx, old_vy = self.short_track_velocities.get(bird.track_id, (vx, vy))
                    self.short_track_velocities[bird.track_id] = (
                        0.6 * old_vx + 0.4 * vx,
                        0.6 * old_vy + 0.4 * vy,
                    )
            self.short_track_positions[bird.track_id] = (new_center, current_frame)
            self.short_track_sizes[bird.track_id] = math.sqrt(
                max(1, x2 - x1) * max(1, y2 - y1)
            )
            # Only update appearance histogram when bird is clearly visible (not occluded by another bird)
            if frame is not None and id(bird) not in occluded_objs:
                new_hist = self._extract_appearance_hist(frame, bird.box)
                if new_hist is not None:
                    old_hist = self.track_appearance_hist.get(bird.track_id)
                    if old_hist is not None and old_hist.shape == new_hist.shape:
                        blended = 0.80 * old_hist + 0.20 * new_hist
                        norm = float(np.linalg.norm(blended))
                        self.track_appearance_hist[bird.track_id] = blended / norm if norm > 1e-6 else new_hist
                    else:
                        self.track_appearance_hist[bird.track_id] = new_hist

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
                    self.short_track_velocities.pop(display_id, None)
                    self.track_appearance_hist.pop(display_id, None)

    def _record_track_label(self, track_id: int, label: str) -> None:
        last_seen = self.track_label_last_seen.get(track_id)
        if last_seen == self.processed_frame_count:
            return
        # 15-frame rolling window; clear only after 90 consecutive unseen frames
        # so a bird that briefly ducks behind the feeder doesn't lose its identity.
        votes = self.track_label_votes.setdefault(track_id, deque(maxlen=15))
        if (
            last_seen is not None
            and self.processed_frame_count - last_seen > self.LABEL_REUSE_COOLDOWN_FRAMES
        ):
            votes.clear()
        votes.append(label)
        self.track_label_last_seen[track_id] = self.processed_frame_count
        # Require 8 consistent observations before committing a label so random
        # per-frame HSV noise cannot flip a hen's colour identity.
        vote_counts = Counter(votes)
        resolved_label, count = vote_counts.most_common(1)[0]
        if count >= 8 and count / len(votes) >= 0.70:
            # Once a label is locked, only replace it if the new winner has â‰¥8
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
        ]

        for cand in candidates:
            if cand and cand.is_file():
                return str(cand.resolve())

        # The project is intentionally pinned to YOLO26n/custom weights; do not silently
        # fall back to other Ultralytics families because that changes the model contract.
        if desired_name.lower() in {"yolo11n.pt", "yolov8n.pt"}:
            raise FileNotFoundError(
                f"No local weights found for '{desired_name}'. Place custom_poultry.pt or yolo26n.pt in the project root."
            )

        return desired_name

    def _resolve_track_class(
        self, cls_id: int, confidence: float, track_id: Optional[int]
    ) -> Tuple[int, str, float]:
        class_name = self.class_map.get(cls_id, f"class_{cls_id}")
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
            # observations, guarding against occasional Roosterâ†’Chicken flips.
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
            resolved_cls_id, f"class_{resolved_cls_id}"
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
        if not hasattr(self, "hen_track_owners"):
            self.hen_track_owners: Dict[str, int] = {}
        if not hasattr(self, "hen_owner_conf"):
            self.hen_owner_conf: Dict[str, float] = {}
        if not hasattr(self, "hen_owner_last_frame"):
            self.hen_owner_last_frame: Dict[str, int] = {}
        if not hasattr(self, "track_saddle_conf"):
            self.track_saddle_conf: Dict[int, float] = {}
        if not hasattr(self, "_rooster_display_map"):
            self._rooster_display_map: Dict[int, int] = {}
        if not hasattr(self, "track_tag_confirmed"):
            self.track_tag_confirmed: set = set()
        if not hasattr(self, "_unidentified_id_map"):
            self._unidentified_id_map: Dict[int, int] = {}

        self.processed_frame_count += 1
        self._prune_track_class_history()
        timestamp_s = frame_idx / fps if fps > 0 else 0.0

        # Run ByteTrack prediction workflow
        track_kwargs = dict(
            persist=True,
            tracker=self.tracker_yaml,
            # Keep small saddle candidates visible to the association pass.
            # Bird detections are filtered below with their stricter threshold.
            conf=getattr(self, "track_conf", min(self.conf, self.MIN_SADDLE_CONFIDENCE)),
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
        saddle_dets: List[Tuple[List[int], str, float]] = []

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
            if track_id is not None and track_id <= 0:
                track_id = None
            class_name = self.class_map.get(cls_id, f"class_{cls_id}")
            confidence = float(conf)
            is_saddle = class_name.startswith("Saddle_Color_")
            is_equip = class_name in ("Feeder", "Drinker")
            if is_equip and confidence < getattr(self, "MIN_EQUIPMENT_CONFIDENCE", 0.20):
                continue
            if is_saddle:
                saddle_gate = self.MIN_SADDLE_CONFIDENCE_BY_CLASS.get(
                    class_name, self.MIN_SADDLE_CONFIDENCE
                )
                if confidence < saddle_gate:
                    continue
            if not is_saddle and not is_equip and confidence < self.MIN_DETECTION_CONFIDENCE:
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
            elif class_name.startswith("Saddle_Color_"):
                saddle_dets.append(([x1, y1, x2, y2], class_name, confidence))

        # Class-agnostic Saddle NMS: suppress duplicate / conflicting saddle detections on the same patch
        if len(saddle_dets) > 1:
            saddle_dets.sort(key=lambda s: s[2], reverse=True)
            kept_saddles = []
            for s in saddle_dets:
                if any(equipment_boxes_overlap(s[0], ks[0], 0.35) for ks in kept_saddles):
                    continue
                kept_saddles.append(s)
            saddle_dets = kept_saddles

        # ByteTrack Kalman filters are tuned for moving birds and may drop small 10x10 saddle
        # patches, stationary equipment, or birds below new_track_thresh. Recover raw detections
        # via the dedicated predict engine so saddle identification and equipment tracking are reliable:
        if len(saddle_dets) < 5 or len(feeders) == 0 or len(drinkers) == 0 or len(birds) < 5:
            try:
                equip_model = getattr(self, "_equip_model", self.model)
                if equip_model is not None and hasattr(equip_model, "predict"):
                    min_saddle_gate = min(
                        [self.MIN_SADDLE_CONFIDENCE] + list(self.MIN_SADDLE_CONFIDENCE_BY_CLASS.values())
                    )
                    raw_res = equip_model.predict(
                        frame,
                        conf=min(getattr(self, "MIN_EQUIPMENT_CONFIDENCE", 0.20), min_saddle_gate),
                        iou=self.iou,
                        imgsz=self.imgsz,
                        device=self.device,
                        verbose=False,
                    )[0]
                    if raw_res.boxes is not None and len(raw_res.boxes) > 0:
                        r_boxes = raw_res.boxes.xyxy.cpu().numpy()
                        r_confs = raw_res.boxes.conf.cpu().numpy()
                        r_classes = raw_res.boxes.cls.int().cpu().tolist()
                        for r_box, r_conf, r_cls in zip(r_boxes, r_confs, r_classes):
                            r_name = self.class_map.get(r_cls, f"class_{r_cls}")
                            r_confidence = float(r_conf)
                            rx1, ry1, rx2, ry2 = [int(v) for v in r_box]
                            if r_name.startswith("Saddle_Color_"):
                                r_saddle_gate = self.MIN_SADDLE_CONFIDENCE_BY_CLASS.get(
                                    r_name, self.MIN_SADDLE_CONFIDENCE
                                )
                                if r_confidence >= r_saddle_gate:
                                    if not any(abs(rx1 - s[0][0]) < 8 and abs(ry1 - s[0][1]) < 8 for s in saddle_dets):
                                        saddle_dets.append(([rx1, ry1, rx2, ry2], r_name, r_confidence))
                            elif r_name == "Feeder" and r_confidence >= getattr(self, "MIN_EQUIPMENT_CONFIDENCE", 0.15):
                                if not any(equipment_boxes_overlap([rx1, ry1, rx2, ry2], f.box, 0.5) for f in feeders):
                                    feeders.append(TrackedDetection(
                                        box=[rx1, ry1, rx2, ry2],
                                        centroid=((rx1 + rx2) // 2, (ry1 + ry2) // 2),
                                        confidence=r_confidence,
                                        class_id=r_cls,
                                        class_name="Feeder",
                                        track_id=None,
                                        bird_label="Feeder",
                                    ))
                            elif r_name == "Drinker" and r_confidence >= getattr(self, "MIN_EQUIPMENT_CONFIDENCE", 0.15):
                                if not any(equipment_boxes_overlap([rx1, ry1, rx2, ry2], d.box, 0.5) for d in drinkers):
                                    drinkers.append(TrackedDetection(
                                        box=[rx1, ry1, rx2, ry2],
                                        centroid=((rx1 + rx2) // 2, (ry1 + ry2) // 2),
                                        confidence=r_confidence,
                                        class_id=r_cls,
                                        class_name="Drinker",
                                        track_id=None,
                                        bird_label="Drinker",
                                    ))
                            elif r_name in ("Chicken", "Rooster") and r_confidence >= self.MIN_DETECTION_CONFIDENCE:
                                if not any(equipment_boxes_overlap([rx1, ry1, rx2, ry2], b.box, 0.50) for b in birds):
                                    birds.append(TrackedDetection(
                                        box=[rx1, ry1, rx2, ry2],
                                        centroid=((rx1 + rx2) // 2, (ry1 + ry2) // 2),
                                        confidence=r_confidence,
                                        class_id=r_cls,
                                        class_name=r_name,
                                        track_id=None,
                                        bird_label=r_name,
                                    ))
            except Exception:
                pass

        # Suppress duplicate overlapping bird boxes (IoU > 0.62 — preserves partially-occluded neighbours)
        birds = sorted(birds, key=lambda b: b.confidence, reverse=True)
        kept_birds = []
        for b in birds:
            if any(equipment_boxes_overlap(b.box, k.box, 0.62) for k in kept_birds):
                continue
            kept_birds.append(b)
        birds = kept_birds

        # Convert raw ByteTrack IDs before recording any class or band history.
        # This keeps identity memory attached to the stable displayed ID when
        # ByteTrack recreates a raw track after a brief occlusion.
        self._assign_display_ids(birds, frame.shape, frame=frame)
        # Only compute hen-to-hen occlusion for saddle protection (Roosters never wear saddles,
        # so overlapping a Rooster must not block confirming a hen's live saddle).
        non_rooster_birds = [b for b in birds if b.class_name != "Rooster"]
        occluded_bird_objs = self._find_occluded_bird_ids(non_rooster_birds, iou_thresh=0.12)
        occluded_track_ids = {
            b.track_id for b in non_rooster_birds if b.track_id is not None and id(b) in occluded_bird_objs
        }
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

        # ------------------------------------------------------------------
        # Re-ID & Continuity Lock for Saddles (Higher-Confidence Preserved)
        # ------------------------------------------------------------------
        current_frame = self.processed_frame_count
        conflicting_track_ids = set()

        # 1. Match saddle detections to candidate birds
        bird_saddle_candidates: Dict[int, List[Tuple[float, str, float, List[int]]]] = {}
        for sbox, sname, sconf in saddle_dets:
            sx1, sy1, sx2, sy2 = sbox
            scx, scy = (sx1 + sx2) / 2, (sy1 + sy2) / 2
            hen_label = SADDLE_CLASS_TO_HEN.get(sname)
            if not hen_label:
                continue

            candidates = []
            for bird in birds:
                if bird.track_id is None:
                    continue
                if bird.class_name == "Rooster":
                    continue  # Rooster cannot wear a hen saddle
                x1, y1, x2, y2 = bird.box
                bw = max(1.0, float(x2 - x1))
                bh = max(1.0, float(y2 - y1))
                # In top-down view, a downward-facing hen's saddle can sit in the lower half of the box;
                # allow anywhere inside the bird box while weighting proximity toward the bird's center.
                if (x1 <= scx <= x2) and (y1 <= scy <= y2):
                    dist = (
                        abs(scx - (x1 + x2) / 2) / bw
                        + abs(scy - (y1 + y2) / 2) / bh
                    )
                    candidates.append((dist, bird))

            candidates.sort(key=lambda item: item[0])
            # Stricter ambiguity gate: if two overlapping birds both claim the same saddle
            # within 0.22 normalized distance, skip assigning it rather than swapping labels!
            if not candidates or (
                len(candidates) > 1
                and candidates[1][0] - candidates[0][0] < 0.22
            ):
                continue
            dist, bird = candidates[0]
            bird_saddle_candidates.setdefault(bird.track_id, []).append(
                (sconf, hen_label, dist, sbox)
            )

        # 2. Multi-candidate greedy 1-to-1 saddle assignment across all birds:
        # Collect all claims (sconf, hen_label, tid, dist, sbox)
        all_saddle_claims = []
        for tid, candidates in bird_saddle_candidates.items():
            for sconf, hen_label, dist, sbox in candidates:
                all_saddle_claims.append((sconf, hen_label, tid, dist, sbox))

        # Sort claims by confidence descending, then proximity
        all_saddle_claims.sort(key=lambda c: (c[0], -c[3]), reverse=True)

        assigned_hens = set()
        assigned_birds = set()
        winning_claims: Dict[str, Tuple[int, float]] = {}

        # First grant continuity to active incumbent owners
        for sconf, hen_label, tid, dist, sbox in all_saddle_claims:
            incumbent_tid = self.hen_track_owners.get(hen_label)
            if incumbent_tid == tid and hen_label not in assigned_hens and tid not in assigned_birds:
                assigned_hens.add(hen_label)
                assigned_birds.add(tid)
                winning_claims[hen_label] = (tid, sconf)

        # Then assign remaining claims greedily
        for sconf, hen_label, tid, dist, sbox in all_saddle_claims:
            if hen_label not in assigned_hens and tid not in assigned_birds:
                assigned_hens.add(hen_label)
                assigned_birds.add(tid)
                winning_claims[hen_label] = (tid, sconf)

        # 4. Commit winning saddle claims, enforcing confidence & continuity rules
        for hen_label, (win_tid, sconf) in winning_claims.items():
            best_bird = next((b for b in birds if b.track_id == win_tid), None)
            if best_bird is None:
                continue

            # If this bird was misclassified as Rooster, the saddle proves it is a Hen
            if best_bird.class_name == "Rooster":
                best_bird.class_name = "Chicken"
                best_bird.class_id = 0
                if best_bird.track_id in self.track_resolved_classes:
                    self.track_resolved_classes[best_bird.track_id] = 0
                if best_bird.track_id in self.track_class_history:
                    self.track_class_history[best_bird.track_id] = {0: (10, 10.0)}

            incumbent_tid = self.hen_track_owners.get(hen_label)
            if incumbent_tid == 6 or getattr(self, "track_resolved_classes", {}).get(incumbent_tid) == "Rooster":
                incumbent_tid = None
                self.hen_track_owners.pop(hen_label, None)
                self.hen_owner_conf.pop(hen_label, None)

            incumbent_conf = self.hen_owner_conf.get(hen_label, 0.0)
            active_tids = {b.track_id for b in birds if b.track_id is not None}
            incumbent_is_active = (incumbent_tid is not None and incumbent_tid in active_tids)
            last_yolo_saddle_frame = getattr(self, "hen_last_yolo_saddle_frame", {}).get(hen_label, -9999)
            # High-confidence live YOLO saddle (>=0.55) on another bird recovers a crossing swap
            # within 2 frames; moderate-confidence detections wait 8 frames without incumbent saddle.
            reclaim_gap = 2 if sconf >= 0.55 else 8
            incumbent_has_no_recent_yolo_saddle = (current_frame - last_yolo_saddle_frame) >= reclaim_gap

            # Rule: When the system detects a higher confidence of that saddle,
            # then the detection (bytetrack) must remain with the incumbent hen — UNLESS
            # the incumbent has had NO live YOLO saddle on it for >=8 frames (e.g., an
            # unsaddled chicken that falsely grabbed the label) while win_tid has a real
            # live YOLO saddle detection right on its back!
            # Note: allow reclaiming even when win_tid touches incumbent_tid (crossing pair)
            # because the ambiguity gate already verified the saddle center belongs to win_tid.
            reclaimed_from_unsaddled = False
            if incumbent_tid is not None and incumbent_tid != win_tid:
                if incumbent_is_active and incumbent_has_no_recent_yolo_saddle and sconf >= 0.25:
                    reclaimed_from_unsaddled = True
                elif incumbent_is_active and sconf <= incumbent_conf:
                    # Incumbent hen had higher confidence — detection MUST remain with incumbent!
                    continue
                elif incumbent_is_active and sconf < incumbent_conf + 0.20:
                    # Not enough margin to steal an active hen's identity
                    continue

            # If a real saddled bird reclaimed its identity from an unsaddled incumbent,
            # clear the stale label from the old unsaddled track immediately.
            if reclaimed_from_unsaddled and incumbent_tid is not None:
                self.track_label_cache.pop(incumbent_tid, None)
                self.track_label_votes.pop(incumbent_tid, None)
                self.track_tag_confirmed.discard(incumbent_tid)
                self.track_last_label.pop(incumbent_tid, None)
                self.track_saddle_conf.pop(incumbent_tid, None)
                self.label_owner.pop(hen_label, None)
                for b_old in birds:
                    if b_old.track_id == incumbent_tid:
                        b_old.bird_label = "Chicken"
                        if getattr(b_old, "raw_track_id", None) is not None:
                            self.short_id_map.pop(b_old.raw_track_id, None)
                        b_old.track_id = self._next_pool_id(active_tids | {1, 2, 3, 4, 5, 6})
                        active_tids.add(b_old.track_id)

            # Occlusion freeze: if this bird is currently overlapping another bird AND already
            # has a confirmed different label, NEVER let a neighbour's saddle overwrite it!
            is_bird_occluded = win_tid in occluded_track_ids
            cached_label = self.track_label_cache.get(win_tid)
            if cached_label is not None and cached_label != hen_label:
                if is_bird_occluded:
                    # Freeze confirmed identity during occlusion — ignore conflicting neighbour saddle
                    continue
                if sconf >= 0.65:
                    # Only allow immediate label switch when isolated AND high-confidence
                    self.track_label_cache[win_tid] = hen_label
                    self.track_label_votes[win_tid] = deque([hen_label], maxlen=15)
                else:
                    # Require multi-frame voting via _record_track_label instead of single-frame flip
                    self._record_track_label(win_tid, hen_label)
                    if self.track_label_cache.get(win_tid) != hen_label:
                        continue

            # Lock / update ownership
            self.hen_track_owners[hen_label] = win_tid
            self.hen_owner_conf[hen_label] = max(incumbent_conf if incumbent_tid == win_tid else 0.0, sconf)
            self.hen_owner_last_frame[hen_label] = current_frame
            if not hasattr(self, "hen_last_yolo_saddle_frame"):
                self.hen_last_yolo_saddle_frame = {}
            self.hen_last_yolo_saddle_frame[hen_label] = current_frame
            self.track_saddle_conf[win_tid] = max(self.track_saddle_conf.get(win_tid, 0.0), sconf)

            self._record_track_label(win_tid, hen_label)
            votes = self.track_label_votes.get(win_tid, [])
            if win_tid in self.track_label_cache:
                self.track_tag_confirmed.add(win_tid)
            elif (reclaimed_from_unsaddled or not is_bird_occluded) and self.processed_frame_count > 2 and sconf >= 0.30:
                self.track_label_cache[win_tid] = hen_label
                self.track_tag_confirmed.add(win_tid)
                self.track_label_votes[win_tid] = deque([hen_label] * 10, maxlen=15)
            elif not is_bird_occluded and sconf >= 0.12 and len(votes) >= 3 and votes.count(hen_label) >= 3:
                self.track_label_cache[win_tid] = hen_label
                self.track_tag_confirmed.add(win_tid)

            if win_tid in getattr(self, "track_tag_confirmed", set()) and hen_label in HEN_TO_FIXED_ID:
                fixed_id = HEN_TO_FIXED_ID[hen_label]
                self.track_label_cache[fixed_id] = hen_label
                self.track_tag_confirmed.add(fixed_id)
                self.track_label_votes[fixed_id] = deque([hen_label] * 15, maxlen=15)
                self.hen_track_owners[hen_label] = fixed_id
                self.hen_owner_conf[hen_label] = max(self.hen_owner_conf.get(hen_label, 0.0), sconf)
                self.hen_owner_last_frame[hen_label] = current_frame
                self.hen_last_yolo_saddle_frame[hen_label] = current_frame
                if getattr(best_bird, "raw_track_id", None) is not None:
                    self.short_id_map[best_bird.raw_track_id] = fixed_id

        # Fallback HSV saddle check — ONLY for legacy models that do NOT have native
        # Saddle_Color_* YOLO classes. On native saddle models (custom_poultry.pt),
        # raw HSV misclassifies cool bluish glare on black feathers as Hen2 (Blue).
        has_native_saddle_classes = any(
            str(name).startswith("Saddle_Color_") for name in self.class_map.values()
        )
        if not hasattr(self, "track_tag_confirmed"):
            self.track_tag_confirmed: set = set()
        active_hen_owners = {
            self.hen_track_owners[lbl]
            for lbl in SADDLE_CLASS_TO_HEN.values()
            if lbl in self.hen_track_owners and self.hen_track_owners[lbl] in {b.track_id for b in birds}
        }
        birds_with_yolo_saddle = set(assigned_birds)
        for bird in ([] if has_native_saddle_classes else birds):
            if bird.track_id is None or bird.class_name == "Rooster":
                continue
            if bird.track_id in self.track_label_cache:
                self.track_tag_confirmed.add(bird.track_id)
                continue
            # Never run raw HSV saddle fallback on an occluded/overlapping bird crop —
            # overlapping crops pick up the neighbour's saddle colour and cause label swaps!
            if bird.track_id in occluded_track_ids:
                continue
            hen_label = (
                detect_saddle_color(frame, bird.box)
                if bird.track_id not in birds_with_yolo_saddle
                else None
            )
            if hen_label:
                # Never let fallback HSV steal an identity that is already active on another bird
                if self.hen_track_owners.get(hen_label) in active_hen_owners:
                    continue
                cached_label = self.track_label_cache.get(bird.track_id)
                if cached_label is not None and cached_label != hen_label:
                    conflicting_track_ids.add(bird.track_id)
                self._record_track_label(bird.track_id, hen_label)
                votes = self.track_label_votes.get(bird.track_id, [])
                # Require >=5 consistent HSV frames before confirming via HSV fallback
                # so a single-frame glare on an unsaddled bird can never steal a hen label!
                if bird.track_id in self.track_label_cache:
                    self.track_tag_confirmed.add(bird.track_id)
                    self.hen_track_owners[hen_label] = bird.track_id
                    self.hen_owner_conf[hen_label] = 0.25
                    self.hen_owner_last_frame[hen_label] = current_frame
                elif len(votes) >= 5 and votes.count(hen_label) >= 5:
                    self.track_label_cache[bird.track_id] = hen_label
                    self.track_tag_confirmed.add(bird.track_id)
                    self.hen_track_owners[hen_label] = bird.track_id
                    self.hen_owner_conf[hen_label] = 0.25
                    self.hen_owner_last_frame[hen_label] = current_frame

        # Resolve active bird labels, enforcing 1-to-1 uniqueness in the current frame.
        if not hasattr(self, "track_last_label"):
            self.track_last_label: Dict[int, str] = {}
        if not hasattr(self, "label_owner"):
            self.label_owner: Dict[str, Tuple[int, int]] = {}
        used_labels = set()

        def _label_priority(b: TrackedDetection) -> Tuple[int, float, int]:
            if b.track_id is None:
                return (0, 0.0, 0)
            lbl = self.track_label_cache.get(b.track_id)
            if not lbl:
                return (0, 0.0, 0)
            is_incumbent = 1 if self.hen_track_owners.get(lbl) == b.track_id else 0
            sconf = self.track_saddle_conf.get(b.track_id, 0.0)
            votes = self.track_label_votes.get(b.track_id, []).count(lbl)
            return (is_incumbent, sconf, votes)

        sorted_birds = sorted(birds, key=_label_priority, reverse=True)
        for bird in sorted_birds:
            if bird.class_name != "Chicken" or bird.track_id is None:
                continue
            candidate = self.track_last_label.get(bird.track_id)
            if (
                candidate
                and bird.track_id in getattr(self, "track_tag_confirmed", set())
                and self.track_label_cache.get(bird.track_id) == candidate
                and candidate not in used_labels
            ):
                bird.bird_label = candidate
                used_labels.add(candidate)

        # Stage B applies confirmed colors and binds fixed IDs
        for bird in sorted_birds:
            if (
                bird.track_id is not None
                and bird.track_id in getattr(self, "track_tag_confirmed", set())
                and bird.track_id in self.track_label_cache
                and bird.track_id not in conflicting_track_ids
            ):
                assigned = self.track_label_cache[bird.track_id]
                if bird.bird_label != assigned:
                    if assigned not in used_labels:
                        bird.bird_label = assigned
                        used_labels.add(assigned)
                    else:
                        bird.bird_label = "Chicken"
                if bird.bird_label in HEN_TO_FIXED_ID:
                    fixed_id = HEN_TO_FIXED_ID[bird.bird_label]
                    # If another bird in the frame currently shares this fixed_id, relocate that bird to an unused ID
                    for other in birds:
                        if other is not bird and other.track_id == fixed_id:
                            used_ids = {b.track_id for b in birds if b.track_id is not None} | {1, 2, 3, 4, 5, 6}
                            cand = 1
                            while cand in used_ids:
                                cand += 1
                            other.track_id = cand
                            used_ids.add(cand)
                    old_id = bird.track_id
                    bird.track_id = fixed_id
                    if old_id != fixed_id:
                        self.track_label_cache.pop(old_id, None)
                        self.track_label_votes.pop(old_id, None)
                        self.track_tag_confirmed.discard(old_id)
                    if getattr(bird, "raw_track_id", None) is not None:
                        for prev_raw, prev_disp in list(self.short_id_map.items()):
                            if prev_disp == fixed_id and prev_raw != bird.raw_track_id:
                                self.short_id_map.pop(prev_raw, None)
                        self.short_id_map[bird.raw_track_id] = fixed_id
                    self.track_label_cache[fixed_id] = bird.bird_label
                    self.track_tag_confirmed.add(fixed_id)
                    self.hen_track_owners[bird.bird_label] = fixed_id
                    self.hen_owner_last_frame[bird.bird_label] = current_frame
            elif bird.class_name == "Chicken":
                # Continuous identity protection: if this track was previously confirmed as a Hen, retain it!
                prev_lbl = self.track_last_label.get(bird.track_id)
                if (
                    bird.track_id not in conflicting_track_ids
                    and bird.track_id in getattr(self, "track_tag_confirmed", set())
                    and self.track_label_cache.get(bird.track_id) == prev_lbl
                    and prev_lbl in HEN_TO_FIXED_ID
                    and prev_lbl not in used_labels
                ):
                    bird.bird_label = prev_lbl
                    bird.track_id = HEN_TO_FIXED_ID[prev_lbl]
                    used_labels.add(prev_lbl)
                else:
                    bird.bird_label = "Chicken"

        # ------------------------------------------------------------------
        # Confirmed Hen Identity Inheritance for Walking / Occluded Birds
        # When a confirmed hen (e.g. H5 YellowGreen) is active in the flock but its
        # ByteTrack track drops or branches while walking without a saddle visible
        # in this single frame, transfer the confirmed hen identity to the nearest
        # unassigned chicken so it never reverts to Chicken (Unidentified).
        # ------------------------------------------------------------------
        unassigned_confirmed_hens = []
        confirmed_tags = getattr(self, "track_tag_confirmed", set())
        for hen_lbl, fixed_id in HEN_TO_FIXED_ID.items():
            if hen_lbl in used_labels:
                continue
            if fixed_id not in confirmed_tags and hen_lbl not in confirmed_tags:
                continue
            last_frame = self.hen_owner_last_frame.get(hen_lbl, 0)
            if last_frame > 0 and (current_frame - last_frame) <= 15:
                pos_info = self.short_track_positions.get(fixed_id)
                hen_pos = pos_info[0] if pos_info is not None else None
                unassigned_confirmed_hens.append((hen_lbl, fixed_id, last_frame, hen_pos))

        if unassigned_confirmed_hens:
            unassigned_chickens = [
                b for b in birds
                if b.class_name == "Chicken" and b.bird_label == "Chicken"
            ]
            if unassigned_chickens:
                inheritance_candidates = []
                frame_diagonal = math.hypot(frame.shape[0], frame.shape[1])
                max_inherit_dist = max(50.0, frame_diagonal * 0.12)
                for hen_lbl, fixed_id, last_frame, hen_pos in unassigned_confirmed_hens:
                    hen_hist = getattr(self, "track_appearance_hist", {}).get(fixed_id)
                    vx, vy = getattr(self, "short_track_velocities", {}).get(fixed_id, (0.0, 0.0))
                    gap = max(1, current_frame - last_frame)
                    pred_pos = (
                        (hen_pos[0] + vx * min(gap, 6), hen_pos[1] + vy * min(gap, 6))
                        if hen_pos is not None
                        else None
                    )
                    for chk in unassigned_chickens:
                        cx = (chk.box[0] + chk.box[2]) / 2.0
                        cy = (chk.box[1] + chk.box[3]) / 2.0
                        if hen_pos is not None:
                            raw_dist = math.hypot(cx - hen_pos[0], cy - hen_pos[1])
                            pred_dist = math.hypot(cx - pred_pos[0], cy - pred_pos[1]) if pred_pos else raw_dist
                            dist = min(raw_dist, pred_dist)
                        else:
                            dist = 0.0
                        if hen_pos is not None and dist > max_inherit_dist:
                            continue
                        # Verify appearance consistency when histograms are available so an
                        # occluded bird's identity cannot jump onto a different coloured bird
                        chk_hist = self._extract_appearance_hist(frame, chk.box)
                        hist_sim = self._hist_similarity(hen_hist, chk_hist)
                        if hist_sim is not None and hist_sim < 0.25 and dist > 35.0:
                            continue
                        norm_dist = dist / max(max_inherit_dist, 1.0)
                        cost = norm_dist + (0.60 * (1.0 - hist_sim) if hist_sim is not None else 0.0)
                        inheritance_candidates.append((cost, dist, hen_lbl, fixed_id, chk))

                inheritance_candidates.sort(key=lambda item: (item[0], item[1]))
                matched_chickens = set()
                for _, dist, hen_lbl, fixed_id, chk in inheritance_candidates:
                    if hen_lbl in used_labels or id(chk) in matched_chickens:
                        continue
                    chk.bird_label = hen_lbl
                    old_id = chk.track_id
                    chk.track_id = fixed_id
                    used_labels.add(hen_lbl)
                    matched_chickens.add(id(chk))
                    if old_id != fixed_id:
                        self.track_label_cache.pop(old_id, None)
                        self.track_label_votes.pop(old_id, None)
                        self.track_tag_confirmed.discard(old_id)
                    if getattr(chk, "raw_track_id", None) is not None:
                        for prev_raw, prev_disp in list(self.short_id_map.items()):
                            if prev_disp == fixed_id and prev_raw != chk.raw_track_id:
                                self.short_id_map.pop(prev_raw, None)
                        self.short_id_map[chk.raw_track_id] = fixed_id
                    self.track_label_cache[fixed_id] = hen_lbl
                    self.track_tag_confirmed.add(fixed_id)
                    self.hen_track_owners[hen_lbl] = fixed_id
                    self.hen_owner_last_frame[hen_lbl] = current_frame
                    self.short_track_positions[fixed_id] = (
                        ((chk.box[0] + chk.box[2]) / 2.0, (chk.box[1] + chk.box[3]) / 2.0),
                        current_frame,
                    )

        # Enforce strict single Rooster per frame: only the highest-confidence Rooster
        # keeps ID 6 ("Rooster"); any lower-confidence duplicate Rooster in the same
        # frame is demoted to "Chicken" so it never steals or duplicates ID 6.
        rooster_candidates = [b for b in birds if b.class_name == "Rooster"]
        if rooster_candidates:
            chicken_cls_id = next(
                (k for k, v in self.class_map.items() if v == "Chicken"), 0
            )
            winner_rooster = max(
                rooster_candidates,
                key=lambda b: (float(b.confidence), 1 if b.track_id == 6 else 0),
            )
            for bird in rooster_candidates:
                if bird is winner_rooster:
                    bird.bird_label = "Rooster"
                    for other in birds:
                        if other is not bird and other.track_id == 6:
                            used_ids = {b.track_id for b in birds if b.track_id is not None} | {1, 2, 3, 4, 5, 6}
                            cand = 7
                            while cand in used_ids:
                                cand += 1
                            other.track_id = cand
                    bird.track_id = 6
                    if getattr(bird, "raw_track_id", None) is not None:
                        for prev_raw, prev_disp in list(self.short_id_map.items()):
                            if prev_disp == 6 and prev_raw != bird.raw_track_id:
                                self.short_id_map.pop(prev_raw, None)
                        self.short_id_map[bird.raw_track_id] = 6
                else:
                    bird.class_name = "Chicken"
                    bird.class_id = chicken_cls_id
                    bird.bird_label = "Chicken"
                    if bird.track_id == 6:
                        bird.track_id = None

        used_display_ids = {
            bird.track_id
            for bird in birds
            if bird.class_name == "Rooster" or bird.bird_label in HEN_TO_FIXED_ID
        }
        for bird in birds:
            if bird.class_name == "Chicken" and bird.bird_label == "Chicken":
                tracking_id = bird.track_id
                display_id = self._unidentified_id_map.get(tracking_id)
                if display_id is None or display_id in used_display_ids:
                    display_id = ANIMAL_TO_FIXED_ID["Chicken"]
                    while display_id in used_display_ids:
                        display_id += 1
                    if tracking_id is not None:
                        self._unidentified_id_map[tracking_id] = display_id
                bird.track_id = display_id
                used_display_ids.add(display_id)

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
                if bird.bird_label in HEN_TO_FIXED_ID:
                    bird.track_id = HEN_TO_FIXED_ID[bird.bird_label]
                self.track_last_label[bird.track_id] = bird.bird_label
                self.track_label_last_seen[bird.track_id] = self.processed_frame_count
                self.hen_owner_last_frame[bird.bird_label] = self.processed_frame_count
                self.label_owner[bird.bird_label] = (bird.track_id, self.processed_frame_count)

        # Reclaim identities of tracks that are inactive
        stale = [
            tid for tid in list(self.track_last_label)
            if tid not in active_tids
            and self.processed_frame_count - self.track_label_last_seen.get(tid, 0) > self.REIDENTIFICATION_MAX_GAP_FRAMES
        ]
        for tid in stale:
            label = self.track_last_label.pop(tid, None)
            if label is not None and self.label_owner.get(label, (None, 0))[0] == tid:
                self.label_owner.pop(label, None)

        # Stationary equipment persistence: if ByteTrack dropped Feeder or Drinker,
        # inspect frame with predict or use cached positions
        if len(feeders) == 0 or len(drinkers) == 0:
            try:
                equip_res = getattr(self, "_equip_model", self.model).predict(
                    frame,
                    conf=getattr(self, "MIN_EQUIPMENT_CONFIDENCE", 0.15),
                    iou=self.iou,
                    imgsz=self.imgsz,
                    device=self.device,
                    verbose=False,
                )[0]
                if equip_res.boxes is not None and len(equip_res.boxes) > 0:
                    e_boxes = equip_res.boxes.xyxy.cpu().numpy()
                    e_confs = equip_res.boxes.conf.cpu().numpy()
                    e_classes = equip_res.boxes.cls.int().cpu().tolist()
                    for e_box, e_conf, e_cls in zip(e_boxes, e_confs, e_classes):
                        e_name = self.class_map.get(e_cls, f"class_{e_cls}")
                        if e_name == "Feeder" and len(feeders) == 0:
                            x1, y1, x2, y2 = [int(v) for v in e_box]
                            feeders.append(TrackedDetection(
                                box=[x1, y1, x2, y2],
                                centroid=((x1 + x2) // 2, (y1 + y2) // 2),
                                confidence=float(e_conf),
                                class_id=e_cls,
                                class_name="Feeder",
                                track_id=None,
                                bird_label="Feeder",
                            ))
                        elif e_name == "Drinker" and len(drinkers) == 0:
                            x1, y1, x2, y2 = [int(v) for v in e_box]
                            drinkers.append(TrackedDetection(
                                box=[x1, y1, x2, y2],
                                centroid=((x1 + x2) // 2, (y1 + y2) // 2),
                                confidence=float(e_conf),
                                class_id=e_cls,
                                class_name="Drinker",
                                track_id=None,
                                bird_label="Drinker",
                            ))
            except Exception as exc:
                pass  # Equipment detection failure is non-fatal

        if feeders:
            self.cached_feeders = list(feeders)
        elif getattr(self, "cached_feeders", None):
            feeders = list(self.cached_feeders)

        if drinkers:
            self.cached_drinkers = list(drinkers)
        elif getattr(self, "cached_drinkers", None):
            drinkers = list(self.cached_drinkers)

        if len(feeders) == 0 or len(drinkers) == 0:
            try:
                cv_feeder, cv_drinker = detect_pen_equipment(
                    frame,
                    [f.box for f in feeders],
                    [d.box for d in drinkers],
                )
                if len(feeders) == 0 and cv_feeder is not None:
                    f_box, f_conf = cv_feeder
                    feeders.append(TrackedDetection(
                        box=f_box,
                        centroid=((f_box[0] + f_box[2]) // 2, (f_box[1] + f_box[3]) // 2),
                        confidence=f_conf,
                        class_id=2,
                        class_name="Feeder",
                        track_id=None,
                        bird_label="Feeder",
                    ))
                    self.cached_feeders = list(feeders)
                if len(drinkers) == 0 and cv_drinker is not None:
                    d_box, d_conf = cv_drinker
                    drinkers.append(TrackedDetection(
                        box=d_box,
                        centroid=((d_box[0] + d_box[2]) // 2, (d_box[1] + d_box[3]) // 2),
                        confidence=d_conf,
                        class_id=1,
                        class_name="Drinker",
                        track_id=None,
                        bird_label="Drinker",
                    ))
                    self.cached_drinkers = list(drinkers)
            except Exception:
                pass

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
        """Draws bounding boxes, track IDs, saddle anchors, and a detection HUD onto a copy of the frame."""
        vis = frame.copy()
        height, width = vis.shape[:2]

        identified_hens = set()
        occupied_labels = []

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

            # Draw primary bounding box according to saddle color
            cv2.rectangle(vis, (x1, y1), (x2, y2), color, 1, cv2.LINE_AA)

            display_label = animal_display_label(label, det.track_id)
            text = f"{display_label} ({det.confidence:.2f})"
            # Compact, non-intrusive label size so neighboring chickens remain clearly visible
            font_scale = max(0.24, min(0.30, width / 2300.0))
            (text_width, text_height), baseline = cv2.getTextSize(
                text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1
            )
            while text_width + 4 > width and font_scale > 0.20:
                font_scale -= 0.02
                (text_width, text_height), baseline = cv2.getTextSize(
                    text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1
                )

            badge_width = min(width, text_width + 4)
            badge_height = text_height + baseline + 3
            label_x = min(max(0, x1), max(0, width - badge_width))
            min_label_y = min(40, max(0, height - badge_height))
            max_label_y = max(min_label_y, height - badge_height)
            candidate_tops = (y1 - badge_height - 2, y2 + 2, y1 + 2)
            label_rect = None
            best_overlap = None
            for candidate_top in candidate_tops:
                label_y = min(max(min_label_y, candidate_top), max_label_y)
                candidate_rect = (
                    label_x,
                    label_y,
                    label_x + badge_width,
                    label_y + badge_height,
                )
                overlap = sum(
                    max(0, min(candidate_rect[2], existing[2]) - max(candidate_rect[0], existing[0]))
                    * max(0, min(candidate_rect[3], existing[3]) - max(candidate_rect[1], existing[1]))
                    for existing in occupied_labels
                )
                if overlap == 0:
                    label_rect = candidate_rect
                    break
                if best_overlap is None or overlap < best_overlap[0]:
                    best_overlap = (overlap, candidate_rect)

            if label_rect is None:
                label_rect = best_overlap[1]
            occupied_labels.append(label_rect)
            label_x, label_y, label_right, label_bottom = label_rect
            cv2.rectangle(vis, (label_x, label_y), (label_right, label_bottom), color, -1)
            ink = (0, 0, 0) if sum(color) > 400 else (255, 255, 255)
            cv2.putText(
                vis,
                text,
                (label_x + 2, label_y + text_height + 1),
                cv2.FONT_HERSHEY_SIMPLEX,
                font_scale,
                ink,
                1,
                cv2.LINE_AA,
            )

            # Compact saddle anchor indicator on the dorsal/back region
            if is_identified_hen:
                cx = (x1 + x2) // 2
                cy_saddle = max(0, y1 + int((y2 - y1) * 0.45))
                cv2.circle(vis, (cx, cy_saddle), 3, (20, 24, 30), -1, cv2.LINE_AA)
                cv2.circle(vis, (cx, cy_saddle), 2, color, -1, cv2.LINE_AA)

        def _bird_label_priority(detection: TrackedDetection):
            label = detection.bird_label or detection.class_name
            return (label == "Rooster" or label.startswith("Hen"), detection.confidence)

        for bird in sorted(frame_out.birds, key=_bird_label_priority, reverse=True):
            _draw(bird, "Chicken")
        for feeder in frame_out.feeders:
            _draw(feeder, "Feeder")
        for drinker in frame_out.drinkers:
            _draw(drinker, "Drinker")

        # Slim top HUD bar
        overlay = vis.copy()
        cv2.rectangle(overlay, (0, 0), (width, 24), (15, 20, 28), -1)
        cv2.addWeighted(overlay, 0.85, vis, 0.15, 0, vis)

        # Build fixed hen roster indicator.
        tag_status = []
        for hen_key, short_code in [
            ("Hen1 (Yellow)", "Y"),
            ("Hen2 (Blue)", "B"),
            ("Hen3 (Red)", "R"),
            ("Hen4 (White)", "W"),
            ("Hen5 (YellowGreen)", "YG"),
        ]:
            tag_status.append(
                f"{short_code}:[OK]" if hen_key in identified_hens else f"{short_code}:-"
            )
        tag_str = " ".join(tag_status)

        hud_left = (
            f"FRAME {frame_out.frame_idx} | BIRDS: {len(frame_out.birds)} | "
            f"HENS SADDLED: {len(identified_hens)}/5 ({tag_str})"
        )
        cv2.putText(vis, hud_left, (8, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 255, 255), 1, cv2.LINE_AA)
        return vis
