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

LEG_BAND_HSV_RANGES = {
    "Hen1 (Yellow)": ((16, 70, 70), (34, 255, 255)),
    "Hen2 (Blue)": ((95, 70, 50), (135, 255, 255)),
    "Hen3 (Red)": ((0, 60, 60), (12, 255, 255)),
    "Hen4 (White)": ((0, 0, 160), (180, 40, 255)),
    "Hen5 (YellowGreen)": ((35, 55, 50), (65, 255, 255)),
}

BAND_CLASS_TO_HEN = {
    **SADDLE_CLASS_TO_HEN,
    # Legacy band classes whose colours still identify a member of this flock.
    "Leg_Band_Blue": "Hen2 (Blue)",
    "Leg_Band_Violet": "Hen2 (Blue)",
    "Leg_Band_Red": "Hen3 (Red)",
    "Leg_Band_White": "Hen4 (White)",
    "Leg_Band_Yellow": "Hen1 (Yellow)",
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


def detect_leg_band_color(
    frame: np.ndarray, box: Sequence[float]
) -> Optional[str]:
    """
    Find a saddle or leg-band spot on a chicken.
    Prioritizes saddle detection on the chicken's back, falling back to lower leg region.
    """
    saddle_result = detect_saddle_color(frame, box)
    if saddle_result:
        return saddle_result

    frame_height, frame_width = frame.shape[:2]
    x1, y1, x2, y2 = (int(round(value)) for value in box)
    box_width = x2 - x1
    box_height = y2 - y1
    if box_width <= 0 or box_height <= 0:
        return None

    if (box_width / max(1, box_height) > 1.35) or box_height < 25:
        return None

    crop_x1 = max(0, min(frame_width, x1))
    crop_x2 = max(0, min(frame_width, x2))
    crop_y1 = max(0, min(frame_height, y1 + int(box_height * 0.40)))
    crop_y2 = max(0, min(frame_height, y2 + int(box_height * 0.15)))
    if crop_x2 <= crop_x1 or crop_y2 <= crop_y1:
        return None

    roi = frame[crop_y1:crop_y2, crop_x1:crop_x2]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    max_cw = max(5, int(box_width * 0.85))
    max_ch = max(5, int(box_height * 0.70))

    best_match = None
    best_area = 0
    second_best_area = 0

    for label, (lower, upper) in LEG_BAND_HSV_RANGES.items():
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
            area_upper = max(50, int(box_width * box_height * 0.40))
            if 15 <= area <= area_upper and 2 <= cw <= max_cw and 2 <= ch <= max_ch:
                compactness = area / max(1, cw * ch)
                aspect = cw / max(1, ch)
                if 0.15 <= aspect <= 4.5 and compactness >= 0.20:
                    valid_area = max(valid_area, area)

        if valid_area > 0:
            if valid_area > best_area:
                second_best_area = best_area
                best_area = valid_area
                best_match = label
            elif valid_area > second_best_area:
                second_best_area = valid_area

    if not best_match:
        return None

    if second_best_area >= best_area * 0.65:
        return None

    return best_match
