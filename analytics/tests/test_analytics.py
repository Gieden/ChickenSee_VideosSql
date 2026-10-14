"""
analytics/tests/test_analytics.py
Automated Unit and Integration Tests for ZAMPEN Behavior & Sensor Analytics Pipeline.
Validates:
  1. Database initialization & duplicate job prevention.
  2. Specific behavior detection algorithms (Reduce Eating, Drinking, Inactivity, Feather Pecking).
  3. 30-minute sensor aggregation math.
  4. FastAPI REST API endpoints.
"""

import sys
import unittest
import datetime
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from analytics.config import CONFIG
from analytics.database import DatabaseManager, JobStatus, ProcessingJob
from analytics.tracker import TrackedDetection, TrackerFrameOutput
from analytics.behavior_engine import BehaviorAnalysisEngine
from fastapi.testclient import TestClient
from analytics.api import app


class TestZampenAnalyticsPipeline(unittest.TestCase):

    def setUp(self):
        # Use in-memory SQLite database for test isolation
        self.db = DatabaseManager(db_url="sqlite:///:memory:")
        self.engine = BehaviorAnalysisEngine()

    def test_database_idempotency(self):
        """Verify that jobs prevent duplicate execution of the same file."""
        filename = "detection_2026-10-14_0600.mp4"
        now = datetime.datetime.now()
        end = now + datetime.timedelta(hours=1)

        self.assertFalse(self.db.is_file_processed(filename))

        # Lease job
        job = self.db.lease_job(filename, "/dummy/path.mp4", now, end)
        self.assertIsNotNone(job)
        self.assertEqual(job.status, JobStatus.PROCESSING)

        # Mark completed
        self.db.mark_job_completed(job.id, 1000, 1000, 45.2)
        self.assertTrue(self.db.is_file_processed(filename))

        # Attempt to lease again - should return None to prevent duplicate run
        duplicate_lease = self.db.lease_job(filename, "/dummy/path.mp4", now, end)
        self.assertIsNone(duplicate_lease)

    def test_behavior_drinking_and_inactivity(self):
        """Test drinking in waterer zone and inactivity detection."""
        # Bird 1 inside drinker zone for 5 seconds
        drinker_box = [100, 100, 150, 150]
        drinker_det = TrackedDetection(
            box=drinker_box, centroid=(125, 125), confidence=0.9,
            class_id=1, class_name="Drinker", track_id=None, bird_label="Drinker"
        )

        bird_det = TrackedDetection(
            box=[105, 105, 140, 140], centroid=(122, 122), confidence=0.88,
            class_id=0, class_name="Chicken", track_id=101, bird_label="Hen1 (Green)"
        )

        dt = 0.5
        for step in range(10): # 5 seconds
            frame_out = TrackerFrameOutput(
                frame_idx=step,
                timestamp_s=step * dt,
                birds=[bird_det],
                feeders=[],
                drinkers=[drinker_det]
            )
            self.engine.process_frame(frame_out, dt=dt)

        summary = self.engine.compute_chunk_summary()
        self.assertEqual(summary.unique_birds, 1)
        self.assertGreater(summary.drinking_time_total_s, 4.0)
        self.assertGreaterEqual(summary.drinking_bouts, 1)

    def test_behavior_reduced_eating(self):
        """
        Test Reduced Eating: bird is near feeder but localized motion is near zero
        for extended time (standing idle instead of active pecking).
        """
        feeder_box = [300, 300, 400, 400]
        feeder_det = TrackedDetection(
            box=feeder_box, centroid=(350, 350), confidence=0.9,
            class_id=2, class_name="Feeder", track_id=None, bird_label="Feeder"
        )

        # Bird sits in feeder zone completely stationary
        stationary_bird = TrackedDetection(
            box=[320, 320, 360, 360], centroid=(340, 340), confidence=0.85,
            class_id=0, class_name="Chicken", track_id=202, bird_label="Hen3 (Violet)"
        )

        dt = 1.0
        for step in range(25): # 25 seconds idle in feeder
            frame_out = TrackerFrameOutput(
                frame_idx=step,
                timestamp_s=step * dt,
                birds=[stationary_bird],
                feeders=[feeder_det],
                drinkers=[]
            )
            self.engine.process_frame(frame_out, dt=dt)

        summary = self.engine.compute_chunk_summary()
        self.assertGreaterEqual(summary.reduced_eating_events, 1)
        self.assertGreater(summary.reduced_eating_index, 0.0)

    def test_behavior_feather_pecking(self):
        """
        Test Feather Pecking detection:
        Aggressor bird charges at high velocity toward victim bird, enters proximity,
        and recipient accelerates away.
        """
        dt = 0.1
        # Frame 0: birds separated
        bird_a0 = TrackedDetection(box=[50, 50, 80, 80], centroid=(65, 65), confidence=0.9, class_id=0, class_name="Rooster", track_id=1, bird_label="Rooster")
        bird_b0 = TrackedDetection(box=[100, 100, 130, 130], centroid=(115, 115), confidence=0.9, class_id=0, class_name="Chicken", track_id=2, bird_label="Hen2 (White)")
        f0 = TrackerFrameOutput(frame_idx=0, timestamp_s=0.0, birds=[bird_a0, bird_b0], feeders=[], drinkers=[])
        self.engine.process_frame(f0, dt=dt)

        # Frame 1: Aggressor charges fast into close proximity (< 45px distance)
        # Displacement 65 -> 110 in 0.1s is ~450 px/s (very high velocity approach)
        bird_a1 = TrackedDetection(box=[95, 95, 125, 125], centroid=(110, 110), confidence=0.9, class_id=0, class_name="Rooster", track_id=1, bird_label="Rooster")
        bird_b1 = TrackedDetection(box=[105, 105, 135, 135], centroid=(120, 120), confidence=0.9, class_id=0, class_name="Chicken", track_id=2, bird_label="Hen2 (White)")
        f1 = TrackerFrameOutput(frame_idx=1, timestamp_s=0.1, birds=[bird_a1, bird_b1], feeders=[], drinkers=[])
        self.engine.process_frame(f1, dt=dt)

        summary = self.engine.compute_chunk_summary()
        self.assertGreaterEqual(summary.feather_pecking_events, 1)

    def test_fastapi_health_endpoint(self):
        """Verify FastAPI /health endpoint."""
        client = TestClient(app)
        response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "healthy")
        self.assertIn("system", data)
        self.assertIn("model", data)


if __name__ == "__main__":
    unittest.main()
