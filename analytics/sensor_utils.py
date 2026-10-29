"""
analytics/sensor_utils.py
Utilities to inspect, query, and format paired sensor SQLite databases
(supporting both `sensors.sqlite` and `chicken_telemetry.db` / `environmental_logs_raw` schemas).
"""

import os
import sqlite3
import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List


def calculate_thi(temp_c: Optional[float], humidity_pct: Optional[float]) -> Optional[float]:
    """Calculates Temperature-Humidity Index (THI) for poultry."""
    if temp_c is None or humidity_pct is None:
        return None
    try:
        t = float(temp_c)
        h = float(humidity_pct)
        return round(0.8 * t + (h / 100.0) * (t - 14.4) + 46.4, 2)
    except Exception:
        return None


def calculate_heat_stress(thi: Optional[float]) -> str:
    """Returns poultry heat stress alert level based on THI."""
    if thi is None:
        return "Unavailable"
    if thi >= 84.0:
        return "Emergency"
    if thi >= 79.0:
        return "Severe"
    if thi >= 74.0:
        return "Moderate"
    return "Normal"


def find_paired_sensor_db(video_path: str) -> Optional[Path]:
    """
    Finds a paired SQLite database next to the given video file.
    Prefers same-stem file (e.g. video1.sqlite for video1.mp4), or single SQLite file in the folder.
    """
    if not video_path:
        return None
    session_dir = Path(video_path).parent
    video_stem = Path(video_path).stem.casefold()
    try:
        candidates = sorted(
            p for p in session_dir.iterdir()
            if p.is_file() and p.suffix.casefold() in (".db", ".sqlite", ".sqlite3")
        )
    except OSError:
        return None
    paired = next((p for p in candidates if p.stem.casefold() == video_stem), None)
    if paired is None and len(candidates) == 1:
        paired = candidates[0]
    return paired


