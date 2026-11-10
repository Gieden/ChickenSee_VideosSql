"""
edge/detector.py - Production-grade YOLO26n Inference & Poultry Re-ID Engine.
Optimized for continuous 12-hour operation on Dell OptiPlex edge hardware.

Pipeline (see docs/TRACKING_REID_ALGORITHM.md for the full flowchart):

    frame -> YOLO.track(ByteTrack) -> per-detection band evidence -> temporal band vote
          -> ByteTrack ID ......................... [Spatial ID]
          -> Re-ID bank (colour + appearance) ..... [Identity ID]

The detection carries the *identity ID* as ``track_id`` so every downstream consumer
(behavior analyzer, aggregator, web UI) sees one stable ID even when ByteTrack re-spawns a
bird after an occlusion.
"""

import os
import cv2
import time
import math
import torch
import numpy as np
from typing import List, Dict, Tuple, Optional, Any
from dataclasses import dataclass, field
from ultralytics import YOLO

from .config import CONFIG, VisionConfig, tracker_type_of
from .reid import (
    BandVoteBank,
    appearance_descriptor,
    box_iou,
    box_size,
    descriptor_similarity,
    gated_candidates,
    leg_band_signature,
)
from legband import (
    BAND_CLASS_TO_HEN,
    HEN_TO_FIXED_ID,
    HEN_TO_SADDLE_TAG,
    SADDLE_CLASS_TO_HEN,
    detect_leg_band_color,
    detect_saddle_color,
    suppress_overlapping_equipment,
)


# ---------------------------------------------------------------------------
# Saddle & Leg Band HSV Ranges & Color Specifications
# ---------------------------------------------------------------------------

COLOR_MAP = {
    "Rooster":                 {"hex": "#FF0000", "rgb": (255, 0, 0),     "bgr": (0, 0, 255)},
    "Chicken":                 {"hex": "#FFA500", "rgb": (255, 165, 0),   "bgr": (0, 165, 255)},
    "Hen1 (Yellow)":           {"hex": "#FFFF00", "rgb": (255, 255, 0),   "bgr": (0, 255, 255)},
    "Saddle_Yellow(Hen1)":     {"hex": "#FFFF00", "rgb": (255, 255, 0),   "bgr": (0, 255, 255)},
    "Hen2 (Green)":            {"hex": "#00FF00", "rgb": (0, 255, 0),     "bgr": (0, 255, 0)},
    "Saddle_Green(Hen2)":      {"hex": "#00FF00", "rgb": (0, 255, 0),     "bgr": (0, 255, 0)},
    "Hen3 (Blue)":             {"hex": "#0000FF", "rgb": (0, 0, 255),     "bgr": (255, 0, 0)},
    "Saddle_Blue(Hen3)":       {"hex": "#0000FF", "rgb": (0, 0, 255),     "bgr": (255, 0, 0)},
    "Hen4 (Bluegreen)":        {"hex": "#00CED1", "rgb": (0, 206, 209),   "bgr": (209, 206, 0)},
    "Saddle_Bluegreen(Hen4)":  {"hex": "#00CED1", "rgb": (0, 206, 209),   "bgr": (209, 206, 0)},
    "Hen5 (YellowGreen)":      {"hex": "#9ACD32", "rgb": (154, 205, 50),  "bgr": (50, 205, 154)},
    "Saddle_YellowGreen(Hen5)":{"hex": "#9ACD32", "rgb": (154, 205, 50),  "bgr": (50, 205, 154)},
    # Legacy leg band colors for backward compatibility
    "Hen1 (Green)":            {"hex": "#00FF00", "rgb": (0, 255, 0),     "bgr": (0, 255, 0)},
    "Hen2 (White)":            {"hex": "#FFFFFF", "rgb": (255, 255, 255), "bgr": (255, 255, 255)},
    "Hen4 (Yellow)":           {"hex": "#FFFF00", "rgb": (255, 255, 0),   "bgr": (0, 255, 255)},
    "Hen5 (Pink)":             {"hex": "#FF69B4", "rgb": (255, 105, 180), "bgr": (180, 105, 255)},
    "Feeder":                  {"hex": "#808080", "rgb": (128, 128, 128), "bgr": (128, 128, 128)},
    "Drinker":                 {"hex": "#808080", "rgb": (128, 128, 128), "bgr": (128, 128, 128)},
    "Default":                 {"hex": "#808080", "rgb": (128, 128, 128), "bgr": (128, 128, 128)},
}

# Lower HSV half of the white feathers around the feet -- used only to VETO a white band.
WHITE_FEATHER_HSV_LOWER = (0, 0, 150)
WHITE_FEATHER_HSV_UPPER = (180, 40, 235)


