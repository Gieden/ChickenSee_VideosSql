from typing import Any, List, Optional, Sequence, Tuple

import cv2
import numpy as np


# Fixed flock identity follows the current dataset's saddle colours.
SADDLE_CLASS_TO_HEN = {
    "Saddle_Color_Blue": "Hen2 (Blue)",
    "Saddle_Color_Red": "Hen3 (Red)",
    "Saddle_Color_White": "Hen4 (White)",
    "Saddle_Color_Yellow": "Hen1 (Yellow)",
    "Saddle_Color_YellowGreen": "Hen5 (YellowGreen)",
}

HEN_TO_FIXED_ID = {
    "Hen1 (Yellow)": 1,
    "Hen2 (Blue)": 2,
    "Hen3 (Red)": 3,
    "Hen4 (White)": 4,
    "Hen5 (YellowGreen)": 5,
}

FIXED_ID_TO_HEN = {
    1: "Hen1 (Yellow)",
    2: "Hen2 (Blue)",
    3: "Hen3 (Red)",
    4: "Hen4 (White)",
    5: "Hen5 (YellowGreen)",
}

HEN_TO_SADDLE_TAG = {
    "Hen1 (Yellow)": "Saddle_Yellow(Hen1)",
    "Hen2 (Blue)": "Saddle_Blue(Hen2)",
    "Hen3 (Red)": "Saddle_Red(Hen3)",
    "Hen4 (White)": "Saddle_White(Hen4)",
    "Hen5 (YellowGreen)": "Saddle_YellowGreen(Hen5)",
}

HEN_TO_DISPLAY_LABEL = {
    "Hen1 (Yellow)": "ID1_H1 Yellow",
    "Hen2 (Blue)": "ID2_H2 Blue",
    "Hen3 (Red)": "ID_3_H3 Red",
    "Hen4 (White)": "ID4_H4 White",
    "Hen5 (YellowGreen)": "ID5_H5 Yellow-Green",
}

ANIMAL_TO_FIXED_ID = {
    **HEN_TO_FIXED_ID,
    "Rooster": 6,
    "Chicken": 7,
}

ANIMAL_TO_DISPLAY_LABEL = {
    **HEN_TO_DISPLAY_LABEL,
    "Rooster": "ID6_R1 Rooster",
    "Chicken": "ID7_Chicken(Unidentified)",
}


def animal_display_label(label: str, tracking_id: Optional[int] = None) -> str:
    if label == "Chicken" and tracking_id is not None:
        return f"ID{tracking_id}_Chicken(Unidentified)"
    return ANIMAL_TO_DISPLAY_LABEL.get(label, label)


SADDLE_HSV_RANGES = {
    "Hen1 (Yellow)": ((16, 75, 75), (34, 255, 255)),
    "Hen2 (Blue)": ((96, 80, 65), (135, 255, 255)),
    "Hen3 (Red)": ((0, 60, 60), (12, 255, 255)),
    "Hen4 (White)": ((0, 0, 165), (180, 35, 255)),
    "Hen5 (YellowGreen)": ((35, 50, 40), (68, 255, 255)),
}

SADDLE_HSV_SECONDARY_RANGES = {
    "Hen3 (Red)": ((155, 55, 55), (180, 255, 255)),
}


def equipment_boxes_overlap(
    first: Sequence[float],
    second: Sequence[float],
    threshold: float = 0.75,
) -> bool:
    left = max(float(first[0]), float(second[0]))
    top = max(float(first[1]), float(second[1]))
    right = min(float(first[2]), float(second[2]))
    bottom = min(float(first[3]), float(second[3]))
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    first_area = max(0.0, float(first[2]) - float(first[0])) * max(
        0.0, float(first[3]) - float(first[1])
    )
    second_area = max(0.0, float(second[2]) - float(second[0])) * max(
        0.0, float(second[3]) - float(second[1])
    )
    union = first_area + second_area - intersection
    return union > 0.0 and intersection / union >= threshold


def suppress_overlapping_equipment(
    detections: Sequence[tuple],
    threshold: float = 0.75,
) -> List[tuple]:
    ranked = sorted(
        enumerate(detections), key=lambda item: float(item[1][1]), reverse=True
    )
    kept_indices = set()
    kept_boxes = []
    for index, detection in ranked:
        box = detection[0]
        if any(equipment_boxes_overlap(box, kept, threshold) for kept in kept_boxes):
            continue
        kept_indices.add(index)
        kept_boxes.append(box)
    return [detection for index, detection in enumerate(detections) if index in kept_indices]


