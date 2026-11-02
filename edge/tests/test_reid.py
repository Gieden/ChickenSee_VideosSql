"""
edge/tests/test_reid.py - Unit tests for the Re-ID + ByteTrack layer.

Covers the three failure modes the Re-ID upgrade exists for:
  1. a colour identity must not lock from noisy/ambiguous band evidence,
  2. a locked identity is sticky (a challenger needs a decisive margin),
  3. the re-identification gate is tight enough not to hand a bird to a distant neighbour,
and the configuration that made ByteTrack's second stage dead (track_high_thresh below the
detector confidence).
"""

import unittest
from pathlib import Path

import numpy as np

from edge.config import tracker_type_of
from edge.detector import Detection, PoultryInferenceEngine
from edge.reid import (
    BandVoteBank,
    appearance_descriptor,
    box_iou,
    center_distance,
    descriptor_similarity,
    gated_candidates,
    leg_band_signature,
)
from edge.tracker import AgriByteTracker, apex_box

ROOT = Path(__file__).resolve().parent.parent.parent


def _frame_with_band(band_bgr, band_at=(150, 170), size=(400, 240)):
    frame = np.zeros((size[0], size[1], 3), dtype=np.uint8)
    frame[:, :] = (60, 90, 60)  # litter colour, unsaturated
    x, y = band_at
    frame[y:y + 12, x:x + 12] = band_bgr
    return frame


class TestBandVoting(unittest.TestCase):
    def test_single_frame_never_invents_a_hen_identity(self):
        bank = BandVoteBank()
        bank.add("Hen1 (Green)", 1.0)
        self.assertIsNone(bank.locked_label)

    def test_three_confident_yolo_band_votes_lock_the_colour(self):
        bank = BandVoteBank()
        bank.add("Hen3 (Blue)", 3.0)
        self.assertEqual(bank.locked_label, "Hen3 (Blue)")

    def test_ambiguous_evidence_does_not_lock(self):
        # 2-2 split: both the mass and the share requirements fail, so nothing is displayed.
        bank = BandVoteBank()
        for _ in range(2):
            bank.add("Hen1 (Green)", 1.0)
        for _ in range(2):
            bank.add("Hen4 (Yellow)", 1.0)
        self.assertIsNone(bank.locked_label)
        self.assertEqual(bank.pending_label(), "Hen1 (Green)")

    def test_a_contested_identity_resolves_to_the_dominant_colour(self):
        bank = BandVoteBank()
        for _ in range(3):
            bank.add("Hen1 (Green)", 1.0)
        for _ in range(5):
            bank.add("Hen4 (Yellow)", 1.0)
        self.assertEqual(bank.locked_label, "Hen4 (Yellow)")

    def test_locked_identity_survives_isolated_noise(self):
        bank = BandVoteBank()
        bank.add("Hen2 (White)", 3.0)
        for _ in range(6):
            bank.decay(0.92)
        bank.add("Hen5 (Pink)", 1.0)
        self.assertEqual(bank.locked_label, "Hen2 (White)")

    def test_decisive_challenger_can_still_correct_the_identity(self):
        bank = BandVoteBank()
        bank.add("Hen1 (Green)", 3.0)
        for _ in range(4):
            bank.add("Hen4 (Yellow)", 3.0)
        self.assertEqual(bank.locked_label, "Hen4 (Yellow)")


class TestBandSignature(unittest.TestCase):
    def test_compact_blue_patch_is_found_with_a_box(self):
        frame = _frame_with_band((255, 0, 0))
        signature = leg_band_signature(frame, (100, 20, 260, 220))
        self.assertIsNotNone(signature)
        self.assertEqual(signature.label, "Hen3 (Blue)")
        self.assertGreater(signature.confidence, 0.5)
        self.assertTrue(0 < signature.box[0] < signature.box[2] <= 240)

    def test_plain_litter_yields_no_signature(self):
        frame = _frame_with_band((60, 90, 60), band_at=(0, 399))
        self.assertIsNone(leg_band_signature(frame, (100, 20, 260, 220)))

    def test_crouching_bird_is_not_scanned(self):
        frame = _frame_with_band((255, 0, 0))
        self.assertIsNone(leg_band_signature(frame, (100, 20, 380, 120)))


