from typing import List, Optional, Sequence

import cv2
import numpy as np


LEG_BAND_HSV_RANGES = {
    "Hen1 (Green)": ((35, 75, 70), (85, 255, 255)),
    # White: High brightness, low saturation to avoid grey dirt, sand, and pale feather highlights
    "Hen2 (White)": ((0, 0, 195), (180, 45, 255)),
    # Blue/Violet: Narrow high-saturation & brightness band to prevent dark black feather sheen from matching
    "Hen3 (Blue)": ((100, 120, 100), (155, 255, 255)),
    "Hen4 (Yellow)": ((18, 90, 100), (35, 255, 255)),
    "Hen5 (Pink)": ((150, 65, 80), (178, 255, 255)),
}

BAND_CLASS_TO_HEN = {
    "Leg_Band_Green": "Hen1 (Green)",
    "Leg_Band_White": "Hen2 (White)",
    "Leg_Band_Violet": "Hen3 (Blue)",
    "Leg_Band_Yellow": "Hen4 (Yellow)",
    "Leg_Band_Pink": "Hen5 (Pink)",
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


def detect_leg_band_color(
    frame: np.ndarray, box: Sequence[float]
) -> Optional[str]:
    """Find a distinct compact leg-band spot in the lower leg region of a bird box."""
    frame_height, frame_width = frame.shape[:2]
    x1, y1, x2, y2 = (int(round(value)) for value in box)
    box_width = x2 - x1
    box_height = y2 - y1
    if box_width <= 0 or box_height <= 0:
        return None

    # If the bird is crouching/sitting (wide aspect ratio), legs are tucked under body.
    # Lowered height threshold from 40 to 25 to handle smaller/distant birds.
    if (box_width / max(1, box_height) > 1.35) or box_height < 25:
        return None

    # Sample the lower 55% of the bird box (bottom of body + full leg zone).
    # The old crop (y1 + 70% to y2 + 8%) was only 30% of the box height, leaving
    # leg bands in the lower-middle region undetected on typical 640px inference boxes.
    crop_x1 = max(0, min(frame_width, x1))
    crop_x2 = max(0, min(frame_width, x2))
    crop_y1 = max(0, min(frame_height, y1 + int(box_height * 0.45)))
    crop_y2 = max(0, min(frame_height, y2 + int(box_height * 0.10)))
    if crop_x2 <= crop_x1 or crop_y2 <= crop_y1:
        return None

    roi = frame[crop_y1:crop_y2, crop_x1:crop_x2]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    roi_h = roi.shape[0]
    # Relaxed width gate: band can span the full leg width at low resolution.
    max_cw = max(5, int(box_width * 0.85))
    # Relaxed height gate: proportion of box height (was 0.32).
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
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask)
        valid_area = 0
        for j in range(1, num_labels):
            area = stats[j, cv2.CC_STAT_AREA]
            cw = stats[j, cv2.CC_STAT_WIDTH]
            ch = stats[j, cv2.CC_STAT_HEIGHT]
            cy = centroids[j][1]
            # Compact leg-band cluster: must be a solid blob, not feather sheen.
            # compactness = filled_pixels / bounding_box_area — real bands are dense (>= 0.25),
            # diffuse feather-sheen components are scattered (< 0.25).
            area_upper = max(50, int(box_width * box_height * 0.40))
            if 8 <= area <= area_upper and 3 <= cw <= max_cw and 3 <= ch <= max_ch:
                compactness = area / max(1, cw * ch)
                aspect = cw / max(1, ch)
                if 0.20 <= aspect <= 4.0 and compactness >= 0.25:
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

    # Ambiguity check: if runner-up is >= 60% of winner, reject
    # Lowered from 0.65 to 0.60 for more strict leg-band labeling accuracy
    if second_best_area >= best_area * 0.60:
        return None

    return best_match