@dataclass
class Detection:
    box: List[int]                # [x1, y1, x2, y2]
    track_id: Optional[int]       # Stable poultry identity ID (survives ByteTrack ID switches)
    label: str                    # e.g., "Rooster", "Hen1 (Green)", "Feeder"
    confidence: float             # Model detection confidence
    type: str                     # "rooster" | "hen" | "infrastructure"
    centroid: Tuple[int, int]     # (cx, cy)
    color_hex: str
    color_bgr: Tuple[int, int, int]
    raw_cls_id: int = 0

    # Re-ID diagnostics (optional, defaulted so existing constructors keep working)
    raw_track_id: Optional[int] = None   # ByteTrack association ID before Re-ID merging
    identity_source: str = ""            # "band_vote" | "reid_band" | "reid_appearance" | "new_track"
    reid_score: float = 0.0              # Re-ID match confidence when identity_source startswith "reid"


@dataclass
class FrameInferenceResult:
    frame_idx: int
    timestamp: float
    detections: List[Detection] = field(default_factory=list)
    birds: List[Detection] = field(default_factory=list)
    infrastructure: List[Detection] = field(default_factory=list)
    total_birds: int = 0
    roosters: int = 0
    hens_identified: int = 0
    unidentified_chickens: int = 0
    fps: float = 0.0
    inference_time_ms: float = 0.0


@dataclass
class _BirdRecord:
    """Everything the engine knows about one physical bird at the end of a frame."""

    identity_id: int
    raw_track_id: Optional[int]
    cls_id: int
    class_name: str
    work_box: List[float]          # detection box in inference space
    orig_box: List[float]          # detection box in original frame space
    confidence: float
    velocity: Tuple[float, float]  # px/frame (inference space)
    descriptor: Optional[np.ndarray]
    band_box: Optional[Tuple[int, int, int, int]]  # absolute box, original frame space
    identity_source: str = ""
    reid_score: float = 0.0


