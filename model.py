import os
import cv2
import numpy as np
import base64
from collections import Counter, deque
from ultralytics import YOLO
from legband import (
    BAND_CLASS_TO_HEN,
    HEN_TO_FIXED_ID,
    HEN_TO_SADDLE_TAG,
    SADDLE_CLASS_TO_HEN,
    detect_leg_band_color,
    detect_saddle_color,
    equipment_boxes_overlap,
    suppress_overlapping_equipment,
)

# Strict display colors requested:
# Rooster -> Red
# Unidentified Chicken -> Orange
# Hens -> Matched to saddle color
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

def get_bbox_color(label: str) -> dict:
    return COLOR_MAP.get(label, COLOR_MAP["Default"])


class ChickenDetector:
    def __init__(self, model_path=None):
        current_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir  = os.path.dirname(current_dir)

        custom_candidates = [
            os.path.join(current_dir, "custom_poultry.pt"),
            os.path.join(parent_dir, "custom_poultry.pt")
        ]
        tracker_cand = [
            os.path.join(current_dir, "bytetrack_poultry.yaml"),
            os.path.join(parent_dir, "bytetrack_poultry.yaml")
        ]
        self.tracker_yaml = next((p for p in tracker_cand if os.path.isfile(p)), "bytetrack.yaml")

        if model_path:
            requested_model = os.path.abspath(model_path)
            if not os.path.isfile(requested_model):
                raise FileNotFoundError(f"Model weights not found: {requested_model}")
            print(f"[MODEL] Loading requested model: {requested_model}")
            self.model = YOLO(requested_model)
            self.is_custom = os.path.basename(requested_model).lower() == "custom_poultry.pt"
        else:
            custom_pt = next((p for p in custom_candidates if os.path.isfile(p)), None)
            if custom_pt:
                print(f"[MODEL] Loading custom poultry model: {custom_pt}")
                self.model = YOLO(custom_pt)
                self.is_custom = True
            else:
                fallback_pt = os.path.join(current_dir, "yolo26n.pt")
                print(f"[MODEL] custom_poultry.pt not found — fallback: {fallback_pt}")
                self.model = YOLO(fallback_pt)
                self.is_custom = False

        self.class_names = self.model.names

        self.current_mode     = "accuracy"
        self.frame_count      = 0
        self.position_history = {}
        self.track_states     = {}   # track_id -> {"label": str, "last_seen_frame": int}
        self.track_band_votes = {}
        self.track_band_last_seen = {}
        self.cumulative_count = set()
        self.ghost_tracks     = {}
        self.smoothed_boxes   = {}
        self.short_id_map     = {}
        self._next_short_id   = 1
        self.hen_track_owners = {}
        self.hen_owner_conf   = {}
        self.hen_owner_last_frame = {}
        self.track_saddle_conf = {}

    def set_mode(self, mode: str):
        self.current_mode = mode
        return mode

    def _record_track_band_label(self, track_id, label: str) -> None:
        if track_id is None:
            return
        last_seen = self.track_band_last_seen.get(track_id)
        votes = self.track_band_votes.setdefault(track_id, deque(maxlen=8))
        if last_seen is not None and self.frame_count - last_seen > 60:
            votes.clear()
        votes.append(label)
        self.track_band_last_seen[track_id] = self.frame_count
        most_common = Counter(votes).most_common(1)
        if most_common and most_common[0][1] >= 2:
            self.track_states[track_id] = {
                "label": most_common[0][0],
                "last_seen_frame": self.frame_count,
            }

    def _prune_track_band_state(self) -> None:
        expired_states = [
            track_id
            for track_id, state in self.track_states.items()
            if self.frame_count - state["last_seen_frame"] > 300
        ]
        expired_votes = [
            track_id
            for track_id, last_seen in self.track_band_last_seen.items()
            if self.frame_count - last_seen > 300
        ]
        for track_id in expired_states:
            self.track_states.pop(track_id, None)
        for track_id in set(expired_states + expired_votes):
            self.track_band_votes.pop(track_id, None)
            self.track_band_last_seen.pop(track_id, None)

    def detect(self, frame):
        self.frame_count += 1
        self._prune_track_band_state()

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

        source_frame = frame
        frame_h, frame_w = frame.shape[:2]
        orig_w, orig_h = frame_w, frame_h

        target_width = 1088 if self.current_mode == "accuracy" else 640
        TARGET_W = target_width
        if frame_w > TARGET_W:
            scale_r   = TARGET_W / frame_w
            target_h  = int(frame_h * scale_r)
            frame     = cv2.resize(frame, (TARGET_W, target_h), interpolation=cv2.INTER_AREA)
            frame_h, frame_w = frame.shape[:2]

        infer_sz = 1088 if self.current_mode == "accuracy" else 640

        try:
            results = self.model.track(
                frame,
                persist=True,
                tracker=self.tracker_yaml,
                verbose=False,
                conf=0.15,
                iou=0.45,
                agnostic_nms=False,
                imgsz=infer_sz,
            )[0]
        except Exception:
            try:
                results = self.model(
                    frame,
                    verbose=False,
                    conf=0.15,
                    iou=0.45,
                    agnostic_nms=False,
                    imgsz=infer_sz,
                )[0]
            except Exception:
                return self._empty_result()

        inference_results = [(results, False)]
        if self.current_mode == "accuracy":
            try:
                high_resolution_result = self.model.predict(
                    frame,
                    verbose=False,
                    conf=0.15,
                    iou=0.45,
                    agnostic_nms=False,
                    imgsz=640,
                )[0]
                inference_results.append((high_resolution_result, True))
            except Exception as error:
                print(f"[MODEL WARN] High-resolution equipment pass failed: {error}")

        if not any(result.boxes is not None and len(result.boxes) for result, _ in inference_results):
            return self._build_result([])

        chicken_dets = []
        rooster_dets = []
        saddle_dets  = []
        band_dets    = []
        low_resolution_infra = []
        high_resolution_infra = []

        for result, is_high_resolution in inference_results:
            if result.boxes is None or len(result.boxes) == 0:
                continue
            boxes = result.boxes.xyxy.cpu().numpy()
            confs = result.boxes.conf.cpu().numpy()
            cls_ids = result.boxes.cls.int().cpu().tolist()
            track_ids = (
                result.boxes.id.int().cpu().tolist()
                if not is_high_resolution and result.boxes.id is not None
                else [None] * len(boxes)
            )

            for box, conf_val, cls_id, track_id in zip(boxes, confs, cls_ids, track_ids):
                name = self.class_names.get(cls_id, f"class_{cls_id}")
                entry = (box, float(round(conf_val, 2)), name, track_id)

                if is_high_resolution:
                    if name in ("Feeder", "Drinker"):
                        high_resolution_infra.append(entry)
                    continue

                if name == "Chicken":
                    chicken_dets.append(entry)
                elif name == "Rooster":
                    rooster_dets.append(entry)
                elif name.startswith("Saddle_Color_"):
                    saddle_dets.append((box, name, float(conf_val)))
                elif name.startswith("Leg_Band_"):
                    band_dets.append((box, name, float(conf_val)))
                elif name in ("Feeder", "Drinker"):
                    low_resolution_infra.append(entry)

        high_resolution_infra = suppress_overlapping_equipment(
            high_resolution_infra
        )
        infra_dets = high_resolution_infra + [
            detection
            for detection in low_resolution_infra
            if not any(
                equipment_boxes_overlap(detection[0], high_detection[0])
                for high_detection in high_resolution_infra
            )
        ]
        infra_dets = suppress_overlapping_equipment(infra_dets)

        # ------------------------------------------------------------------
        # 1. Re-ID for Hens via Saddles (Higher-Confidence Preserved)
        # ------------------------------------------------------------------
        bird_saddle_candidates = {}
        for (sbox, sclass, sconf) in saddle_dets:
            sx1, sy1, sx2, sy2 = sbox
            scx = (sx1 + sx2) / 2
            scy = (sy1 + sy2) / 2
            color_name = SADDLE_CLASS_TO_HEN.get(sclass) or BAND_CLASS_TO_HEN.get(sclass)
            if not color_name:
                continue

            for bird_entry in chicken_dets + rooster_dets:
                cbox, _, cname, track_id = bird_entry
                if track_id is None:
                    continue
                cx1, cy1, cx2, cy2 = cbox
                cw = max(1.0, cx2 - cx1)
                bh = max(1.0, cy2 - cy1)
                if (cx1 - 0.20 * cw <= scx <= cx2 + 0.20 * cw) and (cy1 - 0.20 * bh <= scy <= cy2 + 0.20 * bh):
                    dist = abs(scx - (cx1 + cx2) / 2) + abs(scy - (cy1 + cy2) / 2)
                    bird_saddle_candidates.setdefault(track_id, []).append(
                        (sconf, color_name, dist, bird_entry)
                    )

        # For each bird, pick its highest-confidence saddle
        bird_best_saddle = {}
        for tid, candidates in bird_saddle_candidates.items():
            candidates.sort(key=lambda c: (c[0], -c[2]), reverse=True)
            best_conf, best_color, _, best_entry = candidates[0]
            bird_best_saddle[tid] = (best_conf, best_color, best_entry)

        # Resolve competing detections for the same color: higher confidence wins
        label_claims = {}
        for tid, (sconf, color_name, entry) in bird_best_saddle.items():
            label_claims.setdefault(color_name, []).append((tid, sconf, entry))

        winning_claims = {}
        for color_name, claims in label_claims.items():
            incumbent_tid = self.hen_track_owners.get(color_name)
            incumbent_claim = next((c for c in claims if c[0] == incumbent_tid), None)
            claims.sort(key=lambda c: c[1], reverse=True)
            top_tid, top_conf, top_entry = claims[0]

            if incumbent_claim is not None and incumbent_tid != top_tid:
                inc_tid, inc_conf, inc_entry = incumbent_claim
                if inc_conf >= top_conf - 0.15:
                    winning_claims[color_name] = (inc_tid, inc_conf, inc_entry)
                else:
                    winning_claims[color_name] = (top_tid, top_conf, top_entry)
            else:
                winning_claims[color_name] = (top_tid, top_conf, top_entry)

        for color_name, (win_tid, sconf, win_entry) in winning_claims.items():
            # If a rooster had a saddle, reclassify as Chicken
            if win_entry[2] == "Rooster":
                if win_entry in rooster_dets:
                    rooster_dets.remove(win_entry)
                chicken_dets.append((win_entry[0], win_entry[1], "Chicken", win_entry[3]))

            incumbent_tid = self.hen_track_owners.get(color_name)
            incumbent_conf = self.hen_owner_conf.get(color_name, 0.0)
            incumbent_last_seen = self.hen_owner_last_frame.get(color_name, 0)
            active_tids = {b[3] for b in chicken_dets + rooster_dets if b[3] is not None}
            incumbent_is_active = (incumbent_tid in active_tids) or (self.frame_count - incumbent_last_seen <= 30)

            if incumbent_tid is not None and incumbent_tid != win_tid:
                if incumbent_is_active and sconf <= incumbent_conf:
                    continue
                if incumbent_is_active and sconf < incumbent_conf + 0.20:
                    continue

            self.hen_track_owners[color_name] = win_tid
            self.hen_owner_conf[color_name] = max(incumbent_conf if incumbent_tid == win_tid else 0.0, sconf)
            self.hen_owner_last_frame[color_name] = self.frame_count
            self.track_saddle_conf[win_tid] = max(self.track_saddle_conf.get(win_tid, 0.0), sconf)

            for _ in range(8):
                self._record_track_band_label(win_tid, color_name)

        # ------------------------------------------------------------------
        # 2. Strict HSV Fallback — ONLY run on unidentified Chickens
        # ------------------------------------------------------------------
        scale_x = orig_w / frame_w if frame_w > 0 else 1.0
        scale_y = orig_h / frame_h if frame_h > 0 else 1.0
        for (cbox, _, _, track_id) in chicken_dets:
            if track_id is None or (track_id in self.track_states and self.track_states[track_id]["label"] != "Chicken"):
                continue

            scaled_box = (
                cbox[0] * scale_x,
                cbox[1] * scale_y,
                cbox[2] * scale_x,
                cbox[3] * scale_y,
            )
            band_label = detect_leg_band_color(source_frame, scaled_box)
            if band_label:
                self._record_track_band_label(track_id, band_label)

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

        def short_id(raw_tid, preferred_label=None):
            if raw_tid is None:
                return None
            # If the track has a confirmed Hen identity, bind strictly to its fixed ID (1..5)
            target_label = preferred_label
            if not target_label and raw_tid in self.track_states:
                target_label = self.track_states[raw_tid]["label"]
            if target_label in HEN_TO_FIXED_ID:
                fixed_id = HEN_TO_FIXED_ID[target_label]
                self.short_id_map[raw_tid] = fixed_id
                return fixed_id
            if raw_tid in self.short_id_map:
                return self.short_id_map[raw_tid]
            # Pool unassigned chickens / roosters avoiding reserved 1..5 IDs
            used = set(self.short_id_map.values()) | {1, 2, 3, 4, 5}
            candidate = self._next_short_id
            while candidate in used:
                candidate += 1
            self.short_id_map[raw_tid] = candidate
            self._next_short_id = candidate + 1
            return candidate

        # Process Hens / Chickens
        assigned_hen_labels = set()
        for (cbox, conf_val, _, track_id) in chicken_dets:
            raw = scale_box(cbox)
            x1, y1, x2, y2 = smooth_box(track_id, raw)

            if track_id is not None:
                live_ids.add(track_id)
                self.cumulative_count.add(track_id)

            display_label = "Chicken"
            if track_id is not None and track_id in self.track_states:
                cand = self.track_states[track_id]["label"]
                if cand not in assigned_hen_labels:
                    display_label = cand
                    assigned_hen_labels.add(cand)
                self.track_states[track_id]["last_seen_frame"] = self.frame_count

            # Color determined strictly by saddle / hen display_label
            colors = get_bbox_color(display_label)
            assigned_id = short_id(track_id, display_label)
            saddle_tag = HEN_TO_SADDLE_TAG.get(display_label, display_label)

            if display_label.startswith("Hen"):
                label_text = f"ID_{assigned_id} {saddle_tag}" if assigned_id is not None else saddle_tag
            else:
                label_text = f"ID_{assigned_id} Chicken" if assigned_id is not None else "Chicken"

            det = {
                "box":           [int(x1), int(y1), int(x2), int(y2)],
                "label":         display_label,
                "display_label": label_text,
                "saddle_tag":    saddle_tag if display_label.startswith("Hen") else None,
                "confidence":    conf_val,
                "track_id":      assigned_id,
                "type":          "hen",
                "color":         colors["hex"],
                "color_rgb":     colors["rgb"],
                "color_bgr":     colors["bgr"],
                "is_tagged":     display_label.startswith("Hen"),
                "tag_color":     colors["hex"] if display_label.startswith("Hen") else None,
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
            assigned_id = short_id(track_id, "Rooster")
            label_text = f"ID_{assigned_id} Rooster" if assigned_id is not None else "Rooster"

            det = {
                "box":           [int(x1), int(y1), int(x2), int(y2)],
                "label":         "Rooster",
                "display_label": label_text,
                "confidence":    conf_val,
                "track_id":      assigned_id,
                "type":          "rooster",
                "color":         colors["hex"],
                "color_rgb":     colors["rgb"],
                "color_bgr":     colors["bgr"],
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