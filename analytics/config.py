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
    conf_threshold: float = Field(default=0.25, description="Object detection confidence threshold")
    iou_threshold: float = Field(default=0.45, description="NMS IoU threshold")
    imgsz: int = Field(default=640, description="Inference input image resolution")
    frame_stride: int = Field(default=2, description="Process every Nth frame (2 = 15fps from 30fps input)")

    # Processing & video discovery
    chunk_minutes: int = Field(default_factory=lambda: int(os.getenv("CHUNK_MINUTES", "30")), description="Maximum duration of each analysis interval")
    poll_interval_s: int = Field(default_factory=lambda: int(os.getenv("VIDEO_POLL_INTERVAL_S", "1")), description="Worker video discovery fallback interval in seconds")
    stability_threshold_s: float = Field(
        default_factory=lambda: float(os.getenv("FILE_STABILITY_THRESHOLD_S", "2.0")),
        description="Required idle duration in seconds before processing a newly written video"
    )

    # Paths
    video_dir: str = str(VIDEO_INPUT_DIR)
    sensor_db_url: str = f"sqlite:///{SENSOR_DB_PATH.as_posix()}"
    analytics_db_url: str = f"sqlite:///{ANALYTICS_DB_PATH.as_posix()}"

    # Precise 4-Behavior Detection Thresholds (pixels & seconds for 640x360 or 1280x720 video)
    # 1. Reduced Feeding Behavior Thresholds
    feeder_zone_proximity_px: float = Field(default=95.0, description="Proximity threshold to feeder bounding box")
    reduced_feeding_idle_seconds: float = Field(default=10.0, description="Sustained idle time near feeder indicating reduced feeding")
    reduced_feeding_motion_threshold_px_s: float = Field(default=3.5, description="Maximum motion displacement for idle lingering at feeder")
    reduced_eating_motion_threshold_px_s: float = Field(default=3.5, description="Legacy alias for reduced_feeding_motion_threshold_px_s")

    # 2. Reduced Drinking Behavior Thresholds
    waterer_zone_proximity_px: float = Field(default=95.0, description="Proximity threshold to waterer/drinker bounding box")
    reduced_drinking_idle_seconds: float = Field(default=8.0, description="Sustained idle time near drinker indicating reduced drinking")
    reduced_drinking_motion_threshold_px_s: float = Field(default=3.0, description="Maximum motion displacement for idle lingering at drinker")
    drinker_visit_deficit_seconds: float = Field(default=600.0, description="Sustained interval without drinking indicating drinking deficit")

    # 3. Prolonged Low Activity Thresholds
    low_activity_velocity_threshold_px_s: float = Field(default=3.0, description="Centroid displacement below which bird is stationary")
    prolonged_low_activity_duration_s: float = Field(default=60.0, description="Sustained stationary seconds to flag prolonged low activity")
    inactivity_velocity_threshold_px_s: float = Field(default=3.0, description="Legacy alias for low_activity_velocity_threshold_px_s")
    inactivity_sustained_duration_s: float = Field(default=60.0, description="Legacy alias for prolonged_low_activity_duration_s")

    # 4. Social Isolation Thresholds
    social_isolation_distance_px: float = Field(default=180.0, description="Nearest-neighbor distance threshold for spatial isolation")
    social_isolation_duration_s: float = Field(default=10.0, description="Continuous seconds away from flock to flag social isolation")
    social_isolation_relative_ratio: float = Field(default=2.2, description="Ratio of nearest-neighbor distance to flock median distance")
    
    # Legacy interaction thresholds (preserved for backward compatibility)
    feather_pecking_proximity_px: float = Field(default=60.0, description="Inter-bird centroid distance threshold for close interaction")
    feather_pecking_approach_speed_px_s: float = Field(default=22.0, description="Minimum approach speed (px/s)")
    feather_pecking_escape_speed_px_s: float = Field(default=18.0, description="Minimum escape speed (px/s)")

    # Server API
    api_host: str = Field(default="0.0.0.0", description="FastAPI host")
    api_port: int = Field(default=8000, description="FastAPI port")


CONFIG = AnalyticsConfig()