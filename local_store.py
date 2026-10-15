"""Shared local paths for annotated detection videos and result files."""

import os
import json
import shutil
from pathlib import Path
from datetime import datetime, date
from typing import Any, Optional


def _configured_local_root() -> str:
    configured = os.getenv("CHICKENSEE_LOCAL_STORAGE")
    if configured:
        return configured

    agent_env = Path(__file__).resolve().parent / "agent" / ".env"
    if agent_env.is_file():
        for line in agent_env.read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip() == "CHICKENSEE_LOCAL_STORAGE":
                return value.strip().strip('"').strip("'")

    return r"C:\ChickenSee_Local_Storage"


LOCAL_ROOT = Path(_configured_local_root())
VIDEOS_DIR = LOCAL_ROOT / "videos"
RESULTS_DIR = LOCAL_ROOT / "results"


def ensure_dirs() -> None:
    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)


def json_default(obj: Any):
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Path):
        return str(obj)
    if isinstance(obj, set):
        return list(obj)
    return str(obj)


def write_results_json(stem: str, payload: dict) -> Path:
    ensure_dirs()
    path = RESULTS_DIR / f"{stem}_results.json"
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, default=json_default)
    return path


def copy_video_locally(src: str, dest_name: Optional[str] = None) -> Optional[Path]:
    """Copies a finished video into the local videos folder."""
    if not src or not os.path.isfile(src):
        return None
    ensure_dirs()
    dest = VIDEOS_DIR / (dest_name or Path(src).name)
    shutil.copy2(src, dest)
    return dest


def copy_result_file(src: str) -> Optional[Path]:
    if not src or not os.path.isfile(src):
        return None
    ensure_dirs()
    dest = RESULTS_DIR / Path(src).name
    shutil.copy2(src, dest)
    return dest


ensure_dirs()
