import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np

from analytics.tracker import (
    LABEL_COLORS_BGR,
    TrackedDetection,
    TrackerFrameOutput,
    ZampenYOLOTracker,
)
from edge.detector import COLOR_MAP as EDGE_COLOR_MAP
from saddle import (
    ANIMAL_TO_DISPLAY_LABEL,
    ANIMAL_TO_FIXED_ID,
    HEN_TO_FIXED_ID,
    HEN_TO_SADDLE_TAG,
    SADDLE_CLASS_TO_HEN,
    SADDLE_HSV_RANGES,
    animal_display_label,
    detect_saddle_color,
    suppress_overlapping_equipment,
)
from model import COLOR_MAP as MODEL_COLOR_MAP, ChickenDetector


class TestSaddleDetection(unittest.TestCase):
    def test_unidentified_display_labels_use_unique_tracking_ids(self):
        self.assertEqual(animal_display_label("Chicken", 7), "ID7_Chicken(Unidentified)")
        self.assertEqual(animal_display_label("Chicken", 8), "ID8_Chicken(Unidentified)")
        self.assertEqual(animal_display_label("Rooster", 6), "ID6_R1 Rooster")

    def test_blue_saddle_is_detected_from_original_resolution_crop(self):
        frame = np.zeros((200, 120, 3), dtype=np.uint8)
        frame[80:98, 50:68] = (255, 0, 0)

        label = detect_saddle_color(frame, (10, 10, 110, 190))

        self.assertEqual(label, "Hen2 (Blue)")

    def test_uncolored_crop_does_not_invent_a_hen_identity(self):
        frame = np.zeros((200, 120, 3), dtype=np.uint8)

        self.assertIsNone(detect_saddle_color(frame, (10, 10, 110, 190)))

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

    def test_saddle_blue_maps_to_blue_display_identity(self):
        self.assertEqual(SADDLE_CLASS_TO_HEN["Saddle_Color_Blue"], "Hen2 (Blue)")
        self.assertIn("Hen2 (Blue)", SADDLE_HSV_RANGES)
        self.assertEqual(MODEL_COLOR_MAP["Hen2 (Blue)"]["hex"], "#0000FF")
        self.assertEqual(EDGE_COLOR_MAP["Hen2 (Blue)"]["hex"], "#0000FF")
        self.assertEqual(LABEL_COLORS_BGR["Hen2 (Blue)"], (255, 0, 0))

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
            tracker._record_track_label(12, "Hen3 (Red)")
            tracker.processed_frame_count += 1
        self.assertNotIn(12, tracker.track_label_cache)

        # 8th consistent vote locks the label
        tracker._record_track_label(12, "Hen3 (Red)")
        self.assertEqual(tracker.track_label_cache[12], "Hen3 (Red)")

    def test_analytics_label_votes_count_distinct_frames_only(self):
        tracker = object.__new__(ZampenYOLOTracker)
        tracker.track_label_cache = {}
        tracker.track_label_votes = {}
        tracker.track_label_last_seen = {}
        tracker.processed_frame_count = 1

        for _ in range(8):
            tracker._record_track_label(12, "Hen2 (Blue)")

        self.assertNotIn(12, tracker.track_label_cache)
        self.assertEqual(len(tracker.track_label_votes[12]), 1)

    def test_annotation_keeps_long_labels_inside_the_frame(self):
        tracker = object.__new__(ZampenYOLOTracker)
        frame = np.zeros((120, 180, 3), dtype=np.uint8)
        detection = TrackedDetection(
            box=[150, 50, 179, 90],
            centroid=(164, 70),
            confidence=0.86,
            class_id=0,
            class_name="Chicken",
            track_id=8,
            bird_label="Chicken",
        )
        output = TrackerFrameOutput(
            frame_idx=1,
            timestamp_s=0.0,
            birds=[detection],
            feeders=[],
            drinkers=[],
        )

        annotated = tracker.annotate_frame(frame, output)

        self.assertEqual(annotated.shape, frame.shape)
        self.assertTrue(np.array_equal(annotated[40, 179], LABEL_COLORS_BGR["Chicken"]))

    def test_analytics_class_map_uses_checkpoint_names(self):
        names = {
            0: "Chicken",
            1: "Drinker",
            2: "Feeder",
            3: "Rooster",
            4: "Saddle_Color_Blue",
            5: "Saddle_Color_Red",
            6: "Saddle_Color_White",
            7: "Saddle_Color_Yellow",
            8: "Saddle_Color_YellowGreen",
        }

        self.assertEqual(ZampenYOLOTracker._normalize_class_names(names), names)
        self.assertEqual(
            ZampenYOLOTracker._normalize_class_names(["Chicken", "Rooster"]),
            {0: "Chicken", 1: "Rooster"},
        )

    def test_analytics_annotation_uses_fixed_label_and_thin_box(self):
        tracker = object.__new__(ZampenYOLOTracker)
        bird = TrackedDetection(
            box=[10, 10, 50, 60],
            centroid=(30, 35),
            confidence=0.9,
            class_id=0,
            class_name="Chicken",
            track_id=2,
            bird_label="Hen2 (Blue)",
        )
        frame_out = TrackerFrameOutput(
            frame_idx=1,
            timestamp_s=0.0,
            birds=[bird],
            feeders=[],
            drinkers=[],
        )

        with (
            patch("analytics.tracker.cv2.rectangle") as rectangle,
            patch("analytics.tracker.cv2.putText") as put_text,
            patch("analytics.tracker.cv2.getTextSize", return_value=((120, 14), 0)),
            patch("analytics.tracker.cv2.addWeighted"),
        ):
            tracker.annotate_frame(np.zeros((100, 100, 3), dtype=np.uint8), frame_out)

        self.assertEqual(rectangle.call_args_list[0].args[4], 1)
        self.assertEqual(rectangle.call_args_list[0].args[5], cv2.LINE_AA)
        self.assertIn("ID2_H2 Blue (0.90)", [call.args[1] for call in put_text.call_args_list])

    def test_analytics_track_ids_are_sequential_and_stable(self):
        class FakeTensor:
            def __init__(self, values):
                self.values = np.asarray(values)

            def cpu(self):
                return self

            def numpy(self):
                return self.values

            def int(self):
                return FakeTensor(self.values.astype(int))

            def tolist(self):
                return self.values.tolist()

        class FakeBoxes(SimpleNamespace):
            def __len__(self):
                return len(self.xyxy.values)

        class FakeInternalTracker:
            def __init__(self):
                self.reset_count = 0

            def reset(self):
                self.reset_count += 1

        class FakeModel:
            names = {0: "Chicken"}

            def __init__(self):
                self.confidence_thresholds = []
                self.internal_tracker = FakeInternalTracker()
                self.predictor = SimpleNamespace(trackers=[self.internal_tracker])
                self.results = iter([
                    [SimpleNamespace(boxes=FakeBoxes(
                        xyxy=FakeTensor([[10, 10, 30, 30], [50, 50, 70, 70]]),
                        conf=FakeTensor([0.9, 0.9]),
                        cls=FakeTensor([0, 0]),
                        id=FakeTensor([1000, 1001]),
                    ))],
                    [SimpleNamespace(boxes=FakeBoxes(
                        xyxy=FakeTensor([[50, 50, 70, 70], [10, 10, 30, 30]]),
                        conf=FakeTensor([0.9, 0.9]),
                        cls=FakeTensor([0, 0]),
                        id=FakeTensor([1001, 1000]),
                    ))],
                    [SimpleNamespace(boxes=FakeBoxes(
                        xyxy=FakeTensor([[10, 10, 30, 30], [50, 50, 70, 70]]),
                        conf=FakeTensor([0.9, 0.9]),
                        cls=FakeTensor([0, 0]),
                        id=FakeTensor([1000, 1001]),
                    ))],
                ])

            def track(self, *args, **kwargs):
                self.confidence_thresholds.append(kwargs["conf"])
                return next(self.results)

        tracker = object.__new__(ZampenYOLOTracker)
        tracker.model = FakeModel()
        tracker.tracker_yaml = "bytetrack.yaml"
        tracker.track_conf = min(0.25, ZampenYOLOTracker.MIN_SADDLE_CONFIDENCE)
        tracker.conf = 0.25
        tracker.iou = 0.45
        tracker.imgsz = 640
        tracker.device = "cpu"
        tracker.class_map = {0: "Chicken"}
        tracker.track_label_cache = {}
        tracker.track_label_votes = {}
        tracker.track_label_last_seen = {}
        tracker.track_class_history = {}
        tracker.track_resolved_classes = {}
        tracker.track_class_last_seen = {}
        tracker.processed_frame_count = 0
        tracker.short_id_map = {}
        tracker._next_short_id = 1
        tracker.short_track_positions = {}

        frame = np.zeros((100, 100, 3), dtype=np.uint8)
        first = tracker.process_frame(frame, 0)
        second = tracker.process_frame(frame, 1)

        self.assertEqual([bird.track_id for bird in first.birds], [7, 8])
        self.assertEqual([bird.track_id for bird in second.birds], [8, 7])
        # The association stage must see saddle candidates; birds are re-gated
        # per class right after tracking (see MIN_DETECTION_CONFIDENCE).
        self.assertEqual(
            tracker.model.confidence_thresholds,
            [ZampenYOLOTracker.MIN_SADDLE_CONFIDENCE] * 2,
        )
        self.assertIsNone(tracker._resolve_short_id(None))
        self.assertEqual(tracker._next_short_id, 3)

        tracker.reset_video_state()
        self.assertEqual(tracker.model.internal_tracker.reset_count, 1)
        next_video = tracker.process_frame(frame, 0)
        self.assertEqual([bird.track_id for bird in next_video.birds], [7, 8])
        self.assertEqual(tracker._next_short_id, 3)

    def test_tracker_reuses_id_for_nearby_reappearing_chicken(self):
        tracker = object.__new__(ZampenYOLOTracker)
        tracker.short_id_map = {}
        tracker.short_track_positions = {}
        tracker.short_track_sizes = {}
        tracker._next_short_id = 1
        tracker.processed_frame_count = 1

        def bird(raw_id, center_x, center_y):
            return TrackedDetection(
                box=[center_x - 10, center_y - 10, center_x + 10, center_y + 10],
                centroid=(center_x, center_y),
                confidence=0.9,
                class_id=0,
                class_name="Chicken",
                track_id=raw_id,
                bird_label="Chicken",
            )

        first = bird(1000, 100, 100)
        tracker._assign_display_ids([first], (360, 640, 3))
        self.assertEqual(first.track_id, 1)

        tracker.processed_frame_count += 5
        reappeared = bird(2000, 130, 120)
        tracker._assign_display_ids([reappeared], (360, 640, 3))
        self.assertEqual(reappeared.track_id, 1)

        tracker.processed_frame_count += 1
        distant = bird(3000, 500, 300)
        tracker._assign_display_ids([distant], (360, 640, 3))
        self.assertEqual(distant.track_id, 2)

        tracker.processed_frame_count += tracker.REIDENTIFICATION_MAX_GAP_FRAMES + 1
        expired = bird(4000, 500, 300)
        tracker._assign_display_ids([expired], (360, 640, 3))
        self.assertEqual(expired.track_id, 3)

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

    def test_saddle_class_mapping_and_fixed_ids(self):
        self.assertEqual(SADDLE_CLASS_TO_HEN["Saddle_Color_Yellow"], "Hen1 (Yellow)")
        self.assertEqual(SADDLE_CLASS_TO_HEN["Saddle_Color_Blue"], "Hen2 (Blue)")
        self.assertEqual(SADDLE_CLASS_TO_HEN["Saddle_Color_Red"], "Hen3 (Red)")
        self.assertEqual(SADDLE_CLASS_TO_HEN["Saddle_Color_White"], "Hen4 (White)")
        self.assertEqual(SADDLE_CLASS_TO_HEN["Saddle_Color_YellowGreen"], "Hen5 (YellowGreen)")

        self.assertEqual(HEN_TO_FIXED_ID["Hen1 (Yellow)"], 1)
        self.assertEqual(HEN_TO_FIXED_ID["Hen2 (Blue)"], 2)
        self.assertEqual(HEN_TO_FIXED_ID["Hen3 (Red)"], 3)
        self.assertEqual(HEN_TO_FIXED_ID["Hen4 (White)"], 4)
        self.assertEqual(HEN_TO_FIXED_ID["Hen5 (YellowGreen)"], 5)
        self.assertEqual(ANIMAL_TO_FIXED_ID["Rooster"], 6)
        self.assertEqual(ANIMAL_TO_FIXED_ID["Chicken"], 7)
        self.assertEqual(ANIMAL_TO_DISPLAY_LABEL["Hen1 (Yellow)"], "ID1_H1 Yellow")
        self.assertEqual(ANIMAL_TO_DISPLAY_LABEL["Hen2 (Blue)"], "ID2_H2 Blue")
        self.assertEqual(ANIMAL_TO_DISPLAY_LABEL["Hen3 (Red)"], "ID_3_H3 Red")
        self.assertEqual(ANIMAL_TO_DISPLAY_LABEL["Hen4 (White)"], "ID4_H4 White")
        self.assertEqual(ANIMAL_TO_DISPLAY_LABEL["Hen5 (YellowGreen)"], "ID5_H5 Yellow-Green")
        self.assertEqual(ANIMAL_TO_DISPLAY_LABEL["Rooster"], "ID6_R1 Rooster")
        self.assertEqual(ANIMAL_TO_DISPLAY_LABEL["Chicken"], "ID7_Chicken(Unidentified)")
        self.assertEqual(HEN_TO_SADDLE_TAG["Hen1 (Yellow)"], "Saddle_Yellow(Hen1)")
        self.assertEqual(HEN_TO_SADDLE_TAG["Hen2 (Blue)"], "Saddle_Blue(Hen2)")

        self.assertEqual(MODEL_COLOR_MAP["Hen1 (Yellow)"]["hex"], "#FFFF00")
        for color_map in (MODEL_COLOR_MAP, EDGE_COLOR_MAP):
            self.assertNotIn("Hen4 (Bluegreen)", color_map)
            self.assertNotIn("Saddle_Bluegreen(Hen4)", color_map)
            self.assertEqual(color_map["Hen4 (White)"]["hex"], "#FFFFFF")
            self.assertEqual(color_map["Hen5 (YellowGreen)"]["hex"], "#9ACD32")
        self.assertEqual(LABEL_COLORS_BGR["Hen1 (Yellow)"], (0, 255, 255))
        self.assertEqual(LABEL_COLORS_BGR["Hen2 (Blue)"], (255, 0, 0))
        self.assertEqual(LABEL_COLORS_BGR["Hen3 (Red)"], (0, 0, 255))
        self.assertEqual(LABEL_COLORS_BGR["Hen4 (White)"], (255, 255, 255))
        self.assertEqual(LABEL_COLORS_BGR["Rooster"], (0, 0, 255))
        self.assertEqual(LABEL_COLORS_BGR["Chicken"], (0, 165, 255))

    def test_higher_confidence_saddle_remains_with_hen_and_cannot_be_stolen(self):
        tracker = object.__new__(ZampenYOLOTracker)
        tracker.track_label_cache = {}
        tracker.track_label_votes = {}
        tracker.track_label_last_seen = {}
        tracker.track_tag_confirmed = set()
        tracker.track_class_history = {}
        tracker.track_resolved_classes = {}
        tracker.track_class_last_seen = {}
        tracker.processed_frame_count = 0
        tracker.short_id_map = {}
        tracker._next_short_id = 1
        tracker.short_track_positions = {}
        tracker.short_track_sizes = {}
        tracker.track_last_label = {}
        tracker.label_owner = {}
        tracker.hen_track_owners = {}
        tracker.hen_owner_conf = {}
        tracker.hen_owner_last_frame = {}
        tracker.track_saddle_conf = {}
        tracker.class_map = {
            0: "Chicken",
            1: "Drinker",
            2: "Feeder",
            3: "Rooster",
            4: "Saddle_Color_Blue",
            5: "Saddle_Color_Red",
            6: "Saddle_Color_White",
            7: "Saddle_Color_Yellow",
            8: "Saddle_Color_YellowGreen",
        }
        tracker.conf = 0.25
        tracker.iou = 0.45
        tracker.imgsz = 640
        tracker.device = "cpu"
        tracker.tracker_yaml = "bytetrack.yaml"
        tracker.track_conf = 0.15
        tracker.MIN_DETECTION_CONFIDENCE = 0.25
        tracker.MIN_SADDLE_CONFIDENCE = 0.15

        class FakeTensor:
            def __init__(self, values):
                self.values = np.asarray(values)
            def cpu(self): return self
            def numpy(self): return self.values
            def int(self): return FakeTensor(self.values.astype(int))
            def tolist(self): return self.values.tolist()

        class FakeBoxes:
            def __init__(self, xyxy, conf, cls, tid):
                self.xyxy = FakeTensor(xyxy)
                self.conf = FakeTensor(conf)
                self.cls = FakeTensor(cls)
                self.id = FakeTensor(tid) if tid is not None else None
            def __len__(self):
                return len(self.xyxy.values)

        # Frame 0: Bird A at (100, 100) has Yellow saddle with high conf 0.85
        # Bird B at (500, 500) has no saddle
        res0 = SimpleNamespace(boxes=FakeBoxes(
            xyxy=[[100, 100, 150, 150], [500, 500, 550, 550], [115, 115, 135, 135]],
            conf=[0.88, 0.82, 0.85],
            cls=[0, 0, 7],  # Chicken, Chicken, Saddle_Color_Yellow
            tid=[101, 102, -1],
        ))

        # Frame 1: Bird A at (102, 101) has no saddle detection this frame.
        # But Bird B at (502, 501) generates a low-confidence false Yellow saddle (conf 0.25)!
        res1 = SimpleNamespace(boxes=FakeBoxes(
            xyxy=[[102, 101, 152, 151], [502, 501, 552, 551], [515, 515, 535, 535]],
            conf=[0.87, 0.83, 0.25],
            cls=[0, 0, 7],  # Chicken, Chicken, Saddle_Color_Yellow (false positive on B)
            tid=[101, 102, -1],
        ))

        frame_results = [res0, res1]
        tracker.model = type("MockModel", (), {
            "names": tracker.class_map,
            "track": lambda *args, **kwargs: [frame_results[min(tracker.processed_frame_count - 1, 1)]]
        })()

        blank = np.zeros((600, 600, 3), dtype=np.uint8)
        out0 = tracker.process_frame(blank, 0)
        birdA_f0 = next(b for b in out0.birds if b.box[0] < 200)
        # One frame is only one vote; don't turn it into eight votes and lock a label.
        self.assertEqual(birdA_f0.bird_label, "Chicken")
        self.assertEqual(birdA_f0.track_id, 7)
        self.assertEqual(tracker.hen_track_owners["Hen1 (Yellow)"], 1)

        out1 = tracker.process_frame(blank, 1)
        birdA_f1 = next(b for b in out1.birds if b.box[0] < 200)
        birdB_f1 = next(b for b in out1.birds if b.box[0] > 400)

        # A low-confidence tag on another bird cannot steal the owner's ID.
        self.assertEqual(birdA_f1.bird_label, "Chicken")
        self.assertEqual(birdA_f1.track_id, 7)
        self.assertNotEqual(birdB_f1.bird_label, "Hen1 (Yellow)")
        self.assertEqual(tracker.hen_track_owners["Hen1 (Yellow)"], 1)

    def test_walking_hen_maintains_saddle_identity_when_saddle_occluded_and_track_id_shifts(self):
        from types import SimpleNamespace
        tracker = object.__new__(ZampenYOLOTracker)
        tracker.track_label_cache = {}
        tracker.track_label_votes = {}
        tracker.track_label_last_seen = {}
        tracker.track_tag_confirmed = set()
        tracker.track_class_history = {}
        tracker.track_resolved_classes = {}
        tracker.track_class_last_seen = {}
        tracker.processed_frame_count = 5
        tracker.short_id_map = {}
        tracker._next_short_id = 1
        tracker.short_track_positions = {}
        tracker.short_track_sizes = {}
        tracker.track_last_label = {}
        tracker.label_owner = {}
        tracker.hen_track_owners = {}
        tracker.hen_owner_conf = {}
        tracker.hen_owner_last_frame = {}
        tracker.track_saddle_conf = {}
        tracker._unidentified_id_map = {}
        tracker.class_map = {
            0: "Chicken",
            1: "Drinker",
            2: "Feeder",
            3: "Rooster",
            4: "Saddle_Color_Blue",
            5: "Saddle_Color_Red",
            6: "Saddle_Color_White",
            7: "Saddle_Color_Yellow",
            8: "Saddle_Color_YellowGreen",
        }
        tracker.conf = 0.25
        tracker.iou = 0.45
        tracker.imgsz = 640
        tracker.device = "cpu"
        tracker.tracker_yaml = "bytetrack.yaml"
        tracker.track_conf = 0.15
        tracker.MIN_DETECTION_CONFIDENCE = 0.25
        tracker.MIN_SADDLE_CONFIDENCE = 0.15
        tracker.REIDENTIFICATION_MAX_GAP_FRAMES = 90
        tracker.REIDENTIFICATION_DISTANCE_RATIO = 0.22
        tracker.REIDENTIFICATION_MIN_DISTANCE_PX = 30.0
        tracker.REIDENTIFICATION_STALE_RATIO = 0.15
        tracker.REIDENTIFICATION_STALE_AFTER_FRAMES = 45
        tracker.REIDENTIFICATION_SIZE_TOLERANCE = 0.75
        tracker.LABEL_REUSE_COOLDOWN_FRAMES = 90

        class FakeTensor:
            def __init__(self, values):
                self.values = np.asarray(values)
            def cpu(self): return self
            def numpy(self): return self.values
            def int(self): return FakeTensor(self.values.astype(int))
            def tolist(self): return self.values.tolist()

        class FakeBoxes:
            def __init__(self, xyxy, conf, cls, tid):
                self.xyxy = FakeTensor(xyxy)
                self.conf = FakeTensor(conf)
                self.cls = FakeTensor(cls)
                self.id = FakeTensor(tid) if tid is not None else None
            def __len__(self):
                return len(self.xyxy.values)

        res_frame5 = SimpleNamespace(boxes=FakeBoxes(
            xyxy=[[100, 200, 160, 280], [115, 220, 145, 250]],
            conf=[0.85, 0.85],
            cls=[0, 8],  # Chicken, Saddle_Color_YellowGreen
            tid=[10, -1],
        ))

        res_frame6 = SimpleNamespace(boxes=FakeBoxes(
            xyxy=[[105, 270, 165, 350]],
            conf=[0.83],
            cls=[0],  # Chicken only, saddle occluded!
            tid=[15],  # Raw ByteTrack ID shifted
        ))

        test_frames = [res_frame5, res_frame6]
        tracker.model = type("MockModel", (), {
            "names": tracker.class_map,
            "track": lambda *args, **kwargs: [test_frames[tracker.processed_frame_count - 6]]
        })()

        blank = np.zeros((640, 640, 3), dtype=np.uint8)
        out5 = tracker.process_frame(blank, 5)
        self.assertEqual(len(out5.birds), 1)
        self.assertEqual(out5.birds[0].bird_label, "Hen5 (YellowGreen)")
        self.assertEqual(out5.birds[0].track_id, 5)

        # In Frame 6, walking hen must retain Hen5 (YellowGreen) and track_id 5!
        out6 = tracker.process_frame(blank, 6)
        self.assertEqual(len(out6.birds), 1)
        self.assertEqual(out6.birds[0].bird_label, "Hen5 (YellowGreen)")
        self.assertEqual(out6.birds[0].track_id, 5)

    def test_occluded_hens_do_not_swap_or_mismatch_labels(self):
        """When two confirmed hens overlap (occlude), a neighbour's saddle must not overwrite labels."""
        from types import SimpleNamespace
        from analytics.tracker import ZampenYOLOTracker

        tracker = ZampenYOLOTracker.__new__(ZampenYOLOTracker)
        tracker.class_map = {
            0: "Chicken",
            1: "Rooster",
            4: "Saddle_Color_Blue",
            7: "Saddle_Color_Yellow",
        }
        tracker.track_label_cache = {}
        tracker.track_label_votes = {}
        tracker.track_label_last_seen = {}
        tracker.track_tag_confirmed = set()
        tracker.track_class_history = {}
        tracker.track_resolved_classes = {}
        tracker.track_class_last_seen = {}
        tracker.processed_frame_count = 5
        tracker.short_id_map = {}
        tracker._unidentified_id_map = {}
        tracker._next_short_id = 1
        tracker.short_track_positions = {}
        tracker.short_track_sizes = {}
        tracker.short_track_velocities = {}
        tracker.track_appearance_hist = {}
        tracker.track_last_label = {}
        tracker.label_owner = {}
        tracker.hen_track_owners = {}
        tracker.hen_owner_conf = {}
        tracker.hen_owner_last_frame = {}
        tracker.track_saddle_conf = {}
        tracker.cached_feeders = []
        tracker.cached_drinkers = []
        tracker._tracking_enabled = True
        tracker.conf = 0.25
        tracker.track_conf = 0.15
        tracker.iou = 0.45
        tracker.imgsz = 640
        tracker.device = "cpu"
        tracker.tracker_yaml = "bytetrack.yaml"
        tracker.flock_size = 0

        class FakeTensor:
            def __init__(self, arr):
                self._arr = np.array(arr)
            def cpu(self): return self
            def numpy(self): return self._arr
            def int(self): return self
            def tolist(self): return self._arr.tolist()

        class FakeBoxes:
            def __init__(self, xyxy, conf, cls, tid):
                self.xyxy = FakeTensor(xyxy)
                self.conf = FakeTensor(conf)
                self.cls = FakeTensor(cls)
                self.id = FakeTensor(tid)
            def __len__(self): return len(self.xyxy._arr)

        # Frame 6: Both hens clearly separated and confirmed with their saddles
        res_sep = SimpleNamespace(boxes=FakeBoxes(
            xyxy=[
                [100, 100, 180, 180],  # Hen1 (Yellow)
                [125, 120, 155, 150],  # Yellow saddle
                [300, 100, 380, 180],  # Hen2 (Blue)
                [325, 120, 355, 150],  # Blue saddle
            ],
            conf=[0.90, 0.85, 0.90, 0.85],
            cls=[0, 7, 0, 4],
            tid=[10, -1, 20, -1],
        ))

        # Frame 7: Both hens move together and overlap (IoU ~0.35), and a conflicting
        # Blue saddle box falls inside Hen1's bounding box!
        res_occ = SimpleNamespace(boxes=FakeBoxes(
            xyxy=[
                [180, 100, 260, 180],  # Hen1 (raw tid 10)
                [215, 100, 295, 180],  # Hen2 (raw tid 20), overlapping Hen1
                [205, 120, 235, 150],  # Conflicting Blue saddle bleeding onto Hen1
            ],
            conf=[0.88, 0.86, 0.55],
            cls=[0, 0, 4],
            tid=[10, 20, -1],
        ))

        frames_seq = [res_sep, res_occ]
        tracker.model = type("MockModel", (), {
            "names": tracker.class_map,
            "track": lambda *args, **kwargs: [frames_seq[tracker.processed_frame_count - 6]],
        })()

        blank = np.zeros((480, 640, 3), dtype=np.uint8)
        out_sep = tracker.process_frame(blank, 6)
        labels_sep = {b.raw_track_id: b.bird_label for b in out_sep.birds}
        self.assertEqual(labels_sep[10], "Hen1 (Yellow)")
        self.assertEqual(labels_sep[20], "Hen2 (Blue)")

        # During occlusion, both birds MUST keep their original confirmed labels (no swap!)
        out_occ = tracker.process_frame(blank, 7)
        labels_occ = {b.raw_track_id: b.bird_label for b in out_occ.birds}
        self.assertEqual(labels_occ[10], "Hen1 (Yellow)")
        self.assertEqual(labels_occ[20], "Hen2 (Blue)")

    def test_appearance_reid_prevents_crossing_id_swap(self):
        """When two distinctly coloured birds cross paths and get new raw IDs, HSV appearance keeps their IDs."""
        from analytics.tracker import ZampenYOLOTracker, TrackedDetection

        tracker = ZampenYOLOTracker.__new__(ZampenYOLOTracker)
        tracker.processed_frame_count = 10
        tracker.short_id_map = {}
        tracker.short_track_positions = {}
        tracker.short_track_sizes = {}
        tracker.short_track_velocities = {}
        tracker.track_appearance_hist = {}
        tracker.track_label_cache = {}
        tracker.track_label_votes = {}
        tracker.track_tag_confirmed = set()
        tracker._next_short_id = 1
        tracker.flock_size = 0

        # Frame 10: Yellow bird on left (100..180), Blue bird on right (220..300)
        frame1 = np.zeros((360, 480, 3), dtype=np.uint8)
        frame1[100:180, 100:180] = (0, 220, 220)   # Yellow in BGR
        frame1[100:180, 220:300] = (220, 50, 0)    # Blue in BGR

        b1 = TrackedDetection(box=[100, 100, 180, 180], centroid=(140, 140), confidence=0.9, class_id=0, class_name="Chicken", track_id=101, bird_label="Chicken")
        b2 = TrackedDetection(box=[220, 100, 300, 180], centroid=(260, 140), confidence=0.9, class_id=0, class_name="Chicken", track_id=102, bird_label="Chicken")
        tracker._assign_display_ids([b1, b2], frame1.shape, frame=frame1)
        yellow_id = b1.track_id
        blue_id = b2.track_id
        self.assertNotEqual(yellow_id, blue_id)

        # Frame 12: Both birds finished crossing paths and separated with brand-new raw IDs!
        # Blue bird is now at (120..190) [closer to Yellow's old pos], Yellow bird is at (210..280) [closer to Blue's old pos]
        tracker.processed_frame_count = 12
        frame2 = np.zeros((360, 480, 3), dtype=np.uint8)
        frame2[100:180, 120:190] = (220, 50, 0)    # Blue in BGR (now on left)
        frame2[100:180, 210:280] = (0, 220, 220)   # Yellow in BGR (now on right)

        b_left_blue = TrackedDetection(box=[120, 100, 190, 180], centroid=(155, 140), confidence=0.9, class_id=0, class_name="Chicken", track_id=201, bird_label="Chicken")
        b_right_yellow = TrackedDetection(box=[210, 100, 280, 180], centroid=(245, 140), confidence=0.9, class_id=0, class_name="Chicken", track_id=202, bird_label="Chicken")
        tracker._assign_display_ids([b_left_blue, b_right_yellow], frame2.shape, frame=frame2)

        self.assertEqual(b_left_blue.track_id, blue_id)
        self.assertEqual(b_right_yellow.track_id, yellow_id)

    def test_live_saddle_reclaims_identity_from_unsaddled_incumbent(self):
        """If an unsaddled chicken holds a Hen label with no live YOLO saddle for >=10 frames,
        the real chicken wearing the live YOLO saddle must reclaim the label immediately."""
        from types import SimpleNamespace
        from analytics.tracker import ZampenYOLOTracker

        tracker = ZampenYOLOTracker.__new__(ZampenYOLOTracker)
        tracker.class_map = {
            0: "Chicken",
            3: "Rooster",
            8: "Saddle_Color_YellowGreen",
        }
        tracker.track_label_cache = {5: "Hen5 (YellowGreen)"}
        tracker.track_label_votes = {5: __import__("collections").deque(["Hen5 (YellowGreen)"] * 10, maxlen=15)}
        tracker.track_label_last_seen = {5: 100}
        tracker.track_tag_confirmed = {5}
        tracker.track_class_history = {}
        tracker.track_resolved_classes = {}
        tracker.track_class_last_seen = {}
        tracker.processed_frame_count = 115
        tracker.short_id_map = {10: 5, 20: 7}
        tracker._unidentified_id_map = {}
        tracker._next_short_id = 8
        tracker.short_track_positions = {5: ((150.0, 200.0), 114), 7: ((300.0, 320.0), 114)}
        tracker.short_track_sizes = {5: 70.0, 7: 70.0}
        tracker.short_track_velocities = {}
        tracker.track_appearance_hist = {}
        tracker.track_last_label = {5: "Hen5 (YellowGreen)"}
        tracker.label_owner = {"Hen5 (YellowGreen)": (5, 114)}
        tracker.hen_track_owners = {"Hen5 (YellowGreen)": 5}
        tracker.hen_owner_conf = {"Hen5 (YellowGreen)": 0.85}
        tracker.hen_owner_last_frame = {"Hen5 (YellowGreen)": 114}
        tracker.hen_last_yolo_saddle_frame = {"Hen5 (YellowGreen)": 90}  # >=10 frames without live YOLO saddle
        tracker.track_saddle_conf = {5: 0.85}
        tracker.cached_feeders = []
        tracker.cached_drinkers = []
        tracker._tracking_enabled = True
        tracker.conf = 0.25
        tracker.track_conf = 0.15
        tracker.iou = 0.45
        tracker.imgsz = 640
        tracker.device = "cpu"
        tracker.tracker_yaml = "bytetrack.yaml"
        tracker.flock_size = 0

        class FakeTensor:
            def __init__(self, arr):
                self._arr = np.array(arr)
            def cpu(self): return self
            def numpy(self): return self._arr
            def int(self): return self
            def tolist(self): return self._arr.tolist()

        class FakeBoxes:
            def __init__(self, xyxy, conf, cls, tid):
                self.xyxy = FakeTensor(xyxy)
                self.conf = FakeTensor(conf)
                self.cls = FakeTensor(cls)
                self.id = FakeTensor(tid)
            def __len__(self): return len(self.xyxy._arr)

        # Unsaddled bird (raw tid 10) at middle-left; real YellowGreen saddled bird (raw tid 20) at bottom
        res = SimpleNamespace(boxes=FakeBoxes(
            xyxy=[
                [110, 160, 190, 240],  # Unsaddled incumbent (raw 10)
                [260, 280, 340, 360],  # Real YellowGreen hen (raw 20)
                [285, 305, 315, 330],  # Live Saddle_Color_YellowGreen on raw 20
            ],
            conf=[0.80, 0.72, 0.55],
            cls=[0, 0, 8],
            tid=[10, 20, -1],
        ))
        tracker.model = type("MockModel", (), {
            "names": tracker.class_map,
            "track": lambda *args, **kwargs: [res],
        })()

        blank = np.zeros((400, 640, 3), dtype=np.uint8)
        out = tracker.process_frame(blank, 116)
        by_raw = {b.raw_track_id: b for b in out.birds}
        self.assertEqual(by_raw[20].bird_label, "Hen5 (YellowGreen)")
        self.assertEqual(by_raw[20].track_id, 5)
        self.assertEqual(by_raw[10].bird_label, "Chicken")


if __name__ == "__main__":
    unittest.main()