def read_sensor_db_status(
    db_path: Optional[Path],
    video_filename: Optional[str] = None,
    limit_recent: int = 25,
) -> Dict[str, Any]:
    """
    Inspects a sensor SQLite database and extracts latest readings,
    overall min/max/average statistics, and recent log rows.
    """
    empty_result = {
        "available": False,
        "database_name": db_path.name if db_path else None,
        "database_path": str(db_path) if db_path else None,
        "paired_video": video_filename,
        "total_records": 0,
        "current": None,
        "summary": None,
        "recent_readings": [],
        "status_message": "No paired sensor database found.",
    }

    if db_path is None or not Path(db_path).is_file():
        return empty_result

    resolved_path = Path(db_path).resolve()

    try:
        # Open in read-only URI mode to prevent any locking conflicts
        conn = sqlite3.connect(f"file:{resolved_path.as_posix()}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        tables = {
            r["name"] for r in cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table';"
            ).fetchall()
        }

        current_reading = None
        summary = None
        recent_readings: List[Dict[str, Any]] = []
        total_records = 0

        if "sensor_logs" in tables:
            total_records = cursor.execute("SELECT COUNT(*) as cnt FROM sensor_logs").fetchone()["cnt"]

            # Aggregate stats
            stats_row = cursor.execute("""
                SELECT
                    AVG(temperature) as t_avg, MIN(temperature) as t_min, MAX(temperature) as t_max,
                    AVG(humidity) as h_avg, MIN(humidity) as h_min, MAX(humidity) as h_max,
                    AVG(ammonia_ppm) as nh3_avg, MAX(ammonia_ppm) as nh3_max,
                    AVG(sound_db) as sound_avg, MAX(sound_db) as sound_max
                FROM sensor_logs
            """).fetchone()

            if stats_row:
                t_avg = round(float(stats_row["t_avg"]), 2) if stats_row["t_avg"] is not None else None
                h_avg = round(float(stats_row["h_avg"]), 1) if stats_row["h_avg"] is not None else None
                thi_avg = calculate_thi(t_avg, h_avg)
                summary = {
                    "temp_avg_c": t_avg,
                    "temp_min_c": round(float(stats_row["t_min"]), 2) if stats_row["t_min"] is not None else None,
                    "temp_max_c": round(float(stats_row["t_max"]), 2) if stats_row["t_max"] is not None else None,
                    "humidity_avg_pct": h_avg,
                    "humidity_min_pct": round(float(stats_row["h_min"]), 1) if stats_row["h_min"] is not None else None,
                    "humidity_max_pct": round(float(stats_row["h_max"]), 1) if stats_row["h_max"] is not None else None,
                    "ammonia_ppm_avg": round(float(stats_row["nh3_avg"]), 5) if stats_row["nh3_avg"] is not None else None,
                    "ammonia_ppm_max": round(float(stats_row["nh3_max"]), 5) if stats_row["nh3_max"] is not None else None,
                    "sound_db_avg": round(float(stats_row["sound_avg"]), 1) if stats_row["sound_avg"] is not None else None,
                    "sound_db_max": round(float(stats_row["sound_max"]), 1) if stats_row["sound_max"] is not None else None,
                    "thi_avg": thi_avg,
                    "heat_stress_level": calculate_heat_stress(thi_avg),
                }

            # Recent readings
            recent_rows = cursor.execute(f"""
                SELECT frame_index, elapsed_seconds, video_time, captured_at,
                       temperature, humidity, ammonia_ppm, sound_db,
                       temp_status, hum_status, ammonia_status, sound_status
                FROM sensor_logs
                ORDER BY frame_index DESC
                LIMIT {max(1, limit_recent)}
            """).fetchall()

            for r in recent_rows:
                t = float(r["temperature"]) if r["temperature"] is not None else None
                h = float(r["humidity"]) if r["humidity"] is not None else None
                thi = calculate_thi(t, h)
                recent_readings.append({
                    "frame_index": r["frame_index"],
                    "elapsed_seconds": r["elapsed_seconds"],
                    "video_time": r["video_time"] or f"{int(r['elapsed_seconds'] or 0):02d}s",
                    "captured_at": r["captured_at"],
                    "temperature_c": t,
                    "humidity_pct": h,
                    "ammonia_ppm": round(float(r["ammonia_ppm"]), 5) if r["ammonia_ppm"] is not None else None,
                    "sound_db": round(float(r["sound_db"]), 1) if r["sound_db"] is not None else None,
                    "thi": thi,
                    "heat_stress_level": calculate_heat_stress(thi),
                    "temp_status": r["temp_status"],
                    "hum_status": r["hum_status"],
                    "ammonia_status": r["ammonia_status"],
                    "sound_status": r["sound_status"],
                })

            if recent_readings:
                current_reading = recent_readings[0]

        elif "environmental_logs_raw" in tables:
            total_records = cursor.execute("SELECT COUNT(*) as cnt FROM environmental_logs_raw").fetchone()["cnt"]

            env_cols = {r["name"].lower() for r in cursor.execute("PRAGMA table_info(environmental_logs_raw)").fetchall()}
            t_col = "temperature_c" if "temperature_c" in env_cols else ("temperature" if "temperature" in env_cols else "NULL")
            h_col = "humidity_pct" if "humidity_pct" in env_cols else ("humidity" if "humidity" in env_cols else "NULL")
            nh3_col = "ammonia_ppm" if "ammonia_ppm" in env_cols else "NULL"
            lux_col = "lux" if "lux" in env_cols else "NULL"
            thi_col = "thi" if "thi" in env_cols else "NULL"

            stats_row = cursor.execute(f"""
                SELECT
                    AVG({t_col}) as t_avg, MIN({t_col}) as t_min, MAX({t_col}) as t_max,
                    AVG({h_col}) as h_avg, MIN({h_col}) as h_min, MAX({h_col}) as h_max,
                    AVG({nh3_col}) as nh3_avg, MAX({nh3_col}) as nh3_max,
                    AVG({lux_col}) as lux_avg, MAX({lux_col}) as lux_max,
                    AVG({thi_col}) as thi_avg
                FROM environmental_logs_raw
            """).fetchone()

            if stats_row:
                t_avg = round(float(stats_row["t_avg"]), 2) if stats_row["t_avg"] is not None else None
                h_avg = round(float(stats_row["h_avg"]), 1) if stats_row["h_avg"] is not None else None
                thi_avg = round(float(stats_row["thi_avg"]), 2) if stats_row["thi_avg"] is not None else calculate_thi(t_avg, h_avg)
                summary = {
                    "temp_avg_c": t_avg,
                    "temp_min_c": round(float(stats_row["t_min"]), 2) if stats_row["t_min"] is not None else None,
                    "temp_max_c": round(float(stats_row["t_max"]), 2) if stats_row["t_max"] is not None else None,
                    "humidity_avg_pct": h_avg,
                    "humidity_min_pct": round(float(stats_row["h_min"]), 1) if stats_row["h_min"] is not None else None,
                    "humidity_max_pct": round(float(stats_row["h_max"]), 1) if stats_row["h_max"] is not None else None,
                    "ammonia_ppm_avg": round(float(stats_row["nh3_avg"]), 5) if stats_row["nh3_avg"] is not None else None,
                    "ammonia_ppm_max": round(float(stats_row["nh3_max"]), 5) if stats_row["nh3_max"] is not None else None,
                    "lux_avg": round(float(stats_row["lux_avg"]), 1) if stats_row["lux_avg"] is not None else None,
                    "lux_max": round(float(stats_row["lux_max"]), 1) if stats_row["lux_max"] is not None else None,
                    "thi_avg": thi_avg,
                    "heat_stress_level": calculate_heat_stress(thi_avg),
                }

            id_expr = "id" if "id" in env_cols else "rowid AS id"
            lux_expr = "lux" if "lux" in env_cols else "NULL as lux"
            thi_expr = "thi" if "thi" in env_cols else "NULL as thi"
            stress_expr = "heat_stress_level" if "heat_stress_level" in env_cols else "NULL as heat_stress_level"
            time_expr = "timestamp" if "timestamp" in env_cols else ("captured_at" if "captured_at" in env_cols else "rowid as timestamp")

            recent_rows = cursor.execute(f"""
                SELECT {id_expr}, {time_expr} as timestamp, {t_col} as temperature_c,
                       {h_col} as humidity_pct, {nh3_col} as ammonia_ppm,
                       {lux_expr}, {thi_expr}, {stress_expr}
                FROM environmental_logs_raw
                ORDER BY rowid DESC
                LIMIT {max(1, limit_recent)}
            """).fetchall()

            for r in recent_rows:
                t = float(r["temperature_c"]) if r["temperature_c"] is not None else None
                h = float(r["humidity_pct"]) if r["humidity_pct"] is not None else None
                thi = float(r["thi"]) if r["thi"] is not None else calculate_thi(t, h)
                heat_stress = r["heat_stress_level"] or calculate_heat_stress(thi)
                ts_str = str(r["timestamp"] or "")
                recent_readings.append({
                    "frame_index": r["id"],
                    "elapsed_seconds": None,
                    "video_time": ts_str.split("T")[-1][:8] if "T" in ts_str else (ts_str.split()[-1][:8] if " " in ts_str else ts_str),
                    "captured_at": ts_str,
                    "temperature_c": t,
                    "humidity_pct": h,
                    "ammonia_ppm": round(float(r["ammonia_ppm"]), 5) if r["ammonia_ppm"] is not None else None,
                    "lux": round(float(r["lux"]), 1) if r["lux"] is not None else None,
                    "sound_db": None,
                    "thi": thi,
                    "heat_stress_level": heat_stress,
                    "temp_status": 0,
                    "hum_status": 0,
                    "ammonia_status": 0,
                    "sound_status": 0,
                })

            if recent_readings:
                current_reading = recent_readings[0]

        conn.close()

        return {
            "available": True,
            "database_name": resolved_path.name,
            "database_path": str(resolved_path),
            "paired_video": video_filename,
            "total_records": total_records,
            "current": current_reading,
            "summary": summary,
            "recent_readings": recent_readings,
            "status_message": f"Connected to {resolved_path.name} ({total_records:,} sensor readings)",
        }
    except Exception as error:
        return {
            "available": False,
            "database_name": resolved_path.name,
            "database_path": str(resolved_path),
            "paired_video": video_filename,
            "total_records": 0,
            "current": None,
            "summary": None,
            "recent_readings": [],
            "status_message": f"Error reading database: {error}",
        }
