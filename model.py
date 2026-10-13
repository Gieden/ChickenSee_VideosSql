import os
import cv2
import numpy as np
import base64
from collections import deque
from ultralytics import YOLO

# ---------------------------------------------------------------------------
# Leg Band HSV Ranges & Exact Bounding Box Colors
# ---------------------------------------------------------------------------

LEG_BAND_COLORS = {
    "Hen1 (Green)":  ([35,  80,  60],  [85,  255, 255]),
    "Hen2 (White)":  ([0,   0,   180], [180, 45,  255]),
    "Hen3 (Violet)": ([120, 80,  60],  [150, 255, 255]),
    "Hen4 (Yellow)": ([18,  90,  90],  [38,  255, 255]),
    "Hen5 (Pink)":   ([140, 70,  80],  [175, 255, 255]),
}

# Strict display colors requested:
# Rooster -> Red
# Unidentified Chicken -> Orange
# Hens -> Matched to leg band color
COLOR_MAP = {
    "Rooster":       {"hex": "#FF0000", "rgb": (255, 0, 0),     "bgr": (0, 0, 255)},
    "Chicken":       {"hex": "#FFA500", "rgb": (255, 165, 0),   "bgr": (0, 165, 255)},
    "Hen1 (Green)":  {"hex": "#00FF00", "rgb": (0, 255, 0),     "bgr": (0, 255, 0)},
    "Hen2 (White)":  {"hex": "#FFFFFF", "rgb": (255, 255, 255), "bgr": (255, 255, 255)},
    "Hen3 (Violet)": {"hex": "#8A2BE2", "rgb": (138, 43, 226),  "bgr": (226, 43, 138)},
    "Hen4 (Yellow)": {"hex": "#FFFF00", "rgb": (255, 255, 0),   "bgr": (0, 255, 255)},
    "Hen5 (Pink)":   {"hex": "#FF69B4", "rgb": (255, 105, 180), "bgr": (180, 105, 255)},
    "Default":       {"hex": "#808080", "rgb": (128, 128, 128), "bgr": (128, 128, 128)},
}

def get_bbox_color(label: str) -> dict:
    return COLOR_MAP.get(label, COLOR_MAP["Default"])


