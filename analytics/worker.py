"""
analytics/worker.py
Core Worker Daemon for ZAMPEN Layer Chicken Video & Sensor Analytics.
Manages watched-folder polling, OpenCV video decoding, YOLO26 Nano + ByteTrack inference,
interval sensor aggregation, and behavior metric persistence.
"""

import os
import json
import hashlib
import re
import sys
import time
import sqlite3
import datetime
import traceback
import threading
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
import cv2

from .config import CONFIG
from .database import DB, JobStatus
from .tracker import ZampenYOLOTracker
from .behavior_engine import BehaviorAnalysisEngine, BehaviorChunkSummary

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from local_store import VIDEOS_DIR, write_results_json


class AnalysisCancelled(Exception):
    """Raised when the user cancels the active video analysis."""


class ZampenAnalyticsWorker:
    """
    Automated background worker running on the Dell OptiPlex server.
    Monitors the agent's configured video directories, pairs sensor data,
    produces configurable time-chunked behavior and environmental intelligence,
    and saves annotated detection videos and reports locally.
    """

    def __init__(self):
        self.cfg = CONFIG
        self.tracker = ZampenYOLOTracker()
        self.behavior_engine = BehaviorAnalysisEngine()
        self.running = True
        self.current_job_id: Optional[int] = None
        self.current_progress_pct: float = 0.0
        self._fs_event = threading.Event()
        self._fs_stop_event = threading.Event()
        self._watcher_thread: Optional[threading.Thread] = None
        
        VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
        self._start_filesystem_watcher()

    def _start_filesystem_watcher(self):
        """Starts real-time filesystem watcher for all watched video directories."""
        def _watch_target_dirs():
            try:
                from watchfiles import watch
                while not self._fs_stop_event.is_set():
                    dirs = [str(d) for d in self._video_input_dirs() if d.is_dir()]
                    if not dirs:
                        time.sleep(1)
                        continue
                    try:
                        for changes in watch(*dirs, recursive=True, stop_event=self._fs_stop_event, rust_timeout=500):
                            has_video = any(
                                path.lower().endswith(".mp4") and "_detected" not in path.lower()
                                for _, path in changes
                            )
                            if has_video:
                                self._fs_event.set()
                    except Exception:
                        time.sleep(1)
            except Exception:
                pass

        self._watcher_thread = threading.Thread(target=_watch_target_dirs, daemon=True)
        self._watcher_thread.start()

    def trigger_scan(self):
        """Wakes the worker loop immediately to check for newly arrived videos."""
        self._fs_event.set()

    def start_daemon(self):
        """Main polling loop running continuously as an OptiPlex background service."""
        print("═══════════════════════════════════════════════════════════════")
        print("  ZAMPEN Layer Chicken Analytics Pipeline - OptiPlex Daemon")
        print("  Model: YOLO26 Nano (yolo26n.pt) + ByteTrack")
        print(f"  Input Video Dirs: {', '.join(str(p) for p in self._video_input_dirs())}")
        print(f"  Local Results   : {VIDEOS_DIR.parent}")
        print(f"  Detected Videos : {VIDEOS_DIR}")
        print(f"  Sensor DB       : {self.cfg.sensor_db_url}")
        print(f"  Analytics DB    : {self.cfg.analytics_db_url}")
        print(f"  File stability  : {self.cfg.stability_threshold_s}s (Real-Time) | Analysis chunks: {self.cfg.chunk_minutes}m")
        print("═══════════════════════════════════════════════════════════════")

        while self.running:
            try:
                candidate = self._find_next_completed_hourly_video()
                if candidate:
                    filepath, filename, start_dt, end_dt = candidate
                    print(f"\n[DAEMON] Discovered stable video for processing: {filename}")
                    print(f"        Window: {start_dt.strftime('%Y-%m-%d %H:%M')} → {end_dt.strftime('%H:%M')}")
                    self._process_hourly_segment(filepath, filename, start_dt, end_dt)
                else:
                    self._fs_event.wait(timeout=self.cfg.poll_interval_s)
                    self._fs_event.clear()
            except KeyboardInterrupt:
                print("\n[DAEMON] Shutdown requested by user.")
                self.running = False
                self._fs_stop_event.set()
                self._fs_event.set()
                break
            except Exception as e:
                print(f"[DAEMON ERROR] Unexpected loop exception: {e}")
                traceback.print_exc()
                time.sleep(2)

    def _video_input_dirs(self, directories_file: Optional[Path] = None) -> List[Path]:
        config_file = directories_file or (
            Path(__file__).resolve().parent.parent / "agent" / "directories.json"
        )
        if not config_file.is_file():
            return [Path(self.cfg.video_dir).expanduser().resolve()]
        try:
            config = json.loads(config_file.read_text(encoding="utf-8"))
            if not isinstance(config, dict):
                raise ValueError("directory configuration must be an object")
            configured = config.get("directories", [])
            if not isinstance(configured, list) or not all(isinstance(path, str) for path in configured):
                raise ValueError("directories must be a list of paths")
            directories = {Path(path).expanduser().resolve() for path in configured}
        except (OSError, json.JSONDecodeError, ValueError) as error:
            print(f"[WORKER WARN] Could not read configured watch directories: {error}")
            return [Path(self.cfg.video_dir).expanduser().resolve()]
        return sorted(directories, key=str)

    @staticmethod
    def _chunk_frame_ranges(total_frames: int, fps: float, chunk_minutes: int) -> List[Tuple[int, int]]:
        chunk_frames = max(1, round(max(fps, 0.001) * max(1, chunk_minutes) * 60))
        return [
            (first_frame, min(first_frame + chunk_frames, total_frames))
            for first_frame in range(0, max(0, total_frames), chunk_frames)
        ]

    def _find_next_completed_hourly_video(self) -> Optional[Tuple[str, str, datetime.datetime, datetime.datetime]]:
        """Finds the oldest stable MP4 from the configured agent folders."""
        mp4_files = []
        for video_dir in self._video_input_dirs():
            if video_dir.is_dir():
                mp4_files.extend(video_dir.rglob("*.mp4"))

        mp4_files.sort(key=lambda path: path.stat().st_mtime)

        for p in mp4_files:
            filename = p.name
            stem = p.stem.lower()
            # Skip videos we already wrote as annotated output
            if stem.endswith("_detected") or "_detected" in stem:
                continue

            # Skip if already processed in DB
            filepath = str(p.resolve())
            if DB.is_file_processed(
                filepath,
                filepath=filepath,
                signature=DB.file_signature(filepath),
            ):
                continue

            # Ensure file is stable and not actively being written
            file_mtime = p.stat().st_mtime
            age_s = time.time() - file_mtime
            if age_s < self.cfg.stability_threshold_s:
                continue

            # Verify file can be read and is not locked by a camera or writer process
            try:
                with open(p, "rb") as f:
                    f.seek(0, os.SEEK_END)
                    if f.tell() == 0:
                        continue
            except (OSError, PermissionError):
                continue

            # Parse start and end timestamps from filename or modification time
            start_dt, end_dt = self._extract_timestamps_from_file(p)

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
        return mtime, mtime

    def _pull_sensor_averages_for_range(
        self, 
        chunk_start: datetime.datetime, 
        chunk_end: datetime.datetime
    ) -> Dict[str, Any]:
        """
        Queries raw sensor records from the SQLite database for the analysis interval
        and computes arithmetic averages, extrema, THI, and heat stress alerts.
        """
        sensor_db = Path(self.cfg.sensor_db_url.replace("sqlite:///", ""))
        defaults = {
            "temp_avg_c": None,
            "temp_min_c": None,
            "temp_max_c": None,
            "humidity_avg_pct": None,
            "humidity_min_pct": None,
            "humidity_max_pct": None,
            "ammonia_ppm_avg": None,
            "ammonia_ppm_max": None,
            "lux_avg": None,
            "thi_avg": None,
            "heat_stress_level": "Unavailable",
            "sensor_data_available": False,
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
                    WHERE datetime(timestamp) >= datetime(?) AND datetime(timestamp) <= datetime(?)
                """, (start_iso, end_iso))
                row = cursor.fetchone()

                if row and any(row[key] is not None for key in (
                    "t_avg", "h_avg", "nh3_avg", "lux_avg", "thi_avg"
                )):
                    thi = float(row["thi_avg"]) if row["thi_avg"] is not None else None
                    if thi is None:
                        heat_level = "Unavailable"
                    elif thi >= 84.0:
                        heat_level = "Emergency"
                    elif thi >= 79.0:
                        heat_level = "Severe"
                    elif thi >= 74.0:
                        heat_level = "Moderate"
                    else:
                        heat_level = "Normal"

                    return {
                        "temp_avg_c": round(float(row["t_avg"]), 2) if row["t_avg"] is not None else None,
                        "temp_min_c": round(float(row["t_min"]), 2) if row["t_min"] is not None else None,
                        "temp_max_c": round(float(row["t_max"]), 2) if row["t_max"] is not None else None,
                        "humidity_avg_pct": round(float(row["h_avg"]), 1) if row["h_avg"] is not None else None,
                        "humidity_min_pct": round(float(row["h_min"]), 1) if row["h_min"] is not None else None,
                        "humidity_max_pct": round(float(row["h_max"]), 1) if row["h_max"] is not None else None,
                        "ammonia_ppm_avg": round(float(row["nh3_avg"]), 2) if row["nh3_avg"] is not None else None,
                        "ammonia_ppm_max": round(float(row["nh3_max"]), 2) if row["nh3_max"] is not None else None,
                        "lux_avg": round(float(row["lux_avg"]), 1) if row["lux_avg"] is not None else None,
                        "thi_avg": round(thi, 2) if thi is not None else None,
                        "heat_stress_level": heat_level,
                        "sensor_data_available": True,
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
        Executes frame-by-frame YOLO26 Nano + ByteTrack inference, splits the video
        into configured intervals, pairs sensor data, commits to analytics database,
        and saves the annotated detection video plus JSON results locally.
        """
        file_signature = DB.file_signature(video_path)
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            err = f"Failed to open video file via OpenCV: {video_path}"
            print(f"[WORKER ERROR] {err}")
            job = DB.lease_job(
                filename, video_path, start_dt, end_dt, signature=file_signature
            )
            if job:
                DB.mark_job_failed(job.id, err)
            cap.release()
            return

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
        fps = cap.get(cv2.CAP_PROP_FPS) or 20.0
        if total_frames > 1 and fps > 0:
            duration_s = total_frames / fps
            if start_dt == end_dt:
                start_dt = datetime.datetime.fromtimestamp(Path(video_path).stat().st_mtime) - datetime.timedelta(seconds=duration_s)
            end_dt = start_dt + datetime.timedelta(seconds=duration_s)

        job = DB.lease_job(
            filename, video_path, start_dt, end_dt, signature=file_signature
        )
        if not job:
            print(f"[WORKER] Skipping {filename} (already completed or active).")
            cap.release()
            return

        self.current_job_id = job.id
        self.current_progress_pct = 0.0
        DB.update_job_progress(job.id, 0, total_frames)
        self._update_persisted_queue_status(job.id, filename, 0.0, 0, total_frames, "PROCESSING")
        t_start_processing = time.time()
        src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
        src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 360
        stride = max(1, self.cfg.frame_stride)
        writer, detected_path, staging_path = self._open_detected_writer(
            filename, src_w, src_h, fps, stride
        )
        if writer is None or detected_path is None or staging_path is None:
            cap.release()
            error = f"Could not create annotated detection video for {filename}"
            DB.mark_job_failed(job.id, error)
            self._update_persisted_queue_status(job.id, filename, None, 0, total_frames, "FAILED")
            self.current_job_id = None
            raise RuntimeError(error)

        try:
            frames_processed, elapsed_s = self._run_chunked_inference(
                cap=cap,
                writer=writer,
                detected_path=detected_path,
                video_path=video_path,
                filename=filename,
                start_dt=start_dt,
                end_dt=end_dt,
                job=job,
                t_start_processing=t_start_processing,
                total_frames=total_frames,
                fps=fps,
                stride=stride,
            )
            self._raise_if_cancelled(job.id)
            writer.release()
            writer = None
            os.replace(staging_path, detected_path)
            DB.mark_job_completed(job.id, frames_processed, total_frames, elapsed_s)
            self._update_persisted_queue_status(job.id, filename, 100.0, total_frames, total_frames, "COMPLETED")
        except AnalysisCancelled:
            DB.cancel_processing_job(job.id)
            self._update_persisted_queue_status(job.id, filename, None, 0, total_frames, "CANCELLED")
            print(f"[WORKER] Analysis cancelled by user: {filename}")
        except Exception as error:
            DB.mark_job_failed(job.id, str(error))
            self._update_persisted_queue_status(job.id, filename, None, 0, total_frames, "FAILED")
            raise
        finally:
            if cap is not None:
                cap.release()
            if writer is not None:
                writer.release()
            if staging_path and os.path.isfile(staging_path):
                try:
                    os.remove(staging_path)
                except OSError as error:
                    print(f"[WORKER WARN] Could not remove incomplete detection video: {error}")
            if os.path.isfile(detected_path):
                sz_mb = os.path.getsize(detected_path) / 1024 / 1024
                print(f"[LOCAL STORE] Saved annotated detection video: {detected_path} ({sz_mb:.2f} MB)")
            self.current_job_id = None

        self.current_progress_pct = 100.0

    @staticmethod
    def _raise_if_cancelled(job_id: int) -> None:
        if DB.is_job_cancelled(job_id):
            raise AnalysisCancelled("Video analysis was cancelled by the user.")

    def _update_persisted_queue_status(
        self,
        job_id: Optional[int],
        filename: Optional[str],
        pct: Optional[float],
        frame_idx: int,
        total_frames: int,
        status_str: str,
    ) -> None:
        try:
            from local_store import write_queue_status_json
            is_proc = status_str == "PROCESSING"
            write_queue_status_json({
                "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
                "is_queueing": is_proc,
                "active_video": filename if is_proc else None,
                "active_progress": round(pct, 1) if (is_proc and pct is not None) else None,
                "active_frames": f"{frame_idx} / {total_frames}" if is_proc else None,
            })
        except Exception:
            pass

    def _run_chunked_inference(
        self,
        cap,
        writer,
        detected_path,
        video_path,
        filename,
        start_dt,
        end_dt,
        job,
        t_start_processing,
        total_frames,
        fps,
        stride,
    ):
        fps = fps if fps > 0 else 20.0
        frame_ranges = self._chunk_frame_ranges(total_frames, fps, self.cfg.chunk_minutes)
        chunk_metrics_results = []
        chunk_bird_records = []
        chunk_summaries = []
        frame_idx = 0
        frames_processed = 0
        dt = stride / fps
        video_ended = False

        print(f"[WORKER] Video: {filename} | Total Frames: {total_frames} @ {fps:.1f} FPS")

        for chunk_index, (first_frame, last_frame) in enumerate(frame_ranges, start=1):
            chunk_start = start_dt + datetime.timedelta(seconds=first_frame / fps)
            chunk_end = min(end_dt, start_dt + datetime.timedelta(seconds=last_frame / fps))
            self.behavior_engine.reset_chunk()
            print(
                f"[WORKER] >>> Processing interval {chunk_index}: "
                f"{chunk_start.strftime('%Y-%m-%d %H:%M:%S')} – {chunk_end.strftime('%H:%M:%S')}"
            )

            while self.running and frame_idx < last_frame:
                if frame_idx % 25 == 0:
                    self._raise_if_cancelled(job.id)
                ret, frame = cap.read()
                if not ret:
                    video_ended = True
                    break

                if frame_idx % stride == 0:
                    frame_out = self.tracker.process_frame(frame, frame_idx, fps)
                    self.behavior_engine.process_frame(frame_out, dt)
                    frames_processed += 1
                    if writer is not None:
                        writer.write(self.tracker.annotate_frame(frame, frame_out))

                frame_idx += 1
                if frames_processed % 25 == 0:
                    self.current_progress_pct = (frame_idx / total_frames) * 100.0
                    DB.update_job_progress(job.id, frame_idx, total_frames)
                    if frames_processed % 100 == 0:
                        self._update_persisted_queue_status(
                            job.id, filename, self.current_progress_pct, frame_idx, total_frames, "PROCESSING"
                        )
                if frame_idx % 200 == 0:
                    print(f"[PROGRESS] Frame {frame_idx}/{total_frames} ({self.current_progress_pct:.1f}%)")

            if not self.running:
                raise RuntimeError("Video analysis was stopped before completion")
            self._raise_if_cancelled(job.id)
            DB.update_job_progress(job.id, frame_idx, total_frames)

            actual_chunk_end = start_dt + datetime.timedelta(seconds=frame_idx / fps) if video_ended else chunk_end
            summary = self.behavior_engine.compute_chunk_summary()
            sensors = self._pull_sensor_averages_for_range(chunk_start, actual_chunk_end)
            chunk_record = {
                "date_slot": chunk_start.strftime("%Y-%m-%d"),
                "hour_slot": chunk_start.strftime("%H:00"),
                "chunk_index": chunk_index,
                "chunk_start": chunk_start,
                "chunk_end": actual_chunk_end,
                **sensors,
                "unique_birds_tracked": summary.unique_birds,
                "avg_birds_in_frame": summary.avg_birds_present,
                "flock_mobility_px_s": summary.flock_mobility_px_s,
                "feeding_time_total_s": summary.feeding_time_total_s,
                "feeding_bouts": summary.feeding_bouts,
                "reduced_eating_events": summary.reduced_eating_events,
                "reduced_eating_index": summary.reduced_eating_index,
                "drinking_time_total_s": summary.drinking_time_total_s,
                "drinking_bouts": summary.drinking_bouts,
                "drinking_frequency_per_bird": summary.drinking_frequency_per_bird,
                "inactivity_time_total_s": summary.inactivity_time_total_s,
                "inactivity_pct": summary.inactivity_pct,
                "lethargic_birds_flagged": summary.lethargic_birds_flagged,
                "feather_pecking_events": summary.feather_pecking_events,
                "agitation_score": summary.agitation_score,
            }
            chunk_metrics_results.append(chunk_record)
            chunk_bird_records.append(summary.bird_records)
            chunk_summaries.append(summary)

            if video_ended:
                end_dt = actual_chunk_end
                break

        if not chunk_metrics_results:
            raise RuntimeError(f"No frames could be analyzed in {filename}")

        # ── Save analysis report for the annotated output video ───────────────
        stem = Path(filename).stem
        path_suffix = hashlib.sha256(str(Path(video_path).resolve()).encode("utf-8")).hexdigest()[:10]
        results_path = write_results_json(f"{stem}_{path_suffix}", {
            "job_id": job.id,
            "source_video": filename,
            "source_path": video_path,
            "detected_video": str(detected_path) if detected_path else None,
            "processed_at": datetime.datetime.now().isoformat(),
            "window": {
                "start": start_dt.isoformat(),
                "end": end_dt.isoformat(),
            },
            "chunks": chunk_metrics_results,
            "bird_records": chunk_bird_records,
        })
        print(f"[LOCAL STORE] Saved detection results JSON: {results_path}")

        # Persist results to SQLite/SQLAlchemy database
        DB.save_30m_metrics(job.id, chunk_metrics_results, chunk_bird_records)
        elapsed_s = time.time() - t_start_processing

        print(f"\n[WORKER SUCCESS] Successfully processed hourly block: {filename}")
        print(f"                Elapsed Time: {elapsed_s:.1f}s | Inferred Frames: {frames_processed}")
        print(f"                Analysis intervals: {len(chunk_summaries)}")
        for index, summary in enumerate(chunk_summaries, start=1):
            print(
                f"                Interval {index}: {summary.unique_birds} birds | "
                f"Inactivity: {summary.inactivity_pct:.1f}% | "
                f"Pecking: {summary.feather_pecking_events}"
            )
        return frames_processed, elapsed_s

    def _open_detected_writer(
        self,
        filename: str,
        width: int,
        height: int,
        fps: float,
        stride: int,
    ) -> Tuple[Optional[cv2.VideoWriter], Optional[str], Optional[str]]:
        """Writes to a staging file so sync only sees a completed annotated video."""
        VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
        stem = Path(filename).stem
        out_path = str(VIDEOS_DIR / f"{stem}_detected.mp4")
        staging_path = str(VIDEOS_DIR / f"{stem}_detected.processing.mp4")
        if os.path.isfile(staging_path):
            os.remove(staging_path)
        write_fps = max(5.0, (fps or 20.0) / max(1, stride))
        size = (max(2, width), max(2, height))
        for codec in ("mp4v", "XVID", "avc1"):
            writer = cv2.VideoWriter(
                staging_path, cv2.VideoWriter_fourcc(*codec), write_fps, size
            )
            if writer.isOpened():
                print(f"[RECORDER] Writing annotated video: {staging_path} ({size[0]}x{size[1]} @ {write_fps:.1f}fps, {codec})")
                return writer, out_path, staging_path
            writer.release()
            if os.path.isfile(staging_path):
                os.remove(staging_path)
        print("[RECORDER WARN] Could not open VideoWriter for annotated output.")
        return None, None, None


def main():
    worker = ZampenAnalyticsWorker()
    worker.start_daemon()


if __name__ == "__main__":
    main()