def detect_saddle_color(
    frame: np.ndarray, box: Sequence[float]
) -> Optional[str]:
    """Find a distinct saddle patch on the dorsal/back region of a chicken box."""
    frame_height, frame_width = frame.shape[:2]
    x1, y1, x2, y2 = (int(round(value)) for value in box)
    box_width = x2 - x1
    box_height = y2 - y1
    if box_width <= 0 or box_height <= 0:
        return None

    # Sample the dorsal / back zone (upper 10% to 78% of chicken box, centered 12% to 88% wide)
    crop_x1 = max(0, min(frame_width, x1 + int(box_width * 0.12)))
    crop_x2 = max(0, min(frame_width, x2 - int(box_width * 0.12)))
    crop_y1 = max(0, min(frame_height, y1 + int(box_height * 0.10)))
    crop_y2 = max(0, min(frame_height, y1 + int(box_height * 0.78)))
    if crop_x2 <= crop_x1 or crop_y2 <= crop_y1:
        return None

    roi = frame[crop_y1:crop_y2, crop_x1:crop_x2]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    max_cw = max(6, int(box_width * 0.88))
    max_ch = max(6, int(box_height * 0.72))
    area_upper = max(1200, int(box_width * box_height * 0.70))

    # Step 1: Chromatic evaluation (Yellow, Blue, Red, YellowGreen)
    best_chroma_label = None
    best_chroma_area = 0
    second_chroma_area = 0

    chromatic_items = [
        (lbl, ranges) for lbl, ranges in SADDLE_HSV_RANGES.items()
        if lbl != "Hen4 (White)"
    ]

    for label, (lower, upper) in chromatic_items:
        mask = cv2.inRange(
            hsv,
            np.asarray(lower, dtype=np.uint8),
            np.asarray(upper, dtype=np.uint8),
        )
        if label in SADDLE_HSV_SECONDARY_RANGES:
            s_low, s_up = SADDLE_HSV_SECONDARY_RANGES[label]
            m_sec = cv2.inRange(
                hsv,
                np.asarray(s_low, dtype=np.uint8),
                np.asarray(s_up, dtype=np.uint8),
            )
            mask = cv2.bitwise_or(mask, m_sec)

        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask)
        valid_area = 0
        for j in range(1, num_labels):
            area = stats[j, cv2.CC_STAT_AREA]
            cw = stats[j, cv2.CC_STAT_WIDTH]
            ch = stats[j, cv2.CC_STAT_HEIGHT]
            aspect = cw / max(1, ch)
            if 20 <= area <= area_upper and 3 <= cw <= max_cw and 3 <= ch <= max_ch:
                compactness = area / max(1, cw * ch)
                if compactness >= 0.14 and 0.18 <= aspect <= 5.0:
                    valid_area = max(valid_area, area)

        if valid_area > 0:
            if valid_area > best_chroma_area:
                second_chroma_area = best_chroma_area
                best_chroma_area = valid_area
                best_chroma_label = label
            elif valid_area > second_chroma_area:
                second_chroma_area = valid_area

    if best_chroma_label and best_chroma_area >= 25:
        if second_chroma_area < best_chroma_area * 0.85:
            return best_chroma_label

    # Step 2: Neutral White evaluation (only if no saturated color saddle was detected)
    white_spec = SADDLE_HSV_RANGES.get("Hen4 (White)")
    if white_spec:
        lower, upper = white_spec
        mask_white = cv2.inRange(
            hsv,
            np.asarray(lower, dtype=np.uint8),
            np.asarray(upper, dtype=np.uint8),
        )

        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask_white)
        best_white_area = 0
        for j in range(1, num_labels):
            area = stats[j, cv2.CC_STAT_AREA]
            cw = stats[j, cv2.CC_STAT_WIDTH]
            ch = stats[j, cv2.CC_STAT_HEIGHT]
            aspect = cw / max(1, ch)
            if 35 <= area <= area_upper and 3 <= cw <= max_cw and 3 <= ch <= max_ch:
                compactness = area / max(1, cw * ch)
                if compactness >= 0.16 and 0.20 <= aspect <= 4.5:
                    best_white_area = max(best_white_area, area)

        if best_white_area >= 35:
            return "Hen4 (White)"

    return None


