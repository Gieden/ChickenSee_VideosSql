import sqlite3
import tempfile
import unittest
from pathlib import Path

from analytics.sensor_utils import find_paired_sensor_db, read_sensor_db_status


class TestSensorUtils(unittest.TestCase):
    def test_find_and_read_paired_sensors_sqlite(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            session_dir = Path(tmpdir) / "cam01" / "sulayanato"
            session_dir.mkdir(parents=True, exist_ok=True)

            video_path = session_dir / "video2.mp4"
            video_path.write_bytes(b"")

            db_path = session_dir / "sensors.sqlite"
            conn = sqlite3.connect(str(db_path))
            conn.execute(
                """
                CREATE TABLE sensor_logs (
                    frame_index INTEGER,
                    elapsed_seconds REAL,
                    video_time TEXT,
                    captured_at TEXT,
                    temperature REAL,
                    humidity REAL,
                    ammonia_ppm REAL,
                    sound_db REAL,
                    temp_status INTEGER,
                    hum_status INTEGER,
                    ammonia_status INTEGER,
                    sound_status INTEGER
                )
                """
            )
            conn.executemany(
                "INSERT INTO sensor_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (0, 0.0, "00:00", "2026-11-13T23:00:00+00:00", 30.0, 60.0, 0.00004, 70.0, 0, 0, 0, 0),
                    (1, 0.05, "00:00", "2026-11-13T23:00:00+00:00", 32.0, 58.0, 0.00005, 75.0, 0, 0, 0, 0),
                    (2, 0.10, "00:00", "2026-11-13T23:00:00+00:00", 36.0, 53.0, 0.00004, 83.6, 0, 0, 0, 1),
                ],
            )
            conn.commit()
            conn.close()

            found = find_paired_sensor_db(str(video_path))
            self.assertIsNotNone(found)
            self.assertEqual(found.resolve(), db_path.resolve())

            # First read (populates cache) and second read (hits cache)
            for _ in range(2):
                status = read_sensor_db_status(found, "video2_c9ced2ca.mp4", limit_recent=2)
                self.assertTrue(status["available"])
                self.assertEqual(status["total_records"], 3)
                self.assertEqual(status["paired_video"], "video2_c9ced2ca.mp4")
                self.assertEqual(len(status["recent_readings"]), 2)
                self.assertEqual(status["current"]["frame_index"], 2)
                self.assertAlmostEqual(status["current"]["temperature_c"], 36.0)
                self.assertAlmostEqual(status["summary"]["temp_min_c"], 30.0)
                self.assertAlmostEqual(status["summary"]["temp_max_c"], 36.0)


if __name__ == "__main__":
    unittest.main()
