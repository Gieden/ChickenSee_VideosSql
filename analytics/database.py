"""
analytics/database.py
SQLAlchemy schema and job state manager for the ZAMPEN Behavior & Sensor Analytics Pipeline.
Prevents duplicate video analysis and stores interval metrics.
"""

import datetime
import hashlib
from pathlib import Path
from typing import List, Optional, Dict, Any
from sqlalchemy import (
    create_engine, Column, Integer, String, Float, DateTime, 
    ForeignKey, Text, Index, Enum as SQLEnum, select, func
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship, Session
import enum

from .config import CONFIG

Base = declarative_base()


class JobStatus(str, enum.Enum):
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ProcessingJob(Base):
    """Tracks video analysis jobs to guarantee idempotency and prevent duplicate processing."""
    __tablename__ = "processing_jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    video_filename = Column(String(255), unique=True, nullable=False, index=True)
    video_path = Column(String(512), nullable=False)
    date_slot = Column(String(32), nullable=False, index=True)      # YYYY-MM-DD
    hour_slot = Column(String(32), nullable=False, index=True)      # HH:00
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    
    status = Column(SQLEnum(JobStatus), default=JobStatus.QUEUED, nullable=False, index=True)
    frames_processed = Column(Integer, default=0)
    total_frames = Column(Integer, default=0)
    processing_time_s = Column(Float, default=0.0)
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    # Relationships
    half_hour_metrics = relationship("HalfHourMetrics", back_populates="job", cascade="all, delete-orphan")


class HalfHourMetrics(Base):
    """
    Stores time-chunked sensor and vision behavior metrics.
    Each video produces one or more records based on its duration and configured chunk length.
    """
    __tablename__ = "half_hour_metrics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(Integer, ForeignKey("processing_jobs.id"), nullable=False, index=True)
    
    date_slot = Column(String(32), nullable=False, index=True)       # YYYY-MM-DD
    hour_slot = Column(String(32), nullable=False, index=True)       # HH:00
    chunk_index = Column(Integer, nullable=False)                    # 1 (00-30 min) or 2 (30-60 min)
    chunk_start = Column(DateTime, nullable=False, index=True)
    chunk_end = Column(DateTime, nullable=False, index=True)

    # Environmental Sensor 30-minute Averages
    temp_avg_c = Column(Float, nullable=False, default=0.0)
    temp_min_c = Column(Float, nullable=False, default=0.0)
    temp_max_c = Column(Float, nullable=False, default=0.0)
    humidity_avg_pct = Column(Float, nullable=False, default=0.0)
    humidity_min_pct = Column(Float, nullable=False, default=0.0)
    humidity_max_pct = Column(Float, nullable=False, default=0.0)
    ammonia_ppm_avg = Column(Float, nullable=False, default=0.0)
    ammonia_ppm_max = Column(Float, nullable=False, default=0.0)
    lux_avg = Column(Float, nullable=False, default=0.0)
    thi_avg = Column(Float, nullable=False, default=0.0)
    heat_stress_level = Column(String(32), nullable=False, default="Normal")

    # Flock Vision & ByteTrack Metrics
    unique_birds_tracked = Column(Integer, nullable=False, default=0)
    avg_birds_in_frame = Column(Float, nullable=False, default=0.0)
    flock_mobility_px_s = Column(Float, nullable=False, default=0.0)

    # Specific Behavior Metrics
    # 1. Reduce Eating Metric
    feeding_time_total_s = Column(Float, nullable=False, default=0.0)
    feeding_bouts = Column(Integer, nullable=False, default=0)
    reduced_eating_events = Column(Integer, nullable=False, default=0)  # Low-motion near feeder
    reduced_eating_index = Column(Float, nullable=False, default=0.0)   # % of feeder visits with low intake motion

    # 2. Drinking Metric
    drinking_time_total_s = Column(Float, nullable=False, default=0.0)
    drinking_bouts = Column(Integer, nullable=False, default=0)
    drinking_frequency_per_bird = Column(Float, nullable=False, default=0.0)

    # 3. Inactivity Metric
    inactivity_time_total_s = Column(Float, nullable=False, default=0.0)
    inactivity_pct = Column(Float, nullable=False, default=0.0)
    lethargic_birds_flagged = Column(Integer, nullable=False, default=0)

    # 4. Feather Pecking Metric
    feather_pecking_events = Column(Integer, nullable=False, default=0)
    agitation_score = Column(Float, nullable=False, default=0.0)

    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    job = relationship("ProcessingJob", back_populates="half_hour_metrics")
    bird_metrics = relationship("BirdTrackMetrics", back_populates="chunk_metric", cascade="all, delete-orphan")


class BirdTrackMetrics(Base):
    """Detailed per-track behavior metrics for individual birds within each 30-min window."""
    __tablename__ = "bird_track_metrics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    chunk_metric_id = Column(Integer, ForeignKey("half_hour_metrics.id"), nullable=False, index=True)
    
    track_id = Column(Integer, nullable=False, index=True)
    bird_label = Column(String(64), nullable=False)       # e.g., "Hen1 (Green)", "Rooster", "Chicken"
    bird_type = Column(String(32), nullable=False)        # "hen" or "rooster"
    
    feeding_s = Column(Float, default=0.0)
    feeding_bouts = Column(Integer, default=0)
    reduced_eating_flag = Column(Integer, default=0)       # 1 if individual flagged for reduced intake

    drinking_s = Column(Float, default=0.0)
    drinking_bouts = Column(Integer, default=0)

    inactivity_s = Column(Float, default=0.0)
    is_lethargic = Column(Integer, default=0)

    pecking_aggressor_count = Column(Integer, default=0)
    pecking_victim_count = Column(Integer, default=0)
    avg_velocity_px_s = Column(Float, default=0.0)

    chunk_metric = relationship("HalfHourMetrics", back_populates="bird_metrics")


# Indexes for rapid dashboard time-series queries
Index("idx_half_hour_date_hour", HalfHourMetrics.date_slot, HalfHourMetrics.hour_slot)
Index("idx_half_hour_range", HalfHourMetrics.chunk_start, HalfHourMetrics.chunk_end)


class DatabaseManager:
    """Helper manager for connection pooling, job leasing, and metrics retrieval."""

    def __init__(self, db_url: Optional[str] = None):
        self.db_url = db_url or CONFIG.analytics_db_url
        self.engine = create_engine(
            self.db_url,
            connect_args={"check_same_thread": False} if self.db_url.startswith("sqlite") else {}
        )
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.init_db()

    def init_db(self):
        """Creates tables if they do not exist."""
        Base.metadata.create_all(bind=self.engine)

    def get_session(self) -> Session:
        return self.SessionLocal()

    def is_file_processed(self, filename: str) -> bool:
        """Checks if a video file has already been completed to prevent duplicate processing."""
        with self.get_session() as session:
            job = session.query(ProcessingJob).filter_by(
                video_filename=filename, 
                status=JobStatus.COMPLETED
            ).first()
            if not job:
                job = session.query(ProcessingJob).filter_by(
                    video_path=filename,
                    status=JobStatus.COMPLETED
                ).first()
            return job is not None

    def lease_job(self, filename: str, filepath: str, start_dt: datetime.datetime, end_dt: datetime.datetime) -> Optional[ProcessingJob]:
        """Atomically leases or creates a job in PROCESSING status."""
        with self.get_session() as session:
            job = session.query(ProcessingJob).filter_by(video_path=filepath).first()
            if not job:
                job = session.query(ProcessingJob).filter_by(video_filename=filename).first()
                if job and job.video_path != filepath:
                    suffix = hashlib.sha256(filepath.encode("utf-8")).hexdigest()[:12]
                    path_obj = Path(filename)
                    filename = f"{path_obj.stem}_{suffix}{path_obj.suffix}"
                    job = session.query(ProcessingJob).filter_by(video_filename=filename).first()
            if job:
                if job.status == JobStatus.COMPLETED:
                    return None
                job.status = JobStatus.PROCESSING
                job.error_message = None
            else:
                job = ProcessingJob(
                    video_filename=filename,
                    video_path=filepath,
                    date_slot=start_dt.strftime("%Y-%m-%d"),
                    hour_slot=start_dt.strftime("%H:00"),
                    start_time=start_dt,
                    end_time=end_dt,
                    status=JobStatus.PROCESSING
                )
                session.add(job)
            session.commit()
            session.refresh(job)
            return job

    def mark_job_completed(self, job_id: int, frames: int, total_frames: int, duration_s: float):
        with self.get_session() as session:
            job = session.get(ProcessingJob, job_id)
            if job:
                job.status = JobStatus.COMPLETED
                job.frames_processed = frames
                job.total_frames = total_frames
                job.processing_time_s = duration_s
                job.completed_at = datetime.datetime.utcnow()
                session.commit()

    def mark_job_failed(self, job_id: int, error_msg: str):
        with self.get_session() as session:
            job = session.get(ProcessingJob, job_id)
            if job:
                job.status = JobStatus.FAILED
                job.error_message = str(error_msg)
                session.commit()

    def save_30m_metrics(self, job_id: int, metrics_list: List[Dict[str, Any]], bird_records_list: List[List[Dict[str, Any]]]):
        """Persists interval metric records and associated individual bird profiles."""
        with self.get_session() as session:
            for m_dict, birds in zip(metrics_list, bird_records_list):
                metric = HalfHourMetrics(job_id=job_id, **m_dict)
                session.add(metric)
                session.flush()

                for b_dict in birds:
                    b_rec = BirdTrackMetrics(chunk_metric_id=metric.id, **b_dict)
                    session.add(b_rec)
            session.commit()

    def get_latest_metrics(self) -> Optional[Dict[str, Any]]:
        """Returns the most recent video analysis and its intervals."""
        with self.get_session() as session:
            latest_job = session.query(ProcessingJob).filter_by(
                status=JobStatus.COMPLETED
            ).order_by(ProcessingJob.end_time.desc()).first()

            if not latest_job:
                return None

            chunks = session.query(HalfHourMetrics).filter_by(
                job_id=latest_job.id
            ).order_by(HalfHourMetrics.chunk_index.asc()).all()

            return {
                "job_id": latest_job.id,
                "video_filename": latest_job.video_filename,
                "date": latest_job.date_slot,
                "hour_slot": latest_job.hour_slot,
                "processed_at": latest_job.completed_at.isoformat() if latest_job.completed_at else None,
                "chunks_30m": [
                    {
                        "chunk_index": c.chunk_index,
                        "start_time": c.chunk_start.isoformat(),
                        "end_time": c.chunk_end.isoformat(),
                        "sensors": {
                            "temp_avg_c": c.temp_avg_c,
                            "temp_min_c": c.temp_min_c,
                            "temp_max_c": c.temp_max_c,
                            "humidity_avg_pct": c.humidity_avg_pct,
                            "ammonia_ppm_avg": c.ammonia_ppm_avg,
                            "lux_avg": c.lux_avg,
                            "thi_avg": c.thi_avg,
                            "heat_stress_level": c.heat_stress_level,
                        },
                        "behaviors": {
                            "unique_birds": c.unique_birds_tracked,
                            "avg_birds_present": c.avg_birds_in_frame,
                            "feeding_time_total_s": round(c.feeding_time_total_s, 1),
                            "feeding_bouts": c.feeding_bouts,
                            "reduced_eating_events": c.reduced_eating_events,
                            "reduced_eating_index_pct": round(c.reduced_eating_index * 100, 1),
                            "drinking_time_total_s": round(c.drinking_time_total_s, 1),
                            "drinking_bouts": c.drinking_bouts,
                            "inactivity_time_total_s": round(c.inactivity_time_total_s, 1),
                            "inactivity_pct": round(c.inactivity_pct, 1),
                            "lethargic_birds_flagged": c.lethargic_birds_flagged,
                            "feather_pecking_events": c.feather_pecking_events,
                            "agitation_score": round(c.agitation_score, 2),
                            "flock_mobility_px_s": round(c.flock_mobility_px_s, 2),
                        }
                    }
                    for c in chunks
                ]
            }

    def get_metrics_by_range(self, start_dt: datetime.datetime, end_dt: datetime.datetime) -> List[Dict[str, Any]]:
        """Queries historical 30-minute sensor averages and behavior analytics by timestamp range."""
        with self.get_session() as session:
            chunks = session.query(HalfHourMetrics).filter(
                HalfHourMetrics.chunk_start >= start_dt,
                HalfHourMetrics.chunk_end <= end_dt
            ).order_by(HalfHourMetrics.chunk_start.asc()).all()

            results = []
            for c in chunks:
                results.append({
                    "id": c.id,
                    "date": c.date_slot,
                    "hour_slot": c.hour_slot,
                    "chunk_index": c.chunk_index,
                    "start_time": c.chunk_start.isoformat(),
                    "end_time": c.chunk_end.isoformat(),
                    "environment": {
                        "temperature_c": c.temp_avg_c,
                        "humidity_pct": c.humidity_avg_pct,
                        "ammonia_ppm": c.ammonia_ppm_avg,
                        "lux": c.lux_avg,
                        "thi": c.thi_avg,
                        "heat_stress_level": c.heat_stress_level
                    },
                    "behavior_analytics": {
                        "unique_birds": c.unique_birds_tracked,
                        "reduced_eating_events": c.reduced_eating_events,
                        "reduced_eating_pct": round(c.reduced_eating_index * 100, 1),
                        "drinking_time_s": round(c.drinking_time_total_s, 1),
                        "drinking_bouts": c.drinking_bouts,
                        "inactivity_pct": round(c.inactivity_pct, 1),
                        "lethargic_birds": c.lethargic_birds_flagged,
                        "feather_pecking_events": c.feather_pecking_events,
                        "flock_mobility_px_s": round(c.flock_mobility_px_s, 2)
                    }
                })
            return results


DB = DatabaseManager()
