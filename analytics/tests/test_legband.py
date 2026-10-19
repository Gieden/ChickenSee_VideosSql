import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from analytics.tracker import LABEL_COLORS_BGR, ZampenYOLOTracker
from edge.detector import COLOR_MAP as EDGE_COLOR_MAP
from legband import (
    BAND_CLASS_TO_HEN,
    LEG_BAND_HSV_RANGES,
    detect_leg_band_color,
    suppress_overlapping_equipment,
)
from model import COLOR_MAP as MODEL_COLOR_MAP, ChickenDetector


class TestLegBandDetection(unittest.TestCase):
    def test_blue_band_is_detected_from_original_resolution_crop(self):
        frame = np.zeros((200, 120, 3), dtype=np.uint8)
        frame[150:162, 50:62] = (255, 0, 0)

        label = detect_leg_band_color(frame, (10, 10, 110, 190))

        self.assertEqual(label, "Hen3 (Blue)")

    def test_uncolored_crop_does_not_invent_a_hen_identity(self):
        frame = np.zeros((200, 120, 3), dtype=np.uint8)

        self.assertIsNone(detect_leg_band_color(frame, (10, 10, 110, 190)))

    def test_equipment_box_cannot_be_counted_as_both_feeder_and_drinker(self):
        box = [10, 20, 100, 120]
        detections = [
            (box, 0.4, "Feeder"),
            (box, 0.65, "Drinker"),
        ]

        self.assertEqual(
            suppress_overlapping_equipment(detections),
            [(box, 0.65, "Drinker")],
        )

    def test_checkpoint_violet_band_maps_to_blue_display_identity(self):
        self.assertEqual(BAND_CLASS_TO_HEN["Leg_Band_Violet"], "Hen3 (Blue)")
        self.assertIn("Hen3 (Blue)", LEG_BAND_HSV_RANGES)
        self.assertNotIn("Hen3 (Violet)", LEG_BAND_HSV_RANGES)
        self.assertEqual(MODEL_COLOR_MAP["Hen3 (Blue)"]["hex"], "#0000FF")
        self.assertEqual(EDGE_COLOR_MAP["Hen3 (Blue)"]["hex"], "#0000FF")
        self.assertEqual(LABEL_COLORS_BGR["Hen3 (Blue)"], (255, 0, 0))

    def test_feeder_and_drinker_display_colors_are_gray_in_all_detectors(self):
        for label in ("Feeder", "Drinker"):
            with self.subTest(label=label):
                self.assertEqual(MODEL_COLOR_MAP[label]["hex"], "#808080")
                self.assertEqual(MODEL_COLOR_MAP[label]["rgb"], (128, 128, 128))
                self.assertEqual(MODEL_COLOR_MAP[label]["bgr"], (128, 128, 128))
                self.assertEqual(EDGE_COLOR_MAP[label]["hex"], "#808080")
                self.assertEqual(EDGE_COLOR_MAP[label]["rgb"], (128, 128, 128))
                self.assertEqual(EDGE_COLOR_MAP[label]["bgr"], (128, 128, 128))
                self.assertEqual(LABEL_COLORS_BGR[label], (128, 128, 128))

    def test_analytics_hen_label_requires_consistent_band_observations(self):
        tracker = object.__new__(ZampenYOLOTracker)
        tracker.track_label_cache = {}
        tracker.track_label_votes = {}
        tracker.track_label_last_seen = {}
        tracker.processed_frame_count = 10

        for _ in range(7):
            tracker._record_track_label(12, "Hen3 (Blue)")
        self.assertNotIn(12, tracker.track_label_cache)

        # 8th consistent vote locks the label
        tracker._record_track_label(12, "Hen3 (Blue)")
        self.assertEqual(tracker.track_label_cache[12], "Hen3 (Blue)")

    def test_explicit_model_path_is_used(self):
        with tempfile.TemporaryDirectory() as temporary:
            weights = Path(temporary) / "selected.pt"
            weights.write_bytes(b"model")
            fake_model = type("FakeModel", (), {"names": {0: "Chicken"}})()

            with patch("model.YOLO", return_value=fake_model) as yolo:
                detector = ChickenDetector(str(weights))

        yolo.assert_called_once_with(str(weights.resolve()))
        self.assertIs(detector.model, fake_model)
        self.assertEqual(detector.class_names, {0: "Chicken"})


if __name__ == "__main__":
    unittest.main()
