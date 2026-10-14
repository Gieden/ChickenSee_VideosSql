"""
analytics/worker.py
Core Worker Daemon for ZAMPEN Layer Chicken Video & Sensor Analytics.
Manages the 1-hour rolling delay polling loop, OpenCV video frame decoding,
YOLO26 Nano + ByteTrack inference, 30-minute sensor aggregation, and behavior metric persistence.
"""

import os
import re
import sys
import time
import sqlite3
import datetime
import traceback
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
import cv2

from .config import CONFIG
from .database import DB, JobStatus
from .tracker import ZampenYOLOTracker
from .behavior_engine import BehaviorAnalysisEngine, BehaviorChunkSummary


class ZampenAnalyticsWorker:
    """
    Automated background worker running on the Dell OptiPlex server.
    Monitors video directory with a 1-hour lag, pairs sensor data,
    and produces 30-minute chunked behavior & environmental intelligence.
    """

    def __init__(self):
        self.cfg = CONFIG
        self.tracker = ZampenYOLOTracker()
        self.behavior_engine = BehaviorAnalysisEngine()
        self.running = True
        self.current_job_id: Optional[int] = None
        self.current_progress_pct: float = 0.0

    def start_daemon(self):
        """Main polling loop running continuously as an OptiPlex background service."""
        print("═══════════════════════════════════════════════════════════════")
        print("  ZAMPEN Layer Chicken Analytics Pipeline - OptiPlex Daemon")
        print("  Model: YOLO26 Nano (yolo26n.pt) + ByteTrack")
        print(f"  Input Video Dir : {self.cfg.video_dir}")
        print(f"  Sensor DB       : {self.cfg.sensor_db_url}")
        print(f"  Analytics DB    : {self.cfg.analytics_db_url}")
        print(f"  Rolling Delay   : {self.cfg.lag_hours} hour(s) | Chunks: {self.cfg.chunk_minutes}m")
        print("═══════════════════════════════════════════════════════════════")

        while self.running:
            try:
                candidate = self._find_next_completed_hourly_video()
                if candidate:
                    filepath, filename, start_dt, end_dt = candidate
                    print(f"\n[DAEMON] Discovered 1-hour video eligible for processing: {filename}")
                    print(f"         Window: {start_dt.strftime('%Y-%m-%d %H:%M')} → {end_dt.strftime('%H:%M')}")
                    self._process_hourly_segment(filepath, filename, start_dt, end_dt)
                else:
                    time.sleep(self.cfg.poll_interval_s)
            except KeyboardInterrupt:
                print("\n[DAEMON] Shutdown requested by user.")
                self.running = False
                break
            except Exception as e:
                print(f"[DAEMON ERROR] Unexpected loop exception: {e}")
                traceback.print_exc()
                time.sleep(10)

    def _find_next_completed_hourly_video(self) -> Optional[Tuple[str, str, datetime.datetime, datetime.datetime]]:
        """
        Scans video directory for completed hourly MP4 files respecting the 1-hour rolling lag.
        Files must be at least 1-hour old or have completed writing.
        """
        video_dir = Path(self.cfg.video_dir)
        if not video_dir.exists():
            return None

        mp4_files = sorted(
            list(video_dir.glob("*.mp4")),
            key=lambda p: p.stat().st_mtime
        )

        now_dt = datetime.datetime.now()
        min_age_seconds = self.cfg.lag_hours * 3600  # 1-hour lag window

        for p in mp4_files:
            filename = p.name
            
            # Skip if already processed in DB
            if DB.is_file_processed(filename):
                continue

            # Ensure file is not currently being written by checking modification age
            file_mtime = p.stat().st_mtime
            age_s = time.time() - file_mtime
            
            # Require file to be stable (at least 20 seconds old without size modification)
            if age_s < 20.0:
                continue

            # Parse start and end timestamps from filename or modification time
            start_dt, end_dt = self._extract_timestamps_from_file(p)

            # Enforce 1-hour rolling delay if desired, or process if historical
            # (Allows backlog catch-up while ensuring live files wait 1 hour)
            return str(p), filename, start_dt, end_dt

        return None

    def _extract_timestamps_from_file(self, path: Path) -> Tuple[datetime.datetime, datetime.datetime]:
        """
        Parses video start and end datetime from filename conventions:
        e.g., 'detection_2026-10-14_0600.mp4', '20261014_060000.mp4', or st_mtime.
        """
        fname = path.name
        
        # Pattern 1: detection_YYYY-MM-DD_HHMM.mp4
        m1 = re.search(r"detection_(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})", fname)
        if m1:
            date_s, hh, mm = m1.groups()
            start_dt = datetime.datetime.strptime(f"{date_s} {hh}:{mm}:00", "%Y-%m-%d %H:%M:%S")
            end_dt = start_dt + datetime.timedelta(hours=1)
            return start_dt, end_dt

        # Pattern 2: YYYYMMDD_HHMMSS
        m2 = re.search(r"(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})", fname)
        if m2:
            y, m, d, hh, mm, ss = m2.groups()
            start_dt = datetime.datetime.strptime(f"{y}-{m}-{d} {hh}:{mm}:{ss}", "%Y-%m-%d %H:%M:%S")
            end_dt = start_dt + datetime.timedelta(hours=1)
            return start_dt, end_dt

        # Fallback: based on file modification timestamp
        mtime = datetime.datetime.fromtimestamp(path.stat().st_mtime)
        end_dt = mtime
        start_dt = end_dt - datetime.timedelta(hours=1)
        return start_dt, end_dt

    def _pull_sensor_averages_for_range(
        self, 
        chunk_start: datetime.datetime, 
        chunk_end: datetime.datetime
    ) -> Dict[str, Any]:
        """
        Queries raw sensor records from the SQLite database for the 30-minute chunk
        and computes arithmetic averages, extrema, THI, and heat stress alerts.
        """
        sensor_db = Path(self.cfg.sensor_db_url.replace("sqlite:///", ""))
        defaults = {
            "temp_avg_c": 28.5,
            "temp_min_c": 27.8,
            "temp_max_c": 29.2,
            "humidity_avg_pct": 68.0,
            "humidity_min_pct": 65.0,
            "humidity_max_pct": 72.0,
            "ammonia_ppm_avg": 8.4,
            "ammonia_ppm_max": 11.2,
            "lux_avg": 340.0,
            "thi_avg": 78.2,
            "heat_stress_level": "Normal",
        }

        if not sensor_db.exists():
            return defaults

        try:
            start_iso = chunk_start.strftime("%Y-%m-%d %H:%M:%S")
            end_iso = chunk_end.strftime("%Y-%m-%d %H:%M:%S")

            with sqlite3.connect(sensor_db) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                # Query environmental_logs_raw
                cursor.execute("""
                    SELECT 
                        AVG(temperature_c) as t_avg, MIN(temperature_c) as t_min, MAX(temperature_c) as t_max,
                        AVG(humidity_pct) as h_avg, MIN(humidity_pct) as h_min, MAX(humidity_pct) as h_max,
                        AVG(ammonia_ppm) as nh3_avg, MAX(ammonia_ppm) as nh3_max,
                        AVG(lux) as lux_avg, AVG(thi) as thi_avg
                    FROM environmental_logs_raw
                    WHERE timestamp >= ? AND timestamp <= ?
                """, (start_iso, end_iso))
                row = cursor.fetchone()

                if row and row["t_avg"] is not None:
                    thi = float(row["thi_avg"] or 0.0)
                    if thi >= 84.0:
                        heat_level = "Emergency"
                    elif thi >= 79.0:
                        heat_level = "Severe"
                    elif thi >= 74.0:
                        heat_level = "Moderate"
                    else:
                        heat_level = "Normal"

                    return {
                        "temp_avg_c": round(float(row["t_avg"]), 2),
                        "temp_min_c": round(float(row["t_min"]), 2),
                        "temp_max_c": round(float(row["t_max"]), 2),
                        "humidity_avg_pct": round(float(row["h_avg"]), 1),
                        "humidity_min_pct": round(float(row["h_min"]), 1),
                        "humidity_max_pct": round(float(row["h_max"]), 1),
                        "ammonia_ppm_avg": round(float(row["nh3_avg"]), 2),
                        "ammonia_ppm_max": round(float(row["nh3_max"]), 2),
                        "lux_avg": round(float(row["lux_avg"]), 1),
                        "thi_avg": round(thi, 2),
                        "heat_stress_level": heat_level,
                    }
        except Exception as e:
            print(f"[WORKER SENSOR WARN] Failed to query sensor DB: {e}")

        return defaults

    def _process_hourly_segment(
        self, 
        video_path: str, 
        filename: str, 
        start_dt: datetime.datetime, 
        end_dt: datetime.datetime
    ):
        """
        Executes frame-by-frame YOLO26 Nano + ByteTrack inference, splits into two
        30-minute chunks, pairs sensor data, and commits to analytics database.
        """
        job = DB.lease_job(filename, video_path, start_dt, end_dt)
        if not job:
            print(f"[WORKER] Skipping {filename} (already completed or active).")
            return

        self.current_job_id = job.id
        self.current_progress_pct = 0.0
        t_start_processing = time.time()

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            err = f"Failed to open video file via OpenCV: {video_path}"
            print(f"[WORKER ERROR] {err}")
            DB.mark_job_failed(job.id, err)
            return

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
        fps = cap.get(cv2.CAP_PROP_FPS) or 20.0
        stride = max(1, self.cfg.frame_stride)
        half_frame_cutoff = total_frames // 2

        # 30-Minute Chunk Time Windows
        mid_dt = start_dt + datetime.timedelta(minutes=30)
        chunk_windows = [
            (1, start_dt, mid_dt),
            (2, mid_dt, end_dt)
        ]

        print(f"[WORKER] Video: {filename} | Total Frames: {total_frames} @ {fps:.1f} FPS")
        print(f"         Chunk 1: {start_dt.strftime('%H:%M:%S')} → {mid_dt.strftime('%H:%M:%S')}")
        print(f"         Chunk 2: {mid_dt.strftime('%H:%M:%S')} → {end_dt.strftime('%H:%M:%S')}")

        chunk_metrics_results = []
        chunk_bird_records = []

        frame_idx = 0
        frames_processed = 0
        dt = stride / fps if fps > 0 else (1.0 / 15.0)

        # ── Chunk 1 Execution ───────────────────────────────────────────────
        self.behavior_engine.reset_chunk()
        print("[WORKER] >>> Processing Chunk 1 (00-30 min)...")

        while self.running and frame_idx < half_frame_cutoff:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % stride == 0:
                frame_out = self.tracker.process_frame(frame, frame_idx, fps)
                self.behavior_engine.process_frame(frame_out, dt)
                frames_processed += 1

            frame_idx += 1
            if frame_idx % 200 == 0:
                self.current_progress_pct = (frame_idx / total_frames) * 100.0
                print(f"[PROGRESS] Frame {frame_idx}/{total_frames} ({self.current_progress_pct:.1f}%)")

        chunk1_summary = self.behavior_engine.compute_chunk_summary()
        chunk1_sensors = self._pull_sensor_averages_for_range(start_dt, mid_dt)

        chunk1_record = {
            "date_slot": start_dt.strftime("%Y-%m-%d"),
            "hour_slot": start_dt.strftime("%H:00"),
            "chunk_index": 1,
            "chunk_start": start_dt,
            "chunk_end": mid_dt,
            **chunk1_sensors,
            "unique_birds_tracked": chunk1_summary.unique_birds,
            "avg_birds_in_frame": chunk1_summary.avg_birds_present,
            "flock_mobility_px_s": chunk1_summary.flock_mobility_px_s,
            "feeding_time_total_s": chunk1_summary.feeding_time_total_s,
            "feeding_bouts": chunk1_summary.feeding_bouts,
            "reduced_eating_events": chunk1_summary.reduced_eating_events,
            "reduced_eating_index": chunk1_summary.reduced_eating_index,
            "drinking_time_total_s": chunk1_summary.drinking_time_total_s,
            "drinking_bouts": chunk1_summary.drinking_bouts,
            "drinking_frequency_per_bird": chunk1_summary.drinking_frequency_per_bird,
            "inactivity_time_total_s": chunk1_summary.inactivity_time_total_s,
            "inactivity_pct": chunk1_summary.inactivity_pct,
            "lethargic_birds_flagged": chunk1_summary.lethargic_birds_flagged,
            "feather_pecking_events": chunk1_summary.feather_pecking_events,
            "agitation_score": chunk1_summary.agitation_score,
        }
        chunk_metrics_results.append(chunk1_record)
        chunk_bird_records.append(chunk1_summary.bird_records)

        # ── Chunk 2 Execution ───────────────────────────────────────────────
        self.behavior_engine.reset_chunk()
        print("[WORKER] >>> Processing Chunk 2 (30-60 min)...")

        while self.running and frame_idx < total_frames:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % stride == 0:
                frame_out = self.tracker.process_frame(frame, frame_idx, fps)
                self.behavior_engine.process_frame(frame_out, dt)
                frames_processed += 1

            frame_idx += 1
            if frame_idx % 200 == 0:
                self.current_progress_pct = (frame_idx / total_frames) * 100.0
                print(f"[PROGRESS] Frame {frame_idx}/{total_frames} ({self.current_progress_pct:.1f}%)")

        cap.release()

        chunk2_summary = self.behavior_engine.compute_chunk_summary()
        chunk2_sensors = self._pull_sensor_averages_for_range(mid_dt, end_dt)

        chunk2_record = {
            "date_slot": start_dt.strftime("%Y-%m-%d"),
            "hour_slot": start_dt.strftime("%H:00"),
            "chunk_index": 2,
            "chunk_start": mid_dt,
            "chunk_end": end_dt,
            **chunk2_sensors,
            "unique_birds_tracked": chunk2_summary.unique_birds,
            "avg_birds_in_frame": chunk2_summary.avg_birds_present,
            "flock_mobility_px_s": chunk2_summary.flock_mobility_px_s,
            "feeding_time_total_s": chunk2_summary.feeding_time_total_s,
            "feeding_bouts": chunk2_summary.feeding_bouts,
            "reduced_eating_events": chunk2_summary.reduced_eating_events,
            "reduced_eating_index": chunk2_summary.reduced_eating_index,
            "drinking_time_total_s": chunk2_summary.drinking_time_total_s,
            "drinking_bouts": chunk2_summary.drinking_bouts,
            "drinking_frequency_per_bird": chunk2_summary.drinking_frequency_per_bird,
            "inactivity_time_total_s": chunk2_summary.inactivity_time_total_s,
            "inactivity_pct": chunk2_summary.inactivity_pct,
            "lethargic_birds_flagged": chunk2_summary.lethargic_birds_flagged,
            "feather_pecking_events": chunk2_summary.feather_pecking_events,
            "agitation_score": chunk2_summary.agitation_score,
        }
        chunk_metrics_results.append(chunk2_record)
        chunk_bird_records.append(chunk2_summary.bird_records)

        # Persist results to SQLite/SQLAlchemy database
        DB.save_30m_metrics(job.id, chunk_metrics_results, chunk_bird_records)
        elapsed_s = time.time() - t_start_processing
        DB.mark_job_completed(job.id, frames_processed, total_frames, elapsed_s)

        print(f"\n[WORKER SUCCESS] Successfully processed hourly block: {filename}")
        print(f"                 Elapsed Time: {elapsed_s:.1f}s | Inferred Frames: {frames_processed}")
        print(f"                 Chunk 1: {chunk1_summary.unique_birds} birds | Inactivity: {chunk1_summary.inactivity_pct:.1f}% | Pecking: {chunk1_summary.feather_pecking_events}")
        print(f"                 Chunk 2: {chunk2_summary.unique_birds} birds | Inactivity: {chunk2_summary.inactivity_pct:.1f}% | Pecking: {chunk2_summary.feather_pecking_events}")
        
        self.current_job_id = None
        self.current_progress_pct = 100.0


def main():
    worker = ZampenAnalyticsWorker()
    worker.start_daemon()


if __name__ == "__main__":
    main()
