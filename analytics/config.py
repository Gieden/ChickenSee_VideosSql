"""
analytics/config.py
Configuration module for the ZAMPEN Native Layer Chicken Behavior & Sensor Analytics Pipeline.
Optimized for local Dell OptiPlex edge execution with YOLO26 Nano and ByteTrack.
"""

import os
from pathlib import Path
from pydantic import BaseModel, Field

# Base directories
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
DATA_DIR = PROJECT_ROOT / "agent" / "data"
VIDEO_INPUT_DIR = Path(os.getenv("VIDEO_INPUT_DIR", str(DATA_DIR)))
SENSOR_DB_PATH = Path(os.getenv("SENSOR_DB_PATH", str(DATA_DIR / "chicken_telemetry.db")))
ANALYTICS_DB_PATH = Path(os.getenv("ANALYTICS_DB_PATH", str(BASE_DIR / "zampen_analytics.db")))


class AnalyticsConfig(BaseModel):
    # Model & Tracker
    model_name: str = Field(default="yolo26n.pt", description="YOLO model weights name or path")
    custom_weights_path: str = Field(
        default=str(PROJECT_ROOT / "custom_poultry.pt"),
        description="Optional fine-tuned poultry weights fallback"
    )
    tracker_config: str = Field(
        default=str(PROJECT_ROOT / "bytetrack_poultry.yaml") if (PROJECT_ROOT / "bytetrack_poultry.yaml").exists() else "bytetrack.yaml",
        description="ByteTrack YAML tracker configuration"
    )
    device: str = Field(default=os.getenv("INFERENCE_DEVICE", "cpu"), description="'cpu' or '0' for CUDA")
    conf_threshold: float = Field(default=0.15, description="Object detection confidence threshold")
    iou_threshold: float = Field(default=0.45, description="NMS IoU threshold")
    imgsz: int = Field(default=640, description="Inference input image resolution")
    frame_stride: int = Field(default=2, description="Process every Nth frame (2 = 15fps from 30fps input)")

    # Processing & Lag Pipeline
    lag_hours: int = Field(default=1, description="Rolling delay in hours (process completed 1-hr file from prev hour)")
    chunk_minutes: int = Field(default=30, description="Chunk interval for averages (30-min intervals)")
    poll_interval_s: int = Field(default=60, description="Worker daemon polling interval in seconds")

    # Paths
    video_dir: str = str(VIDEO_INPUT_DIR)
    sensor_db_url: str = f"sqlite:///{SENSOR_DB_PATH.as_posix()}"
    analytics_db_url: str = f"sqlite:///{ANALYTICS_DB_PATH.as_posix()}"

    # Behavior Detection Thresholds (pixels & seconds for 640x360 or 1280x720 video)
    feeder_zone_proximity_px: float = Field(default=95.0, description="Proximity threshold to feeder bounding box")
    waterer_zone_proximity_px: float = Field(default=95.0, description="Proximity threshold to waterer bounding box")
    
    # Inactivity Thresholds
    inactivity_velocity_threshold_px_s: float = Field(default=3.5, description="Centroid displacement below which bird is stationary")
    inactivity_sustained_duration_s: float = Field(default=180.0, description="Sustained stationary seconds to flag lethargy")
    
    # Reduced Eating Thresholds
    reduced_eating_motion_threshold_px_s: float = Field(
        default=4.0, 
        description="Minimum localized jitter/pecking motion required while in feeder zone"
    )
    
    # Feather Pecking Detection Thresholds
    feather_pecking_proximity_px: float = Field(default=45.0, description="Inter-bird centroid distance for close interaction")
    feather_pecking_approach_speed_px_s: float = Field(default=48.0, description="Rapid approach speed indicating aggression")
    feather_pecking_escape_speed_px_s: float = Field(default=40.0, description="Victim escape acceleration burst")

    # Server API
    api_host: str = Field(default="0.0.0.0", description="FastAPI host")
    api_port: int = Field(default=8000, description="FastAPI port")


CONFIG = AnalyticsConfig()