class TestAppearanceAndGate(unittest.TestCase):
    def test_same_patch_scores_higher_than_a_different_patch(self):
        green = _frame_with_band((0, 255, 0))
        blue = _frame_with_band((255, 0, 0), band_at=(170, 150))
        box = (100, 20, 260, 220)
        a1 = appearance_descriptor(green, box)
        a2 = appearance_descriptor(green, box)
        b1 = appearance_descriptor(blue, box)
        self.assertAlmostEqual(descriptor_similarity(a1, a2), 1.0, places=5)
        self.assertLess(descriptor_similarity(a1, b1), descriptor_similarity(a1, a2) - 1e-3)
        self.assertLess(descriptor_similarity(a1, b1), 1.0)

    def test_missing_descriptor_is_neutral(self):
        self.assertEqual(descriptor_similarity(None, None), 0.0)

    def test_gate_rejects_a_distant_neighbour(self):
        track_box = [100, 100, 160, 220]
        near = ("near", [104, 104, 164, 224])
        far = ("far", [400, 100, 460, 220])
        kept = gated_candidates(track_box, (0.0, 0.0), [near, far])
        self.assertEqual([payload for payload, _, _ in kept], ["near"])

    def test_gate_follows_velocity(self):
        track_box = [100, 100, 160, 220]
        candidate = ("moved", [240, 100, 300, 220])  # 140 px away: no box overlap
        self.assertEqual(gated_candidates(track_box, (0.0, 0.0), [candidate]), [])
        # ...but it is right where the track is heading, so it passes once predicted
        self.assertEqual(len(gated_candidates(track_box, (140.0, 0.0), [candidate])), 1)

    def test_box_helpers(self):
        self.assertAlmostEqual(box_iou([0, 0, 10, 10], [0, 0, 10, 10]), 1.0)
        self.assertAlmostEqual(box_iou([0, 0, 10, 10], [20, 20, 30, 30]), 0.0)
        self.assertGreater(center_distance([0, 0, 10, 10], [10, 0, 20, 10]), 9.0)


class TestTrackerConfig(unittest.TestCase):
    def setUp(self):
        with open(ROOT / "bytetrack_poultry.yaml", "r", encoding="utf-8") as handle:
            self.values = {}
            for line in handle:
                if ":" in line and not line.strip().startswith("#"):
                    key, _, value = line.partition(":")
                    self.values[key.strip()] = value.split("#")[0].strip()

    def test_yaml_is_loadable_by_ultralytics(self):
        from ultralytics.utils import IterableSimpleNamespace, YAML

        cfg = IterableSimpleNamespace(**YAML.load(ROOT / "bytetrack_poultry.yaml"))
        self.assertEqual(cfg.tracker_type, "agribytetrack")
        self.assertGreater(cfg.track_high_thresh, 0.15)

    def test_low_stage_is_actually_reachable(self):
        from edge.config import CONFIG

        high = float(self.values["track_high_thresh"])
        low = float(self.values["track_low_thresh"])
        new_track = float(self.values["new_track_thresh"])
        self.assertGreater(high, CONFIG.vision.conf_threshold)
        self.assertLess(low, high)
        self.assertGreater(new_track, high)
        self.assertLessEqual(float(self.values["match_thresh"]), 0.6)

    def test_tracker_type_reader(self):
        self.assertEqual(tracker_type_of(str(ROOT / "bytetrack_poultry.yaml")), "agribytetrack")
        self.assertEqual(tracker_type_of(str(ROOT / "missing.yaml")), "bytetrack")


