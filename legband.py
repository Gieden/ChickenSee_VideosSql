from typing import List, Optional, Sequence

import cv2
import numpy as np


LEG_BAND_HSV_RANGES = {
    "Hen1 (Green)": ((35, 90, 70), (85, 255, 255)),
    # White: narrow saturation window so pale feathers / grey ground don't match
    "Hen2 (White)": ((0, 0, 200), (180, 30, 255)),
    "Hen3 (Blue)": ((95, 100, 60), (128, 255, 255)),
    "Hen4 (Yellow)": ((20, 100, 100), (35, 255, 255)),
    "Hen5 (Pink)": ((145, 80, 90), (175, 255, 255)),
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
    """Find a distinct band color in the lower portion of a full-resolution bird box."""
    frame_height, frame_width = frame.shape[:2]
    x1, y1, x2, y2 = (int(round(value)) for value in box)
    box_width = x2 - x1
    box_height = y2 - y1
    if box_width <= 0 or box_height <= 0:
        return None

    # Use the lower 45% of the bird box as the leg-band crop region
    # (wider than before so the band has more pixels to register).
    crop_x1 = max(0, min(frame_width, x1 + int(box_width * 0.1)))
    crop_x2 = max(0, min(frame_width, x2 - int(box_width * 0.1)))
    crop_y1 = max(0, min(frame_height, y1 + int(box_height * 0.55)))
    crop_y2 = max(0, min(frame_height, y2))
    if crop_x2 <= crop_x1 or crop_y2 <= crop_y1:
        return None

    roi = frame[crop_y1:crop_y2, crop_x1:crop_x2]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    # Require at least 1.5 % of the ROI to match — eliminates single-pixel noise
    # and small HSV coincidences on feather highlights or ground texture.
    minimum_pixels = max(20, int(roi.shape[0] * roi.shape[1] * 0.015))
    matches = []
    for label, (lower, upper) in LEG_BAND_HSV_RANGES.items():
        mask = cv2.inRange(
            hsv,
            np.asarray(lower, dtype=np.uint8),
            np.asarray(upper, dtype=np.uint8),
        )
        pixel_count = int(cv2.countNonZero(mask))
        if pixel_count >= minimum_pixels:
            matches.append((pixel_count, label))

    if not matches:
        return None
    matches.sort(reverse=True)
    # If runner-up has ≥60 % of the winner’s pixels the result is ambiguous —
    # return None rather than guessing the wrong colour.
    if len(matches) > 1 and matches[1][0] >= matches[0][0] * 0.60:
        return None
    return matches[0][1]
