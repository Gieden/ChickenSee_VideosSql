import json
import os
from pathlib import Path
from typing import Dict, List, Optional


PROJECT_ROOT = Path(__file__).resolve().parent.parent
AGENT_DIR = PROJECT_ROOT / "agent"
DEFAULT_STORAGE_ROOT = Path(r"C:\ChickenSee_Local_Storage")
ENV_FILE = AGENT_DIR / ".env"
DIRECTORIES_FILE = AGENT_DIR / "directories.json"


def read_agent_settings(project_root: Path = PROJECT_ROOT) -> Dict[str, object]:
    agent_dir = project_root / "agent"
    env_values: Dict[str, str] = {}
    env_file = agent_dir / ".env"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                quote = value[0]
                value = value[1:-1]
                if quote == '"':
                    value = value.replace("\\\\", "\\").replace('\\"', '"')
            env_values[key.strip()] = value

    directories_file = agent_dir / "directories.json"
    directories: List[str] = []
    if directories_file.is_file():
        config = json.loads(directories_file.read_text(encoding="utf-8"))
        if not isinstance(config, dict) or not isinstance(config.get("directories"), list):
            raise ValueError(f"{directories_file} must contain a 'directories' list.")
        if not all(isinstance(item, str) for item in config["directories"]):
            raise ValueError(f"Every watched directory in {directories_file} must be a string.")
        directories = config["directories"]

    return {
        "directories": directories,
        "storage_root": env_values.get(
            "CHICKENSEE_LOCAL_STORAGE", str(DEFAULT_STORAGE_ROOT)
        ),
        "cloud_sync": env_values.get("ENABLE_CLOUD_SYNC", "0") == "1",
        "sync_url": env_values.get("VERCEL_SYNC_URL", ""),
        "sync_secret": env_values.get("SYNC_SECRET", ""),
        "env_values": env_values,
    }


def validate_agent_settings(settings: Dict[str, object]) -> Optional[str]:
    directories = settings.get("directories")
    if not isinstance(directories, list) or not directories:
        return "Add at least one existing video folder to watch."
    if not all(isinstance(path, str) and Path(path).is_dir() for path in directories):
        return "Every watched folder must exist. Select an existing folder or create it first."

    storage_root = settings.get("storage_root")
    if not isinstance(storage_root, str) or not storage_root.strip():
        return "Choose a local storage folder."

    if settings.get("cloud_sync"):
        sync_url = settings.get("sync_url")
        if not isinstance(sync_url, str) or not sync_url.startswith("https://"):
            return "Cloud sync requires a valid HTTPS Vercel sync URL."
        if not isinstance(settings.get("sync_secret"), str) or not settings["sync_secret"].strip():
            return "Cloud sync requires the sync secret configured in Vercel."
    return None


def write_agent_settings(
    settings: Dict[str, object], project_root: Path = PROJECT_ROOT
) -> None:
    error = validate_agent_settings(settings)
    if error:
        raise ValueError(error)

    agent_dir = project_root / "agent"
    agent_dir.mkdir(parents=True, exist_ok=True)
    storage_root = Path(str(settings["storage_root"])).expanduser().resolve()
    storage_root.mkdir(parents=True, exist_ok=True)

    directories = [str(Path(path).expanduser().resolve()) for path in settings["directories"]]
    (agent_dir / "directories.json").write_text(
        json.dumps({"directories": directories}, indent=2) + "\n",
        encoding="utf-8",
    )

    env_values = dict(settings.get("env_values", {}))
    env_values.update(
        {
            "VERCEL_SYNC_URL": str(settings.get("sync_url", "")).strip(),
            "SYNC_SECRET": str(settings.get("sync_secret", "")),
            "WATCH_DIRS": ",".join(Path(path).as_posix() for path in directories),
            "WATCH_DIR": Path(directories[0]).as_posix() if directories else "./data",
            "ENABLE_CLOUD_SYNC": "1" if settings.get("cloud_sync") else "0",
            "SYNC_VIDEOS_TO_CLOUD": "0",
            "CHICKENSEE_LOCAL_STORAGE": storage_root.as_posix(),
        }
    )
    env_file = agent_dir / ".env"
    with env_file.open("w", encoding="utf-8", newline="\n") as output:
        for key, value in env_values.items():
            safe_value = str(value).replace('"', '\\"')
            output.write(f'{key}="{safe_value}"\n')

    if os.name != "nt":
        os.chmod(env_file, 0o600)


def write_watch_directories(
    directories: List[str], project_root: Path = PROJECT_ROOT
) -> None:
    settings = read_agent_settings(project_root)
    settings["directories"] = directories
    write_agent_settings(settings, project_root)