class ChickenDetector:
    def __init__(self, model_path=None):
        current_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir  = os.path.dirname(current_dir)
        
        # Check current directory first, then parent directory
        custom_candidates = [
            os.path.join(current_dir, "custom_poultry.pt"),
            os.path.join(parent_dir, "custom_poultry.pt")
        ]
        
        custom_pt = next((p for p in custom_candidates if os.path.isfile(p)), None)
        tracker_cand = [
            os.path.join(current_dir, "bytetrack_poultry.yaml"),
            os.path.join(parent_dir, "bytetrack_poultry.yaml")
        ]
        self.tracker_yaml = next((p for p in tracker_cand if os.path.isfile(p)), "bytetrack.yaml")

        if custom_pt:
            print(f"[MODEL] Loading custom poultry model: {custom_pt}")
            self.model     = YOLO(custom_pt)
            self.is_custom = True
        else:
            fallback_pt = os.path.join(current_dir, "yolo26n.pt")
            print(f"[MODEL] custom_poultry.pt not found — fallback: {fallback_pt}")
            self.model     = YOLO(fallback_pt)
            self.is_custom = False

        self.class_names = {
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

        self.current_mode     = "speed"
        self.frame_count      = 0
        self.position_history = {}
        self.track_states     = {}   # track_id -> {"label": str, "last_seen_frame": int}
        self.cumulative_count = set()
        self.ghost_tracks     = {}
        self.smoothed_boxes   = {}
        self.short_id_map     = {}
        self._next_short_id   = 1

    def set_mode(self, mode: str):
        self.current_mode = mode
        return mode

    def detect(self, frame):
        self.frame_count += 1

        if isinstance(frame, str):
            try:
                if "," in frame:
                    frame = frame.split(",")[1]
                img_bytes = base64.b64decode(frame)
                nparr     = np.frombuffer(img_bytes, np.uint8)
                frame     = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            except Exception:
                return self._empty_result()

        if frame is None or not isinstance(frame, np.ndarray):
            return self._empty_result()

        frame_h, frame_w = frame.shape[:2]
        orig_w, orig_h = frame_w, frame_h

        TARGET_W = 320
        if frame_w > TARGET_W:
            scale_r   = TARGET_W / frame_w
            target_h  = int(frame_h * scale_r)
            frame     = cv2.resize(frame, (TARGET_W, target_h), interpolation=cv2.INTER_AREA)
            frame_h, frame_w = frame.shape[:2]

        infer_sz = 640 if self.current_mode == "accuracy" else 320

        try:
            results = self.model.track(
                frame,
                persist=True,
                tracker=self.tracker_yaml,
                verbose=False,
                conf=0.03,
                iou=0.45,
                agnostic_nms=False,
                imgsz=infer_sz,
            )[0]
        except Exception:
            try:
                results = self.model(
                    frame,
                    verbose=False,
                    conf=0.03,
                    iou=0.45,
                    agnostic_nms=False,
                    imgsz=infer_sz,
                )[0]
            except Exception:
                return self._empty_result()

        n_boxes = len(results.boxes) if results.boxes is not None else 0
        if n_boxes == 0:
            return self._build_result([])

        boxes     = results.boxes.xyxy.cpu().numpy()
        confs     = results.boxes.conf.cpu().numpy()
        cls_ids   = results.boxes.cls.int().cpu().tolist()
        track_ids = (
            results.boxes.id.int().cpu().tolist()
            if results.boxes.id is not None
            else [None] * n_boxes
        )

        chicken_dets = []
        rooster_dets = []
        band_dets    = []
        infra_dets   = []

        for box, conf_val, cls_id, track_id in zip(boxes, confs, cls_ids, track_ids):
            name = self.class_names.get(cls_id, f"class_{cls_id}")

            if name == "Chicken" and float(conf_val) < 0.07:
                continue

            entry = (box, float(round(conf_val, 2)), name, track_id)

            if name == "Chicken":
                chicken_dets.append(entry)
            elif name == "Rooster":
                rooster_dets.append(entry)  # Rooster is kept separate
            elif name.startswith("Leg_Band_"):
                band_dets.append((box, name))
            elif name in ("Feeder", "Drinker"):
                infra_dets.append(entry)

        # ------------------------------------------------------------------
        # 1. Re-ID ONLY for Hens (Chickens) — Never touch Roosters!
        # ------------------------------------------------------------------
        BAND_CLASS_TO_HEN = {
            "Leg_Band_Green":  "Hen1 (Green)",
            "Leg_Band_White":  "Hen2 (White)",
            "Leg_Band_Violet": "Hen3 (Violet)",
            "Leg_Band_Yellow": "Hen4 (Yellow)",
            "Leg_Band_Pink":   "Hen5 (Pink)",
        }

        for (band_box, band_class) in band_dets:
            bx1, by1, bx2, by2 = band_box
            band_cx = (bx1 + bx2) / 2
            band_cy = (by1 + by2) / 2

            for (cbox, _, _, track_id) in chicken_dets:
                if track_id is None:
                    continue

                cx1, cy1, cx2, cy2 = cbox
                # Small expansion to catch leg bands at the bottom edge of body box
                inside_or_near = (cx1 - 10 <= band_cx <= cx2 + 10) and (cy1 - 10 <= band_cy <= cy2 + 10)
                
                if not inside_or_near:
                    continue

                color_name = BAND_CLASS_TO_HEN.get(band_class)
                if not color_name:
                    continue

                # Lock the label once recognized
                if track_id not in self.track_states or self.track_states[track_id]["label"] == "Chicken":
                    self.track_states[track_id] = {
                        "label": color_name,
                        "last_seen_frame": self.frame_count
                    }
                else:
                    self.track_states[track_id]["last_seen_frame"] = self.frame_count
                break

        # ------------------------------------------------------------------
        # 2. Strict HSV Fallback — ONLY run on unidentified Chickens
        # ------------------------------------------------------------------
        for (cbox, _, _, track_id) in chicken_dets:
            if track_id is None or (track_id in self.track_states and self.track_states[track_id]["label"] != "Chicken"):
                continue

            cx1, cy1, cx2, cy2 = cbox
            ch = cy2 - cy1
            
            # Scan STRICTLY the bottom 20% of the box (feet area only)
            scan_y1 = max(0, int(cy1 + ch * 0.80))
            scan_y2 = min(frame_h - 1, int(cy2))
            scan_x1 = max(0, int(cx1))
            scan_x2 = min(frame_w - 1, int(cx2))

            if scan_y2 <= scan_y1 or scan_x2 <= scan_x1:
                continue

            leg_crop = frame[scan_y1:scan_y2, scan_x1:scan_x2]
            if leg_crop is None or leg_crop.size == 0:
                continue

            hsv_crop = cv2.cvtColor(leg_crop, cv2.COLOR_BGR2HSV)
            best_name, best_score = None, 0

            for hen_name, (lower, upper) in LEG_BAND_COLORS.items():
                mask  = cv2.inRange(hsv_crop, np.array(lower, dtype=np.uint8), np.array(upper, dtype=np.uint8))
                score = int(cv2.countNonZero(mask))
                if score > best_score:
                    best_score = score
                    best_name  = hen_name

            # Requires at least 8 matching pixels in feet crop
            if best_name and best_score >= 8:
                self.track_states[track_id] = {
                    "label": best_name,
                    "last_seen_frame": self.frame_count
                }

        # ------------------------------------------------------------------
        # 3. Helpers & Box Output Formatting
        # ------------------------------------------------------------------
        detections = []
        box_sx = orig_w / frame_w if frame_w > 0 else 1.0
        box_sy = orig_h / frame_h if frame_h > 0 else 1.0

        def scale_box(box):
            return [box[0] * box_sx, box[1] * box_sy, box[2] * box_sx, box[3] * box_sy]

        def smooth_box(track_id, raw_box):
            if track_id is None:
                return raw_box
            if track_id not in self.smoothed_boxes:
                self.smoothed_boxes[track_id] = list(raw_box)
                return raw_box
            prev = self.smoothed_boxes[track_id]
            s = [0.4 * r + 0.6 * p for r, p in zip(raw_box, prev)]
            self.smoothed_boxes[track_id] = s
            return s

        live_ids = set()

        def short_id(raw_tid):
            if raw_tid is None:
                return None
            if raw_tid not in self.short_id_map:
                self.short_id_map[raw_tid] = self._next_short_id
                self._next_short_id += 1
            return self.short_id_map[raw_tid]

        # Process Hens / Chickens
        for (cbox, conf_val, _, track_id) in chicken_dets:
            raw = scale_box(cbox)
            x1, y1, x2, y2 = smooth_box(track_id, raw)

            if track_id is not None:
                live_ids.add(track_id)
                self.cumulative_count.add(track_id)

            display_label = "Chicken"
            if track_id is not None and track_id in self.track_states:
                display_label = self.track_states[track_id]["label"]
                self.track_states[track_id]["last_seen_frame"] = self.frame_count

            # Color determined strictly by display_label
            colors = get_bbox_color(display_label)

            det = {
                "box":        [int(x1), int(y1), int(x2), int(y2)],
                "label":      display_label,
                "confidence": conf_val,
                "track_id":   short_id(track_id),
                "type":       "hen",
                "color":      colors["hex"],
                "color_rgb":  colors["rgb"],
                "color_bgr":  colors["bgr"],
            }
            detections.append(det)

        # Process Roosters (ALWAYS forced to "Rooster" and Red box)
        for (cbox, conf_val, _, track_id) in rooster_dets:
            raw = scale_box(cbox)
            x1, y1, x2, y2 = smooth_box(track_id, raw)

            if track_id is not None:
                live_ids.add(track_id)
                self.cumulative_count.add(track_id)

            colors = get_bbox_color("Rooster")

            det = {
                "box":        [int(x1), int(y1), int(x2), int(y2)],
                "label":      "Rooster",
                "confidence": conf_val,
                "track_id":   short_id(track_id),
                "type":       "rooster",
                "color":      colors["hex"],
                "color_rgb":  colors["rgb"],
                "color_bgr":  colors["bgr"],
            }
            detections.append(det)

        # Process Infrastructure
        for (ibox, conf_val, iname, _) in infra_dets:
            x1, y1, x2, y2 = scale_box(ibox)
            colors = get_bbox_color(iname)
            detections.append({
                "box":        [int(x1), int(y1), int(x2), int(y2)],
                "label":      iname,
                "confidence": conf_val,
                "track_id":   None,
                "type":       "infrastructure",
                "color":      colors["hex"],
                "color_rgb":  colors["rgb"],
                "color_bgr":  colors["bgr"],
            })

        return self._build_result(detections)

    def _empty_result(self):
        return {
            "detections":     [],
            "total_count":    len(self.cumulative_count),
            "current_count":  0,
            "mode":           self.current_mode,
            "is_custom":      self.is_custom,
            "tracker":        "ByteTrack",
        }

    def _build_result(self, detections):
        bird_count = sum(1 for d in detections if d.get("type") in ("hen", "rooster"))
        return {
            "detections":     detections,
            "total_count":    len(self.cumulative_count),
            "current_count":  bird_count,
            "mode":           self.current_mode,
            "is_custom":      self.is_custom,
            "tracker":        "ByteTrack",
        }