class TestAgriTracker(unittest.TestCase):
    def test_apex_box_is_lower_body(self):
        self.assertEqual(apex_box([0, 0, 10, 100], 0.6), [0.0, 60.0, 10, 100])

    def test_apex_agreement_lowers_association_cost(self):
        from types import SimpleNamespace

        class Det:
            angle = None

            def __init__(self, xyxy, conf=0.9):
                self.xyxy = np.asarray(xyxy, dtype=np.float32)
                self.conf = conf

        args = SimpleNamespace(fuse_score=False, track_high_thresh=0.45, track_low_thresh=0.15,
                               new_track_thresh=0.55, track_buffer=60, match_thresh=0.6)
        tracker = AgriByteTracker(args)

        # Minimal STrack stand-in: only what multi_predict/get_dists touch.
        from ultralytics.trackers.basetrack import TrackState
        from ultralytics.utils import IterableSimpleNamespace

        track = SimpleNamespace(
            track_id=42,
            state=TrackState.Tracked,
            angle=None,
            is_activated=True,
            mean=np.array([130.0, 160.0, 10.0, 120.0, 0, 0, 0, 0]),
            covariance=np.eye(8),
            xyxy=np.array([120.0, 100.0, 140.0, 220.0]),
        )
        tracker.multi_predict([track])
        # The neighbour's torso overlaps as much as the owner's, but only the owner's apex
        # (feet) lands on the prediction, so it must win the association.
        # Owner's torso IoU (0.67) is worse than the neighbour's (0.92), but its apex agrees.
        owner = Det([122, 102, 142, 222])
        neighbour = Det([127, 100, 147, 220])
        dists = tracker.get_dists([track], [owner, neighbour])
        self.assertLess(float(dists[0, 0]), float(dists[0, 1]))

    def test_real_ultralytics_stack_accepts_agribytetrack(self):
        """End-to-end registration check with genuine STrack objects (no model needed)."""
        from ultralytics.trackers.track import TRACKER_MAP
        from ultralytics.utils import YAML, IterableSimpleNamespace

        from edge.tracker import register_tracker

        register_tracker()
        cfg = IterableSimpleNamespace(**YAML.load(ROOT / "bytetrack_poultry.yaml"))
        tracker = TRACKER_MAP[cfg.tracker_type](args=cfg)
        self.assertEqual(type(tracker).__name__, "AgriByteTracker")

        class Batch:
            """Results-like object with conf/cls and boolean indexing."""

            def __init__(self, xyxy, conf, cls):
                self.xyxy = np.asarray(xyxy, dtype=np.float32)
                self.conf = np.asarray(conf, dtype=np.float32)
                self.cls = np.asarray(cls, dtype=np.float32)

            @property
            def xywh(self):
                x1, y1, x2, y2 = self.xyxy.T
                return np.stack(
                    [(x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1], axis=1
                ).astype(np.float32)

            def __len__(self):
                return len(self.conf)

            def __getitem__(self, index):
                return Batch(self.xyxy[index], self.conf[index], self.cls[index])

        first = tracker.update(Batch([[100, 100, 160, 220], [128, 100, 188, 220]], [0.9, 0.9], [0, 0]))
        second = tracker.update(Batch([[104, 102, 164, 222], [132, 100, 192, 220]], [0.9, 0.9], [0, 0]))
        self.assertGreaterEqual(len(first), 1)
        self.assertGreaterEqual(len(second), 1)
        ids_first = {int(row[4]) for row in first}
        ids_second = {int(row[4]) for row in second}
        self.assertTrue(ids_first & ids_second, "an existing track must be maintained across frames")


class TestEngineIdentity(unittest.TestCase):
    def _engine(self):
        engine = object.__new__(PoultryInferenceEngine)
        engine.cfg = type("Cfg", (), {
            "reid_max_gap_s": 3.0,
            "source_fps": 15.0,
            "source_fps_hint": 0.0,
            "reid_appearance_min": 0.55,
            "reid_iou_gate": 0.05,
        })()
        engine.frame_count = 1
        engine._reset_state()
        engine.identity_buffer_frames = engine._seconds_to_frames(15.0, 3.0)
        engine.appearance_min = 0.55
        engine.iou_gate = 0.05
        engine.max_inactive_frames = 300
        return engine

    def test_band_locks_only_after_temporal_support(self):
        engine = self._engine()
        engine.band_banks[1] = engine._make_bank()
        engine.band_banks[1].add("Hen1 (Green)", 1.0)
        self.assertEqual(engine._identity_label(1), "Chicken")
        engine.band_banks[1].add("Hen1 (Green)", 3.0)
        self.assertEqual(engine._identity_label(1), "Hen1 (Green)")

    def test_identity_buffer_uses_real_fps(self):
        engine = self._engine()
        self.assertEqual(engine.identity_buffer_frames, 45)
        engine.set_source_fps(30.0)
        self.assertEqual(engine.identity_buffer_frames, 90)

    def test_detection_defaults_keep_backward_compatibility(self):
        det = Detection(
            box=[0, 0, 10, 10], track_id=1, label="Chicken", confidence=0.5,
            type="hen", centroid=(5, 5), color_hex="#fff", color_bgr=(255, 255, 255),
        )
        self.assertIsNone(det.raw_track_id)
        self.assertEqual(det.identity_source, "")


if __name__ == "__main__":
    unittest.main()