def detect_pen_equipment(
    frame: Optional[np.ndarray],
    existing_feeder_boxes: Optional[Sequence[Sequence[float]]] = None,
    existing_drinker_boxes: Optional[Sequence[Sequence[float]]] = None,
) -> Tuple[Optional[Tuple[List[int], float]], Optional[Tuple[List[int], float]]]:
    """
    Fallback CV detector for the stationary pen Feeder and Drinker when YOLO misses
    one or both on wide-angle camera views.
    Returns (feeder_result, drinker_result) where each is ([x1, y1, x2, y2], confidence) or None.
    """
    if frame is None or not isinstance(frame, np.ndarray) or frame.size == 0 or frame.ndim != 3:
        return None, None
    # Skip synthetic / blank unit-test frames
    if float(np.std(frame)) < 12.0:
        return None, None

    h, w = frame.shape[:2]
    if h < 120 or w < 160:
        return None, None

    has_feeder = bool(existing_feeder_boxes and len(existing_feeder_boxes) > 0)
    has_drinker = bool(existing_drinker_boxes and len(existing_drinker_boxes) > 0)
    if has_feeder and has_drinker:
        return None, None

    feeder_out: Optional[Tuple[List[int], float]] = None
    drinker_out: Optional[Tuple[List[int], float]] = None
    dome_rect: Optional[Tuple[int, int, int, int]] = None

    # 1. Detect the bright white circular bell drinker dome in the right pen zone
    rx1, rx2 = int(w * 0.40), int(w * 0.95)
    ry1, ry2 = int(h * 0.38), int(h * 0.92)
    if rx2 > rx1 and ry2 > ry1:
        hsv = cv2.cvtColor(frame[ry1:ry2, rx1:rx2], cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv, np.array([0, 0, 165], dtype=np.uint8), np.array([180, 95, 255], dtype=np.uint8))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_a = (w * h) * 0.0012
        max_a = (w * h) * 0.022
        best_circ = 0.0
        for c in cnts:
            a = cv2.contourArea(c)
            if not (min_a <= a <= max_a):
                continue
            x, y, bw, bh = cv2.boundingRect(c)
            ar = bw / max(1.0, float(bh))
            peri = cv2.arcLength(c, True)
            circ = (4.0 * np.pi * a / (peri * peri)) if peri > 0 else 0.0
            if 0.72 <= ar <= 1.35 and circ >= 0.50 and circ > best_circ:
                best_circ = circ
                dome_rect = (rx1 + x, ry1 + y, bw, bh)

    if not has_drinker and dome_rect is not None:
        dx, dy, dw, dh = dome_rect
        pad_x, pad_y = int(dw * 0.18), int(dh * 0.18)
        d_box = [
            max(0, dx - pad_x),
            max(0, dy - pad_y),
            min(w, dx + dw + pad_x),
            min(h, dy + dh + pad_y),
        ]
        drinker_out = (d_box, 0.82)

    # 2. If Feeder is missing, derive its position above the Drinker
    if not has_feeder:
        ref_dome = dome_rect
        if ref_dome is None and has_drinker and existing_drinker_boxes:
            db = existing_drinker_boxes[0]
            dbw = max(10.0, float(db[2] - db[0]))
            dbh = max(10.0, float(db[3] - db[1]))
            # Unpad outer drinker box to estimate inner dome
            dw_est = int(dbw / 1.36)
            dh_est = int(dbh / 1.36)
            dx_est = int((db[0] + db[2]) / 2.0 - dw_est / 2.0)
            dy_est = int((db[1] + db[3]) / 2.0 - dh_est / 2.0)
            ref_dome = (dx_est, dy_est, dw_est, dh_est)

        if ref_dome is not None:
            dx, dy, dw, dh = ref_dome
            fcx = int(dx + dw * 0.5 + dw * 0.35)
            fcy = int(dy + dh * 0.5 - dh * 3.65)
            fw, fh = int(dw * 1.75), int(dh * 1.75)
            fy1 = max(0, fcy - fh // 2)
            fy2 = min(h, fcy + fh // 2)
            fx1 = max(0, fcx - fw // 2)
            fx2 = min(w, fcx + fw // 2)
            if fx2 - fx1 >= 20 and fy2 - fy1 >= 20:
                feeder_out = ([fx1, fy1, fx2, fy2], 0.84)

    # 3. If Drinker is still missing but Feeder was detected by YOLO, derive Drinker below Feeder
    if not has_drinker and drinker_out is None and has_feeder and existing_feeder_boxes:
        fb = existing_feeder_boxes[0]
        fw = max(14.0, float(fb[2] - fb[0]))
        fh = max(14.0, float(fb[3] - fb[1]))
        fcx = (fb[0] + fb[2]) / 2.0
        fcy = (fb[1] + fb[3]) / 2.0
        dome_w = fw / 1.75
        dome_h = fh / 1.75
        dcx = int(fcx - 0.35 * dome_w)
        dcy = int(fcy + 3.65 * dome_h)
        dw_box = int(dome_w * 1.36)
        dh_box = int(dome_h * 1.36)
        dx1 = max(0, dcx - dw_box // 2)
        dy1 = max(0, dcy - dh_box // 2)
        dx2 = min(w, dcx + dw_box // 2)
        dy2 = min(h, dcy + dh_box // 2)
        if dx2 - dx1 >= 16 and dy2 - dy1 >= 16 and dy2 <= h:
            drinker_out = ([dx1, dy1, dx2, dy2], 0.78)

    return feeder_out, drinker_out