class PoultryInferenceEngine:
    """
    High-performance Edge YOLO26n inference and ByteTrack manager.
    Designed for resource-constrained Dell OptiPlex edge deployment.
    """

    # --- Temporal band voting -------------------------------------------------
    BAND_VOTE_WEIGHT = 1.0       # per HSV observation
    BAND_YOLO_WEIGHT = 3.0       # a YOLO leg-band box is decisive
    BAND_LOCK_VOTES = 3.0        # mass required before a colour identity is shown
    BAND_LOCK_RATIO = 0.70       # winner must hold >= 70% of the vote mass
    BAND_SWITCH_MARGIN = 2.0     # challenger needs +2 votes to steal a locked identity
    VOTE_DECAY = 0.92            # per-frame exponential forgetting of band votes
    BAD_BAND_TTL = 8             # frames a wrong band label is blocked for
    WHITE_VETO_DOMINANCE = 0.55  # white cluster needed for the white feather veto

    # --- Identity (Re-ID) bank ------------------------------------------------
    IDENTITY_BUFFER_S = 3.0      # identity stays re-acquirable for N seconds after last seen
    REID_BAND_BONUS = 0.35       # same colour class + plausible motion
    REID_ACQUIRE_BONUS = 0.20    # same colour class + newly spawned (never labelled) ByteTrack ID
    WEAK_COLOUR_BONUS = 0.15     # unlabelled detection, weak single-frame band colour
    APPEARANCE_MIN = 0.55        # minimum cosine similarity (same colour / unknown colour)
    REID_MATCH_MIN = 0.45        # minimum total score to accept a Re-ID match
    SIZE_TOLERANCE = 0.45

    def __init__(self, vision_config: Optional[VisionConfig] = None):
        self.cfg = vision_config or CONFIG.vision

        # 0. Register the poultry-tuned ByteTrack variant (no-op if config uses stock bytetrack)
        try:
            from .tracker import register_tracker
            register_tracker()
        except Exception as exc:  # pragma: no cover
            print(f"[ENGINE] Custom tracker registration skipped: {exc}")

        # 1. Hardware Detection & Threading Optimization for OptiPlex
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        if self.device == "cpu":
            num_threads = min(self.cfg.num_cpu_threads, os.cpu_count() or 4)
            torch.set_num_threads(num_threads)
            print(f"[ENGINE] Hardware: Dell OptiPlex CPU mode ({num_threads} threads configured)")
        else:
            gpu_name = torch.cuda.get_device_name(0)
            print(f"[ENGINE] Hardware: CUDA GPU accelerated ({gpu_name})")

        # 2. Model Loading
        model_path = self.cfg.model_path
        if not os.path.isfile(model_path):
            raise FileNotFoundError(f"[ENGINE] Model weights not found at: {model_path}")

        print(f"[ENGINE] Loading custom poultry weights: {model_path}")
        self.model = YOLO(model_path)
        self.class_names = self.model.names if hasattr(self.model, "names") else {}
        print(f"[ENGINE] Classes loaded ({len(self.class_names)}): {self.class_names}")

        # 3. Tracker Configuration
        tracker_path = self.cfg.tracker_config
        if not os.path.isfile(tracker_path):
            print(f"[ENGINE] Tracker config '{tracker_path}' not found on disk, using built-in 'bytetrack.yaml'")
            self.tracker_file = "bytetrack.yaml"
        else:
            self.tracker_file = tracker_path
            print(
                f"[ENGINE] Using custom poultry tracker config: {self.tracker_file} "
                f"(tracker_type='{tracker_type_of(tracker_path)}')"
            )
        self.max_held_prediction_frames = 2
        self.use_purple_tracker = not bool(getattr(self.cfg, "use_ultralytics_tracker", False))
        self.configured_tracker_type = tracker_type_of(tracker_path)
        if self.use_purple_tracker:
            print(
                "[ENGINE] Association: PurpleTracker (ByteTrack forward pass + right-to-left centroid "
                "reverse pass, shared IDs). Set USE_ULTRALYTICS_TRACKER=1 for the YAML 'agribytetrack'."
            )

        # 4. State Management & Memory Safe History
        self.frame_count = 0
        self._reset_state()
        self.identity_buffer_frames = self._seconds_to_frames(self.cfg.reid_max_gap_s, self.IDENTITY_BUFFER_S)
        self.appearance_min = float(getattr(self.cfg, "reid_appearance_min", self.APPEARANCE_MIN) or self.APPEARANCE_MIN)
        self.iou_gate = float(getattr(self.cfg, "reid_iou_gate", 0.05))

        # Edge memory hygiene
        self.max_inactive_frames = 300  # ~20 seconds at 15 FPS

        # 5. Warm-up inference
        self._warmup()

    # ------------------------------------------------------------------
    # State helpers
    # ------------------------------------------------------------------
    def _reset_state(self) -> None:
        """Initialise (or wipe) the per-run identity memory."""
        self.track_identities: Dict[int, int] = {}          # ByteTrack id -> identity id
        self.identity_last_seen: Dict[int, int] = {}        # identity id -> frame idx
        self.identity_centroids: Dict[int, Tuple[float, float]] = {}
        self.identity_descriptors: Dict[int, np.ndarray] = {}
        self.identity_lock_frame: Dict[int, int] = {}
        self.identity_visible: set = set()                  # identities already shown this frame
        self.band_banks: Dict[int, BandVoteBank] = {}       # identity id -> vote bank
        self.band_last_box: Dict[int, Tuple[int, int, int, int]] = {}
        self.bad_bands: Dict[Tuple[int, str], int] = {}     # (track, label) -> frame banned
        self.track_boxes: Dict[int, List[float]] = {}       # ByteTrack id -> last work-space box
        self.track_velocity: Dict[int, Tuple[float, float]] = {}
        self.track_last_frame: Dict[int, int] = {}
        self.smoothed_boxes: Dict[int, List[float]] = {}    # identity id -> displayed box
        self._next_identity_id = 1
        self.cumulative_seen_ids = set()
        self.last_frame_shape: Tuple[int, int] = (0, 0)

    def _effective_fps(self) -> float:
        """Best available FPS: stream-reported (pipeline) > SOURCE_FPS_HINT > 20."""
        for candidate in (getattr(self.cfg, "source_fps", 0.0), getattr(self.cfg, "source_fps_hint", 0.0)):
            try:
                value = float(candidate or 0.0)
            except (TypeError, ValueError):
                value = 0.0
            if value > 0:
                return value
        return 20.0

    def _seconds_to_frames(self, configured_fps: Optional[float], seconds: float) -> int:
        fps = float(configured_fps or 0.0) or self._effective_fps()
        return max(15, int(round(max(0.5, seconds) * max(1.0, fps))))

    def set_source_fps(self, fps: float) -> None:
        """Called by the pipeline when the stream reports its FPS (re-sizes the Re-ID windows)."""
        try:
            fps = float(fps or 0.0)
        except (TypeError, ValueError):
            return
        if fps <= 0:
            return
        self.cfg.source_fps = fps
        self.identity_buffer_frames = self._seconds_to_frames(fps, self.cfg.reid_max_gap_s or self.IDENTITY_BUFFER_S)

    def _warmup(self):
        """Warm up model graph to prevent first-frame latency spike."""
        try:
            dummy = np.zeros((self.cfg.inference_size, self.cfg.inference_size, 3), dtype=np.uint8)
            with torch.inference_mode():
                self.model(dummy, verbose=False, imgsz=self.cfg.inference_size)
            print("[ENGINE] Inference engine warmed up successfully.")
        except Exception as e:
            print(f"[ENGINE] Warm-up notice: {e}")

    def _prune_expired_tracks(self):
        """Memory-safe LRU eviction: prevents dictionary bloating over 12-hour continuous runs."""
        cutoff = self.frame_count - self.max_inactive_frames
        expired_ids = [iid for iid, seen in self.identity_last_seen.items() if seen < cutoff]
        for iid in expired_ids:
            self.identity_last_seen.pop(iid, None)
            self.identity_centroids.pop(iid, None)
            self.identity_descriptors.pop(iid, None)
            self.identity_lock_frame.pop(iid, None)
            self.band_banks.pop(iid, None)
            self.band_last_box.pop(iid, None)
            self.smoothed_boxes.pop(iid, None)

        stale_tracks = [tid for tid, seen in self.track_last_frame.items() if seen < cutoff]
        for tid in stale_tracks:
            self.track_identities.pop(tid, None)
            self.track_boxes.pop(tid, None)
            self.track_velocity.pop(tid, None)
            self.track_last_frame.pop(tid, None)

        if self.frame_count % 300 == 0:
            self.bad_bands = {
                key: frame for key, frame in self.bad_bands.items()
                if self.frame_count - frame < 50
            }

        if len(self.identity_last_seen) > 5000:  # hard safety valve for very long shifts
            oldest = sorted(self.identity_last_seen, key=self.identity_last_seen.get)[:1000]
            for iid in oldest:
                self.identity_last_seen.pop(iid, None)
                self.identity_centroids.pop(iid, None)
                self.identity_descriptors.pop(iid, None)
                self.identity_lock_frame.pop(iid, None)
                self.band_banks.pop(iid, None)
                self.band_last_box.pop(iid, None)
                self.smoothed_boxes.pop(iid, None)

    # ------------------------------------------------------------------
    # Identity bookkeeping
    # ------------------------------------------------------------------
    def _identity_label(self, identity_id: Optional[int]) -> str:
        """Confirmed (locked) colour identity, or "Chicken" while still ambiguous."""
        bank = self.band_banks.get(identity_id) if identity_id is not None else None
        return bank.locked_label if bank is not None and bank.locked_label else "Chicken"

    def _identity_hypothesis(self, identity_id: int) -> Optional[str]:
        """Leading colour even before it is locked -- evidence for Re-ID only, never displayed."""
        bank = self.band_banks.get(identity_id)
        if bank is None:
            return None
        return bank.locked_label or bank.pending_label()

    def _new_identity(self) -> int:
        identity_id = self._next_identity_id
        self._next_identity_id += 1
        self.cumulative_seen_ids.add(identity_id)
        return identity_id

    def _prune_seen(self, seen: set) -> None:
        for identity_id in list(seen):
            if identity_id not in self.identity_last_seen:
                seen.discard(identity_id)

    # ------------------------------------------------------------------
    # Band evidence
    # ------------------------------------------------------------------
    @staticmethod
    def _white_feather_dominant(frame: np.ndarray, band_box) -> bool:
        h, w = frame.shape[:2]
        x1, y1, x2, y2 = band_box
        pad_x, pad_y = int((x2 - x1) * 0.75) + 2, int((y2 - y1) * 0.75) + 2
        rx1, ry1 = max(0, x1 - pad_x), max(0, y1 - pad_y)
        rx2, ry2 = min(w, x2 + pad_x), min(h, y2 + pad_y)
        if rx2 <= rx1 or ry2 <= ry1:
            return False
        roi = frame[ry1:ry2, rx1:rx2]
        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(
            hsv,
            np.asarray(WHITE_FEATHER_HSV_LOWER, dtype=np.uint8),
            np.asarray(WHITE_FEATHER_HSV_UPPER, dtype=np.uint8),
        )
        return float(np.count_nonzero(mask)) / float(mask.size) >= PoultryInferenceEngine.WHITE_VETO_DOMINANCE

    # ------------------------------------------------------------------
    # Re-ID association
    # ------------------------------------------------------------------
    def _reid_candidates(
        self,
        record: _BirdRecord,
        is_new_track: bool,
        observed_label: Optional[str],
    ) -> List[Tuple[float, int, str]]:
        """
        Score every parked identity against a ByteTrack track that has no identity yet.

        Gate 1 (spatial)      : IoU / predicted-centre radius / body size
        Gate 2 (temporal)     : identity must be younger than the Re-ID buffer
        Gate 3 (appearance)   : colour class agreement, or appearance similarity
                                when the colours are the same / not yet visible
        """
        scored: List[Tuple[float, int, str]] = []
        for identity_id, centroid in self.identity_centroids.items():
            if identity_id in self.identity_visible:
                continue
            last_seen = self.identity_last_seen.get(identity_id, 0)
            if self.frame_count - last_seen > self.identity_buffer_frames:
                continue
            if not self.cfg.reid_max_gap_s > 0:
                continue

            box = record.work_box
            cx, cy = (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0
            distance = math.dist((cx, cy), centroid)
            overlap = box_iou(box, self.track_boxes.get(record.raw_track_id, box))
            if overlap < self.iou_gate and distance > box_size(box) * 2.0:
                continue
            if record.raw_track_id is not None:
                size_ref = box_size(self.track_boxes.get(record.raw_track_id, box))
                if abs(box_size(box) - size_ref) / max(size_ref, 1.0) > self.SIZE_TOLERANCE:
                    continue

            expected_label = self._identity_label(identity_id)
            hypothesis = self._identity_hypothesis(identity_id)
            same_colour = observed_label is not None and observed_label == hypothesis
            appearance = descriptor_similarity(record.descriptor, self.identity_descriptors.get(identity_id))

            score = 0.0
            source = "reid_appearance"
            if same_colour:
                score += self.REID_BAND_BONUS
                source = "reid_band"
            elif observed_label is not None and hypothesis is not None:
                continue  # two different, confident colours can never be the same bird
            elif expected_label != "Chicken":
                if appearance < self.appearance_min:
                    continue
                score += self.REID_BAND_BONUS * appearance
                source = "reid_band"

            if is_new_track and expected_label != "Chicken":
                score += self.REID_ACQUIRE_BONUS
            if expected_label == "Chicken" and observed_label is None:
                if appearance < max(self.appearance_min - 0.15, 0.25):
                    continue
            if appearance > 0:
                score += 0.25 * appearance

            closeness = max(0.0, 1.0 - (self.frame_count - last_seen) / max(1, self.identity_buffer_frames))
            score += 0.15 * closeness

            if score >= self.REID_MATCH_MIN:
                scored.append((score, identity_id, source))

        scored.sort(key=lambda item: item[0], reverse=True)
        return scored

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------
    def process_frame(self, frame: np.ndarray, timestamp: Optional[float] = None) -> FrameInferenceResult:
        """
        Process a single video frame: detection, tracking, poultry Re-ID, and output formatting.
        """
        self.frame_count += 1
        if timestamp is None:
            timestamp = time.time()

        t_start = time.perf_counter()

        if frame is None or not isinstance(frame, np.ndarray) or frame.size == 0:
            return FrameInferenceResult(frame_idx=self.frame_count, timestamp=timestamp)

        orig_h, orig_w = frame.shape[:2]
        self.last_frame_shape = (orig_h, orig_w)

        # Input downscaling for OptiPlex speed if needed
        work_frame = frame
        scale_w = 1.0
        scale_h = 1.0
        if self.cfg.target_width and orig_w > self.cfg.target_width:
            target_h = int(orig_h * (self.cfg.target_width / orig_w))
            work_frame = cv2.resize(frame, (self.cfg.target_width, target_h), interpolation=cv2.INTER_AREA)
            scale_w = orig_w / self.cfg.target_width
            scale_h = orig_h / target_h

        # ------------------------------------------------------------------
        # 1. YOLO inference + PurpleTracker association
        #    Pass 1: ByteTrack "alphabetically"  (detections sorted by x1, left -> right)
        #    Pass 2: same tracks, right -> left, matched by predicted centroid distance
        #    Both passes share one track pool, so an ID born on the left edge is also claimed
        #    by the same bird walking in from the right edge.
        #    Opt-in: USE_ULTRALYTICS_TRACKER=1 -> model.track(bytetrack_poultry.yaml/agribytetrack).
        # ------------------------------------------------------------------
        try:
            with torch.inference_mode():
                if self.use_purple_tracker:
                    class _OrderedSubset:
                        """Minimal detection container (conf/cls/xyxy...) for PurpleTracker passes."""

                        def __init__(self, boxes_obj, indexer):
                            self._source = boxes_obj
                            self._idx = list(indexer)

                        def __len__(self):
                            return len(self._idx)

                        def __getitem__(self, item):
                            return self._source[item]

                        def __getattr__(self, name):
                            if name.startswith("_"):
                                raise AttributeError(name)
                            base = getattr(self._source, name)
                            if hasattr(base, "__getitem__") and not isinstance(base, (str, bytes)):
                                return base[self._idx]
                            return base

                    # Everything below is the vendored PurpleTracker path: two ordered
                    # ByteTrack passes joined by an average assignment, not two independent calls.
                    # NB: plain model.predict() never instantiates a tracker, so the two
                    # ordered passes are driven through Ultralytics' track() entry point.
                    det = self.model.track(
                        work_frame,
                        persist=True,
                        tracker=self.tracker_file,
                        verbose=False,
                        conf=self.cfg.conf_threshold,
                        iou=self.cfg.iou_threshold,
                        agnostic_nms=False,
                        imgsz=self.cfg.inference_size,
                        device=self.device,
                    )[0]
                    tracker = getattr(self.model.predictor, "trackers", [None])[0]
                    if tracker is None or det.boxes is None or len(det.boxes) == 0:
                        results = det
                    else:
                        # Pass 1: left-to-right (primary association).
                        x1 = det.boxes.xyxy[:, 0].cpu().tolist()
                        order_fwd = sorted(range(len(x1)), key=lambda i: x1[i])
                        first = tracker.purple_update(_OrderedSubset(det.boxes, order_fwd))
                        id_of = {int(det_id): int(track_id) for track_id, det_id in first}
                        tracker._purple_fallback = id_of
                        # Pass 2: right-to-left, centroid-distance association for the matched set.
                        order_rev = list(reversed(order_fwd))
                        tracker.purple_reverse_update(_OrderedSubset(det.boxes, order_rev))
                        det.boxes.id = torch.tensor(
                            [float(id_of[i]) for i in range(len(det.boxes))],
                            dtype=torch.float32,
                        )
                        results = det
                else:
                    results = self.model.track(
                        work_frame,
                        persist=True,
                        tracker=self.tracker_file,
                        verbose=False,
                        conf=self.cfg.conf_threshold,
                        iou=self.cfg.iou_threshold,
                        agnostic_nms=False,
                        imgsz=self.cfg.inference_size,
                        device=self.device
                    )[0]
        except Exception:
            # BYVelTrak / PurpleTracker failure -> plain detection, no association
            try:
                with torch.inference_mode():
                    results = self.model(
                        work_frame,
                        verbose=False,
                        conf=self.cfg.conf_threshold,
                        iou=self.cfg.iou_threshold,
                        agnostic_nms=False,
                        imgsz=self.cfg.inference_size,
                        device=self.device
                    )[0]
            except Exception:
                return FrameInferenceResult(frame_idx=self.frame_count, timestamp=timestamp)

        infer_dur = (time.perf_counter() - t_start) * 1000.0
        fps = 1000.0 / infer_dur if infer_dur > 0 else 0.0

        infra: List[Detection] = []
        rooster_count = 0
        birds: List[Detection] = []
        detections: List[Detection] = []

        n_boxes = len(results.boxes) if results.boxes is not None else 0
        raw_birds: List[dict] = []
        saddle_raw: List[Tuple[List[float], str, Optional[int]]] = []
        band_raw: List[Tuple[List[float], str, Optional[int]]] = []
        infra_raw: List[tuple] = []

        if n_boxes:
            boxes = results.boxes.xyxy.cpu().numpy()
            confs = results.boxes.conf.cpu().numpy()
            cls_ids = results.boxes.cls.int().cpu().tolist()
            if results.boxes.id is not None:
                track_ids = results.boxes.id.int().cpu().tolist()
            else:
                # No temporal association (tracker disabled or unavailable): every detection
                # is its own short-lived track so the Re-ID bank can still carry identity.
                track_ids = [f"det:{self.frame_count}:{i}" for i in range(n_boxes)]

            for box, conf_val, cls_id, raw_tid in zip(boxes, confs, cls_ids, track_ids):
                name = self.class_names.get(cls_id, f"class_{cls_id}")
                if name in ("Chicken", "Rooster"):
                    raw_birds.append(
                        {"box": [float(v) for v in box], "conf": float(conf_val), "cls": cls_id,
                         "name": name, "raw": raw_tid}
                    )
                elif name.startswith("Saddle_Color_"):
                    saddle_raw.append(([float(v) for v in box], name, raw_tid))
                elif name.startswith("Leg_Band_"):
                    band_raw.append(([float(v) for v in box], name, raw_tid))
                elif name in ("Feeder", "Drinker"):
                    infra_raw.append((box, float(conf_val), name, raw_tid, cls_id))

        # ------------------------------------------------------------------
        # 2. Per-detection band evidence + identity resolution
        # ------------------------------------------------------------------
        self._pending_band_label: Dict[Optional[int], str] = {}
        records: List[_BirdRecord] = []
        present_raw = set()

        for bird in raw_birds:
            raw_tid = bird["raw"]
            orig_box = [bird["box"][0] * scale_w, bird["box"][1] * scale_h,
                        bird["box"][2] * scale_w, bird["box"][3] * scale_h]

            # The HSV band scan runs on odd frames only: a band colour cannot change between two
            # consecutive frames, and this is the most expensive per-bird operation in the loop.
            scan_band = bird["name"] == "Chicken" and self.frame_count % 2 == 1
            sigma = leg_band_signature(frame, orig_box) if scan_band else None
            if sigma is not None and sigma.label == "Hen2 (White)" and self._white_feather_dominant(frame, sigma.box):
                self.bad_bands[(raw_tid if raw_tid is not None else -1, sigma.label)] = self.frame_count
                sigma = None
            if sigma is not None and raw_tid is not None:
                self._pending_band_label[raw_tid] = sigma.label

            descriptor = None
            if bird["name"] == "Chicken":
                anchor = sigma.box if sigma is not None else self.band_last_box.get(
                    self.track_identities.get(raw_tid) if raw_tid is not None else None
                )
                descriptor = appearance_descriptor(frame, orig_box, anchor)

            velocity = self.track_velocity.get(raw_tid, (0.0, 0.0)) if raw_tid is not None else (0.0, 0.0)
            records.append(
                _BirdRecord(
                    identity_id=0,
                    raw_track_id=raw_tid,
                    cls_id=bird["cls"],
                    class_name=bird["name"],
                    work_box=list(bird["box"]),
                    orig_box=orig_box,
                    confidence=bird["conf"],
                    velocity=velocity,
                    descriptor=descriptor,
                    band_box=(sigma.box if sigma is not None else None),
                )
            )
            if raw_tid is not None:
                present_raw.add(raw_tid)

        for item in records:
            if item.raw_track_id is not None:
                prev = self.track_boxes.get(item.raw_track_id)
                self.track_last_frame[item.raw_track_id] = self.frame_count
                if prev is not None:
                    dx = ((item.work_box[0] + item.work_box[2]) - (prev[0] + prev[2])) / 2.0
                    dy = ((item.work_box[1] + item.work_box[3]) - (prev[1] + prev[3])) / 2.0
                    px, py = self.track_velocity.get(item.raw_track_id, (0.0, 0.0))
                    self.track_velocity[item.raw_track_id] = (0.5 * px + 0.5 * dx, 0.5 * py + 0.5 * dy)
                self.track_boxes[item.raw_track_id] = list(item.work_box)

        # 2a. Identities already attached to a live ByteTrack track
        claimed = set()
        unresolved: List[_BirdRecord] = []
        for item in records:
            iid = self.track_identities.get(item.raw_track_id) if item.raw_track_id is not None else None
            if iid is not None and iid in self.identity_last_seen and iid not in claimed:
                item.identity_id = iid
                claimed.add(iid)
            else:
                unresolved.append(item)

        # 2b. Re-ID re-acquisition for the rest (strongest evidence first)
        def _priority(item: _BirdRecord) -> float:
            return item.confidence + (0.5 if item.band_box is not None else 0.0)

        for item in sorted(unresolved, key=_priority, reverse=True):
            is_new_track = item.raw_track_id is not None and item.raw_track_id not in self.track_identities
            observed = self._pending_band_label.get(item.raw_track_id) if item.raw_track_id is not None else None
            candidates = self._reid_candidates(item, is_new_track, observed)
            chosen = next(((score, iid, src) for score, iid, src in candidates if iid not in claimed), None)
            if chosen is not None:
                score, iid, src = chosen
                item.identity_id = iid
                item.identity_source = src
                item.reid_score = round(score, 3)
                claimed.add(iid)
            else:
                item.identity_id = self._new_identity()
                item.identity_source = "new_track"
                claimed.add(item.identity_id)
            if item.raw_track_id is not None:
                self.track_identities[item.raw_track_id] = item.identity_id

        # 2c. YOLO saddle boxes -> decisive votes for the nearest chicken (dorsal region)
        for (sbox, sclass, stid) in saddle_raw:
            colour = SADDLE_CLASS_TO_HEN.get(sclass) or BAND_CLASS_TO_HEN.get(sclass)
            if not colour:
                continue
            sx1, sy1, sx2, sy2 = sbox
            scx, scy = (sx1 + sx2) / 2, (sy1 + sy2) / 2
            best, best_dist = None, None
            for item in records:
                if item.class_name != "Chicken":
                    continue
                x1, y1, x2, y2 = item.work_box
                # Upper/mid body dorsal matching
                if (x1 - 35 <= scx <= x2 + 35) and (y1 - 35 <= scy <= y2 + 35):
                    dist = abs(scx - (x1 + x2) / 2) + abs(scy - (y1 + y2) / 2)
                    if best is None or dist < best_dist:
                        best, best_dist = item, dist
            if best is not None:
                best_would_be = self.band_banks.get(best.identity_id)
                if best_would_be is None or best_would_be.locked_label in (None, colour):
                    self.band_banks.setdefault(best.identity_id, self._make_bank()).add(colour, self.BAND_YOLO_WEIGHT)

        # 2d. YOLO leg-band boxes -> decisive votes for the nearest chicken (legacy fallback)
        for (band_box, band_class, band_tid) in band_raw:
            colour = BAND_CLASS_TO_HEN.get(band_class)
            if not colour:
                continue
            bx1, by1, bx2, by2 = band_box
            bcx, bcy = (bx1 + bx2) / 2, (by1 + by2) / 2
            best, best_dist = None, None
            for item in records:
                if item.class_name != "Chicken":
                    continue
                x1, y1, x2, y2 = item.work_box
                if (x1 - 35 <= bcx <= x2 + 35) and (y1 - 35 <= bcy <= y2 + 35):
                    dist = abs(bcx - (x1 + x2) / 2)
                    if best is None or dist < best_dist:
                        best, best_dist = item, dist
            if best is not None:
                best_would_be = self.band_banks.get(best.identity_id)
                if best_would_be is None or best_would_be.locked_label in (None, colour):
                    self.band_banks.setdefault(best.identity_id, self._make_bank()).add(colour, self.BAND_YOLO_WEIGHT)

        # 2d. HSV crop evidence -> one vote (blocked if recently vetoed for that track)
        for item in records:
            track_key = item.raw_track_id if item.raw_track_id is not None else -1
            if self.frame_count % 2 == 0:
                continue
            if item.class_name == "Rooster":
                continue
            current = self._identity_label(item.identity_id)
            if current != "Chicken" and item.band_box is not None:
                continue  # already identified, keep votes stable
            source_box = (
                item.work_box[0] * scale_w,
                item.work_box[1] * scale_h,
                item.work_box[2] * scale_w,
                item.work_box[3] * scale_h,
            )
            colour = detect_leg_band_color(frame, source_box)
            if not colour:
                continue
            banned_at = self.bad_bands.get((track_key, colour))
            if banned_at is not None and self.frame_count - banned_at < self.BAD_BAND_TTL:
                continue
            self.band_banks.setdefault(item.identity_id, self._make_bank()).add(colour, self.BAND_VOTE_WEIGHT)

        # ------------------------------------------------------------------
        # 3. Construct Output Detections (1-to-1 colour identity per frame)
        # ------------------------------------------------------------------
        assigned_labels = {self._identity_label(iid) for iid in self.identity_visible}
        self.identity_visible = set()
        hens_id_count = 0
        unid_count = 0

        ordered = sorted(records, key=lambda r: (r.identity_id))
        for item in ordered:
            bank = self.band_banks.get(item.identity_id)
            if bank is not None:
                bank.decay(self.VOTE_DECAY)
            label = self._identity_label(item.identity_id)
            if item.class_name == "Rooster":
                label = "Rooster"
            elif label != "Chicken" and label in assigned_labels:
                label = "Chicken"  # duplicate colour in one frame is invalid -> generic bird
            if label != "Chicken" and label != "Rooster":
                assigned_labels.add(label)

            self.identity_visible.add(item.identity_id)

            raw_orig = item.orig_box
            x1, y1, x2, y2 = self._smooth_box(item.identity_id, raw_orig)
            if label.startswith("Hen") and item.class_name != "Rooster":
                hens_id_count += 1
            else:
                unid_count += 1

            cinfo = COLOR_MAP.get(label, COLOR_MAP["Chicken"])
            final_tid = HEN_TO_FIXED_ID.get(label, item.identity_id) if label.startswith("Hen") else item.identity_id
            det = Detection(
                box=[int(x1), int(y1), int(x2), int(y2)],
                track_id=final_tid,
                label=label,
                confidence=round(item.confidence, 3),
                type="rooster" if item.class_name == "Rooster" else "hen",
                centroid=(int((x1 + x2) / 2), int((y1 + y2) / 2)),
                color_hex=cinfo["hex"],
                color_bgr=cinfo["bgr"],
                raw_cls_id=item.cls_id,
                raw_track_id=item.raw_track_id,
                identity_source=item.identity_source,
                reid_score=item.reid_score,
            )
            detections.append(det)
            birds.append(det)
            if item.class_name == "Rooster":
                rooster_count += 1
            self.cumulative_seen_ids.add(item.identity_id)

        # ------------------------------------------------------------------
        # 4. Commit identity memory for the next frame
        # ------------------------------------------------------------------
        for item in records:
            iid = item.identity_id
            self.identity_last_seen[iid] = self.frame_count
            cx = (item.orig_box[0] + item.orig_box[2]) / 2.0
            cy = (item.orig_box[1] + item.orig_box[3]) / 2.0
            self.identity_centroids[iid] = (cx, cy)
            if item.descriptor is not None:
                alphas = self.identity_descriptors.get(iid)
                self.identity_descriptors[iid] = (
                    item.descriptor if alphas is None else 0.7 * alphas + 0.3 * item.descriptor
                )
                norm = float(np.linalg.norm(self.identity_descriptors[iid]))
                if norm > 1e-6:
                    self.identity_descriptors[iid] = self.identity_descriptors[iid] / norm
            if item.band_box is not None:
                self.band_last_box[iid] = item.band_box

        # ------------------------------------------------------------------
        # 5. Infrastructure (Feeder & Drinker)
        # ------------------------------------------------------------------
        # A feeder and a drinker must never be the same physical object: keep the higher-scoring
        # of two boxes that overlap by >= 75% IoU, then map back to the raw detections.
        keep_boxes = {
            id(entry[0])
            for entry in suppress_overlapping_equipment(
                [([float(v) for v in entry[0]], entry[1], entry[2]) for entry in infra_raw]
            )
        }
        for (ibox, conf_val, iname, _raw, cls_id) in infra_raw:
            if id(ibox) not in keep_boxes:
                continue
            x1 = int(ibox[0] * scale_w)
            y1 = int(ibox[1] * scale_h)
            x2 = int(ibox[2] * scale_w)
            y2 = int(ibox[3] * scale_h)
            cinfo = COLOR_MAP.get(iname, COLOR_MAP["Default"])
            det = Detection(
                box=[x1, y1, x2, y2],
                track_id=None,
                label=iname,
                confidence=round(float(conf_val), 3),
                type="infrastructure",
                centroid=(int((x1 + x2) / 2), int((y1 + y2) / 2)),
                color_hex=cinfo["hex"],
                color_bgr=cinfo["bgr"],
                raw_cls_id=cls_id,
            )
            detections.append(det)
            infra.append(det)

        self._prune_seen(self.identity_visible)
        self._prune_expired_tracks()

        return FrameInfere