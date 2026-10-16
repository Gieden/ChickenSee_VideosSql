"""
analytics/tracker.py
Ultralytics YOLO26 Nano + ByteTrack Multi-Object Tracking Engine for Dell OptiPlex.
Executes model.track(..., tracker="bytetrack.yaml", persist=True) for temporal bird tracking.
"""

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


LABEL_COLORS_BGR = {
    "Rooster": (0, 0, 255),
    "Chicken": (0, 165, 255),
    "Hen1 (Green)": (0, 255, 0),
    "Hen2 (White)": (255, 255, 255),
    "Hen3 (Blue)": (255, 0, 0),
    "Hen4 (Yellow)": (0, 255, 255),
    "Hen5 (Pink)": (180, 105, 255),
    "Feeder": (0, 0, 0),
    "Drinker": (0, 0, 0),
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

    CLASS_SWITCH_MARGIN = 3
    CLASS_HISTORY_TTL_FRAMES = 300

    def __init__(self, model_weights: Optional[str] = None, tracker_yaml: Optional[str] = None):
        self.weights_path = self._resolve_weights(model_weights or CONFIG.model_name)
        self.tracker_yaml = tracker_yaml or CONFIG.tracker_config
        self.device = CONFIG.device
        self.conf = CONFIG.conf_threshold
        self.iou = CONFIG.iou_threshold
        self.imgsz = CONFIG.imgsz

        print(f"[TRACKER] Initializing YOLO26 Nano from: {self.weights_path}")
        print(f"[TRACKER] Using ByteTrack config: {self.tracker_yaml}")
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
        self.track_class_history: Dict[int, Dict[int, Tuple[int, float]]] = {}
        self.track_resolved_classes: Dict[int, int] = {}
        self.track_class_last_seen: Dict[int, int] = {}
        self.processed_frame_count = 0

    def _record_track_label(self, track_id: int, label: str) -> None:
        last_seen = self.track_label_last_seen.get(track_id)
        votes = self.track_label_votes.setdefault(track_id, deque(maxlen=5))
        if last_seen is not None and self.processed_frame_count - last_seen > 30:
            votes.clear()
        votes.append(label)
        self.track_label_last_seen[track_id] = self.processed_frame_count
        vote_counts = Counter(votes)
        resolved_label, count = vote_counts.most_common(1)[0]
        if count >= 3:
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
            if candidate_count >= resolved_count + self.CLASS_SWITCH_MARGIN:
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

    def process_frame(self, frame: np.ndarray, frame_idx: int, fps: float = 30.0) -> TrackerFrameOutput:
        """
        Executes YOLO26 Nano inference with ByteTrack persistence.
        """
        self.processed_frame_count += 1
        self._prune_track_class_history()
        timestamp_s = frame_idx / fps if fps > 0 else 0.0

        # Run ByteTrack prediction workflow
        results = self.model.track(
            frame,
            persist=True,
            tracker=self.tracker_yaml,
            conf=self.conf,
            iou=self.iou,
            imgsz=self.imgsz,
            device=self.device,
            verbose=False
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
            cls_id, class_name, conf = self._resolve_track_class(
                cls_id, float(conf), track_id
            )
            x1, y1, x2, y2 = [int(v) for v in box]
            cx, cy = int((x1 + x2) / 2), int((y1 + y2) / 2)

            det = TrackedDetection(
                box=[x1, y1, x2, y2],
                centroid=(cx, cy),
                confidence=float(conf),
                class_id=cls_id,
                class_name=class_name,
                track_id=track_id,
                bird_label="Chicken"
            )

            if class_name in ("Chicken", "Rooster") or class_name.startswith("Hen"):
                det.bird_label = class_name
                birds.append(det)
            elif class_name == "Feeder":
                feeders.append(det)
            elif class_name == "Drinker":
                drinkers.append(det)
            elif class_name.startswith("Leg_Band_"):
                band_dets.append(([x1, y1, x2, y2], class_name))

        # Re-ID lock for leg bands if present
        for band_box, band_name in band_dets:
            bx1, by1, bx2, by2 = band_box
            bcx, bcy = (bx1 + bx2) // 2, (by1 + by2) // 2
            for bird in birds:
                if bird.track_id is None or bird.class_name == "Rooster":
                    continue
                x1, y1, x2, y2 = bird.box
                if (x1 - 15 <= bcx <= x2 + 15) and (y1 - 15 <= bcy <= y2 + 15):
                    hen_label = BAND_CLASS_TO_HEN.get(band_name)
                    if hen_label:
                        self._record_track_label(bird.track_id, hen_label)
                    break

        for bird in birds:
            if bird.track_id is None or bird.class_name == "Rooster":
                continue
            hen_label = detect_leg_band_color(frame, bird.box)
            if hen_label:
                self._record_track_label(bird.track_id, hen_label)

        for bird in birds:
            if bird.track_id is not None and bird.track_id in self.track_label_cache:
                bird.bird_label = self.track_label_cache[bird.track_id]

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
        """Draws bounding boxes, track IDs, and a detection HUD onto a copy of the frame."""
        vis = frame.copy()
        w = vis.shape[1]

        def _draw(det: TrackedDetection, fallback_name: str):
            x1, y1, x2, y2 = det.box
            label = det.bird_label if det.bird_label else det.class_name or fallback_name
            color = LABEL_COLORS_BGR.get(label, LABEL_COLORS_BGR.get(det.class_name, LABEL_COLORS_BGR["Default"]))
            cv2.rectangle(vis, (x1, y1), (x2, y2), color, 2)
            tid = f"#{det.track_id} " if det.track_id is not None else ""
            text = f"{tid}{label} ({det.confidence:.2f})"
            (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            y_text = max(th + 4, y1)
            cv2.rectangle(vis, (x1, y_text - th - 6), (x1 + tw + 6, y_text + 2), color, -1)
            ink = (0, 0, 0) if sum(color) > 400 else (255, 255, 255)
            cv2.putText(vis, text, (x1 + 3, y_text - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, ink, 1)

        for bird in frame_out.birds:
            _draw(bird, "Chicken")
        for feeder in frame_out.feeders:
            _draw(feeder, "Feeder")
        for drinker in frame_out.drinkers:
            _draw(drinker, "Drinker")

        overlay = vis.copy()
        cv2.rectangle(overlay, (0, 0), (w, 36), (20, 24, 30), -1)
        cv2.addWeighted(overlay, 0.85, vis, 0.15, 0, vis)
        hud = (
            f"FRAME {frame_out.frame_idx} | BIRDS: {len(frame_out.birds)} | "
            f"FEEDERS: {len(frame_out.feeders)} | DRINKERS: {len(frame_out.drinkers)}"
        )
        cv2.putText(vis, hud, (12, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
        return vis