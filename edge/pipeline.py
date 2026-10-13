"""
edge/pipeline.py - Production Master Edge AI Pipeline for Dell OptiPlex.
Combines camera stream ingestion, YOLO26n Re-ID inference, behavior analysis,
sensor synchronization, 6 AM - 6 PM hourly aggregation, and edge watchdog recovery.
"""

import os
import cv2
import time
import signal
import psutil
import datetime
import argparse
from typing import Optional

from .config import CONFIG, EdgeConfig
from .detector import PoultryInferenceEngine, FrameInferenceResult
from .behavior import BehaviorAnalyzer, FrameBehaviorSummary
from .sensors import SensorHub, SensorReading
from .aggregator import HourlyTelemetryAggregator, HourlyAggregationRecord


class EdgePipelineManager:
    """
    Production-grade edge vision and telemetry pipeline.
    Runs continuously on Dell OptiPlex edge hub.
    """

    def __init__(self, config: Optional[EdgeConfig] = None, view_display: bool = False):
        self.cfg = config or CONFIG
        self.view_display = view_display
        self._running = False
        
        print("\n" + "=" * 65)
        print("    🐔 ChickenSee Edge AI Monitoring Pipeline — OptiPlex Hub")
        print("=" * 65)

        # 1. Initialize Components
        self.detector = PoultryInferenceEngine(self.cfg.vision)
        self.behavior_analyzer = BehaviorAnalyzer(self.cfg.behavior)
        self.sensor_hub = SensorHub(self.cfg.sensor)
        self.aggregator = HourlyTelemetryAggregator(self.cfg.schedule)

        # 2. State & Watchdog
        self.cap: Optional[cv2.VideoCapture] = None
        self.frame_idx = 0
        self.consecutive_read_failures = 0
        self.reconnect_delay = self.cfg.vision.reconnect_delay_s

        # 3. Setup signal handlers for graceful systemd/service termination
        signal.signal(signal.SIGINT, self._handle_exit_signal)
        signal.signal(signal.SIGTERM, self._handle_exit_signal)

    def _handle_exit_signal(self, signum, frame):
        print(f"\n[PIPELINE] Received termination signal ({signum}). Initiating graceful shutdown...")
        self._running = False

    def _open_video_stream(self) -> bool:
        """Opens video capture stream (RTSP, USB camera, or file) with resilience."""
        source = self.cfg.vision.video_source
        if self.cap is not None:
            self.cap.release()

        # Handle numeric string as integer webcam index
        if str(source).isdigit():
            source = int(source)

        print(f"[STREAM] Initializing video source: {source}")
        self.cap = cv2.VideoCapture(source)

        if not self.cap.isOpened():
            print(f"[STREAM] [WARNING] Could not open video source '{source}'")
            return False

        # Attempt buffer size optimization for low-latency RTSP feeds
        try:
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass

        print(f"[STREAM] Video source connected successfully.")
        return True

    def _ensure_active_stream(self) -> bool:
        """Watchdog to ensure stream is open, auto-reconnecting on failures."""
        if self.cap is None or not self.cap.isOpened():
            print(f"[WATCHDOG] Reconnecting stream in {self.reconnect_delay:.1f}s...")
            time.sleep(self.reconnect_delay)
            self.reconnect_delay = min(
                self.reconnect_delay * 1.5, 
                self.cfg.vision.max_reconnect_delay_s
            )
            success = self._open_video_stream()
            if success:
                self.reconnect_delay = self.cfg.vision.reconnect_delay_s
            return success
        return True

    def _overlay_telemetry_ui(
        self, 
        frame: cv2.Mat, 
        inf_res: FrameInferenceResult, 
        beh_sum: FrameBehaviorSummary, 
        sensor: Optional[SensorReading]
    ):
        """Draws rich edge telemetry overlay on video frames for live viewing."""
        h, w = frame.shape[:2]

        # 1. Draw Detections & Behavior Badges
        for d in inf_res.detections:
            x1, y1, x2, y2 = d.box
            color = d.color_bgr
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

            # Behavior badge if chicken
            beh_text = ""
            if d.track_id is not None and d.track_id in beh_sum.per_bird_behaviors:
                beh_text = f" [{beh_sum.per_bird_behaviors[d.track_id]}]"

            label_text = f"#{d.track_id} {d.label}{beh_text} ({d.confidence:.2f})" if d.track_id else f"{d.label} ({d.confidence:.2f})"
            (tw, th), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(frame, (x1, max(0, y1 - 22)), (x1 + tw + 6, max(22, y1)), color, -1)
            cv2.putText(frame, label_text, (x1 + 3, max(16, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0) if sum(color) > 400 else (255, 255, 255), 1)

        # 2. Draw Top Telemetry Dashboard Bar
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (w, 50), (20, 24, 30), -1)
        cv2.addWeighted(overlay, 0.85, frame, 0.15, 0, frame)

        # Top Bar Text
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        hud_left = f"TIME: {now_str} | BIRDS: {inf_res.total_birds} | ROOSTER: {inf_res.roosters} | HENS: {inf_res.hens_identified} | FPS: {inf_res.fps:.1f}"
        cv2.putText(frame, hud_left, (15, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 1)

        if sensor:
            stress_color = (0, 255, 0) if sensor.heat_stress_level == "Comfort" else ((0, 165, 255) if sensor.heat_stress_level == "Mild Alert" else (0, 0, 255))
            hud_sensor = f"TEMP: {sensor.temperature_c:.1f}C | RH: {sensor.humidity_pct:.0f}% | NH3: {sensor.ammonia_ppm:.1f}ppm | THI: {sensor.thi:.1f} [{sensor.heat_stress_level}]"
            cv2.putText(frame, hud_sensor, (15, 42), cv2.FONT_HERSHEY_SIMPLEX, 0.48, stress_color, 1)

    def run(self, max_frames: Optional[int] = None):
        """
        Main execution loop.
        Monitors 6 AM - 6 PM operating hours, processes frames, and flushes hourly logs.
        """
        self._running = True
        self._open_video_stream()

        print("[PIPELINE] Edge AI Processing Pipeline active.")
        print(f"[PIPELINE] Operating schedule: {self.cfg.schedule.start_hour:02d}:00:00 - {self.cfg.schedule.end_hour:02d}:00:00 local time.")
        
        last_health_check = time.time()

        try:
            while self._running:
                now_dt = datetime.datetime.now()
                t_now = time.time()

                # -------------------------------------------------------------
                # 1. Enforce 6 AM - 6 PM Daily Operational Window
                # -------------------------------------------------------------
                if not self.aggregator.is_operational_hours(now_dt):
                    # Outside operational hours (18:00 - 06:00)
                    if self.cap is not None and self.cap.isOpened():
                        # Flush any remaining daytime metrics
                        self.aggregator.flush_hourly_summary(
                            all_bird_states=self.behavior_analyzer.get_all_bird_profiles()
                        )
                        print(f"[SCHEDULE] 18:00 PM reached. Closing camera stream & entering low-power standby mode.")
                        self.cap.release()
                        self.cap = None

                    # Sleep cleanly to avoid consuming CPU cycles on OptiPlex
                    print(f"[SCHEDULE] Standby mode active ({now_dt.strftime('%H:%M:%S')}). Waking in 30s to check schedule...")
                    time.sleep(30.0)
                    continue

                # -------------------------------------------------------------
                # 2. Watchdog Stream Ingestion
                # -------------------------------------------------------------
                if not self._ensure_active_stream():
                    continue

                ret, frame = self.cap.read()
                if not ret or frame is None:
                    self.consecutive_read_failures += 1
                    if self.consecutive_read_failures > 5:
                        print(f"[WATCHDOG] Frame read dropped ({self.consecutive_read_failures} fails). Reconnecting...")
                        self.cap.release()
                        self.cap = None
                        self.consecutive_read_failures = 0
                    time.sleep(0.1)
                    continue

                self.consecutive_read_failures = 0
                self.frame_idx += 1

                # -------------------------------------------------------------
                # 3. Sensor-Vision Temporal Synchronization
                # -------------------------------------------------------------
                sensor_reading = self.sensor_hub.get_synchronized_reading(frame_timestamp=t_now)

                # -------------------------------------------------------------
                # 4. Inference & Poultry Re-ID
                # -------------------------------------------------------------
                inf_result = self.detector.process_frame(frame, timestamp=t_now)

                # -------------------------------------------------------------
                # 5. Behavior Tracking & Spatial Analysis
                # -------------------------------------------------------------
                beh_summary = self.behavior_analyzer.analyze_frame(inf_result, current_time=t_now)

                # -------------------------------------------------------------
                # 6. Hourly Aggregation & Database Flush
                # -------------------------------------------------------------
                all_birds = self.behavior_analyzer.get_all_bird_profiles()
                self.aggregator.ingest_frame(
                    inference_result=inf_result,
                    behavior_summary=beh_summary,
                    sensor_reading=sensor_reading,
                    all_bird_states=all_birds
                )

                # -------------------------------------------------------------
                # 7. Memory Leak Prevention & System Telemetry
                # -------------------------------------------------------------
                if self.frame_idx % self.cfg.memory_cleanup_interval_frames == 0:
                    import gc
                    gc.collect()

                if t_now - last_health_check >= self.cfg.health_check_interval_s:
                    last_health_check = t_now
                    cpu_p = psutil.cpu_percent()
                    ram_mb = psutil.Process().memory_info().rss / 1024 / 1024
                    print(f"[HEALTH] Frame {self.frame_idx} | FPS: {inf_result.fps:.1f} | CPU: {cpu_p}% | RAM: {ram_mb:.1f}MB | Birds: {inf_result.total_birds}")

                # -------------------------------------------------------------
                # 8. Optional Visualization UI
                # -------------------------------------------------------------
                if self.view_display:
                    self._overlay_telemetry_ui(frame, inf_result, beh_summary, sensor_reading)
                    cv2.imshow("ChickenSee Edge Hub", frame)
                    key = cv2.waitKey(1) & 0xFF
                    if key in (27, ord('q')):
                        print("[PIPELINE] Exit requested by user via UI.")
                        break

                # Frame limit for unit testing / batch evaluation
                if max_frames and self.frame_idx >= max_frames:
                    print(f"[PIPELINE] Reached target limit of {max_frames} frames.")
                    break

        finally:
            self._shutdown()

    def _shutdown(self):
        """Final cleanup and persistence on pipeline termination."""
        print("\n[PIPELINE] Stopping Edge Pipeline...")
        if self.cap is not None:
            self.cap.release()
        if self.view_display:
            cv2.destroyAllWindows()

        self.sensor_hub.stop()

        # Flush any unflushed hourly records to SQLite/CSV/JSON
        print("[PIPELINE] Committing final session telemetry...")
        self.aggregator.flush_hourly_summary(
            all_bird_states=self.behavior_analyzer.get_all_bird_profiles()
        )
        print("[PIPELINE] Edge AI Pipeline gracefully shut down.")


def main():
    parser = argparse.ArgumentParser(description="ChickenSee Edge AI Pipeline - Dell OptiPlex Hub")
    parser.add_argument("--source", type=str, default=None, help="Video stream URL, device index, or file path")
    parser.add_argument("--view", action="store_true", help="Display live OpenCV overlay window")
    parser.add_argument("--frames", type=int, default=None, help="Stop after N frames (useful for verification/benchmarking)")
    parser.add_argument("--force-start", action="store_true", help="Bypass 6 AM - 6 PM check for off-hours testing")
    args = parser.parse_args()

    if args.source:
        CONFIG.vision.video_source = args.source

    if args.force_start:
        # Extend operational window for immediate testing regardless of local clock
        CONFIG.schedule.start_hour = 0
        CONFIG.schedule.end_hour = 24

    pipeline = EdgePipelineManager(view_display=args.view)
    pipeline.run(max_frames=args.frames)


if __name__ == "__main__":
    main()
