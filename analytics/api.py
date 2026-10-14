"""
analytics/api.py
FastAPI REST API wrapper for the ZAMPEN Native Layer Chicken Analytics System.
Exposes endpoints for external front-ends and dashboards:
  - GET /health
  - GET /results/latest
  - GET /results/range?start=...&end=...
  - GET /jobs
  - POST /jobs/process-now
"""

import os
import psutil
import datetime
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Query, BackgroundTasks, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .config import CONFIG
from .database import DB, ProcessingJob, HalfHourMetrics, JobStatus

app = FastAPI(
    title="ZAMPEN Native Layer Chicken Behavior & Sensor Analytics API",
    description="Automated 1-hour lag behavior analysis and 30-minute sensor aggregation pipeline using YOLO26n + ByteTrack.",
    version="1.0.0"
)

# Enable CORS for Next.js and external dashboards
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    status: str
    timestamp: str
    uptime_s: float
    system: Dict[str, Any]
    model: Dict[str, Any]
    storage: Dict[str, Any]


START_TIME = datetime.datetime.utcnow()


@app.get("/health", response_model=HealthResponse, tags=["System Health"])
def get_health():
    """
    Check worker daemon status, CPU/RAM utilization, and model availability on the OptiPlex.
    """
    uptime = (datetime.datetime.utcnow() - START_TIME).total_seconds()
    cpu_pct = psutil.cpu_percent(interval=None)
    ram = psutil.virtual_memory()

    with DB.get_session() as session:
        active_job = session.query(ProcessingJob).filter_by(status=JobStatus.PROCESSING).first()
        completed_count = session.query(ProcessingJob).filter_by(status=JobStatus.COMPLETED).count()
        failed_count = session.query(ProcessingJob).filter_by(status=JobStatus.FAILED).count()

    return HealthResponse(
        status="healthy",
        timestamp=datetime.datetime.utcnow().isoformat() + "Z",
        uptime_s=round(uptime, 1),
        system={
            "cpu_percent": cpu_pct,
            "ram_used_mb": round((ram.total - ram.available) / 1024 / 1024, 1),
            "ram_total_mb": round(ram.total / 1024 / 1024, 1),
            "active_processing_job": active_job.video_filename if active_job else None,
        },
        model={
            "detector": CONFIG.model_name,
            "tracker": CONFIG.tracker_config,
            "device": CONFIG.device,
            "conf_threshold": CONFIG.conf_threshold,
        },
        storage={
            "analytics_db": CONFIG.analytics_db_url,
            "completed_jobs": completed_count,
            "failed_jobs": failed_count,
        }
    )


@app.get("/results/latest", tags=["Analytics Results"])
def get_latest_results():
    """
    Instantly fetch the most recent hourly processed metrics block.
    Returns both 30-minute chunk intervals with paired environmental sensor averages and vision behaviors.
    """
    latest = DB.get_latest_metrics()
    if not latest:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No processed analytics results found yet. Worker may still be processing initial files."
        )
    return latest


@app.get("/results/range", tags=["Analytics Results"])
def get_results_by_range(
    start: str = Query(..., description="Start timestamp in ISO 8601 (e.g. 2026-10-14T06:00:00)"),
    end: str = Query(..., description="End timestamp in ISO 8601 (e.g. 2026-10-14T18:00:00)")
):
    """
    Query historical 30-minute sensor averages and behavior analytics by timestamp range.
    Splits into 30-minute intervals containing temperature, humidity, ammonia, THI,
    as well as Reduced Eating, Drinking, Inactivity, and Feather Pecking measurements.
    """
    try:
        start_clean = start.replace("Z", "")
        end_clean = end.replace("Z", "")
        start_dt = datetime.datetime.fromisoformat(start_clean)
        end_dt = datetime.datetime.fromisoformat(end_clean)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid ISO 8601 timestamp format: {e}. Example: 2026-10-14T06:00:00"
        )

    records = DB.get_metrics_by_range(start_dt, end_dt)
    return {
        "query_range": {
            "start": start,
            "end": end,
            "total_30m_chunks_found": len(records),
        },
        "records": records
    }


@app.get("/jobs", tags=["Job State Manager"])
def list_jobs(limit: int = Query(default=20, le=100)):
    """List recent hourly video processing jobs and their state."""
    with DB.get_session() as session:
        jobs = session.query(ProcessingJob).order_by(ProcessingJob.id.desc()).limit(limit).all()
        return [
            {
                "id": j.id,
                "video_filename": j.video_filename,
                "date": j.date_slot,
                "hour_slot": j.hour_slot,
                "status": j.status.value,
                "frames_processed": j.frames_processed,
                "total_frames": j.total_frames,
                "processing_time_s": round(j.processing_time_s, 1),
                "created_at": j.created_at.isoformat() if j.created_at else None,
                "completed_at": j.completed_at.isoformat() if j.completed_at else None,
                "error_message": j.error_message,
            }
            for j in jobs
        ]


@app.post("/jobs/trigger", tags=["Job State Manager"])
def trigger_process_file(
    video_filename: str, 
    background_tasks: BackgroundTasks, 
    force: bool = False
):
    """
    Manually triggers processing of a specific video file in the background.
    """
    video_path = os.path.join(CONFIG.video_dir, video_filename)
    if not os.path.exists(video_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File {video_filename} not found in {CONFIG.video_dir}"
        )

    if not force and DB.is_file_processed(video_filename):
        return {"message": f"File {video_filename} is already completed.", "status": "COMPLETED"}

    from .worker import ZampenAnalyticsWorker
    worker = ZampenAnalyticsWorker()
    start_dt, end_dt = worker._extract_timestamps_from_file(os.path.PathLike(video_path) if hasattr(os, "PathLike") else datetime.datetime.now())

    def _run_task():
        worker._process_hourly_segment(video_path, video_filename, start_dt, end_dt)

    background_tasks.add_task(_run_task)
    return {
        "message": f"Processing queued for {video_filename}",
        "video_filename": video_filename,
        "status": "QUEUED"
    }


def start_server():
    import uvicorn
    uvicorn.run("analytics.api:app", host=CONFIG.api_host, port=CONFIG.api_port, reload=False)


if __name__ == "__main__":
    start_server()