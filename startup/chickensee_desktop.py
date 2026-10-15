import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import webbrowser

import psutil

if __package__:
    from .configuration import (
        AGENT_DIR,
        DEFAULT_STORAGE_ROOT,
        PROJECT_ROOT,
        read_agent_settings,
        validate_agent_settings,
        write_agent_settings,
        write_watch_directories,
    )
else:
    from configuration import (
        AGENT_DIR,
        DEFAULT_STORAGE_ROOT,
        PROJECT_ROOT,
        read_agent_settings,
        validate_agent_settings,
        write_agent_settings,
        write_watch_directories,
    )


HEALTH_URL = "http://127.0.0.1:8000/health"
QUEUE_URL = "http://127.0.0.1:8000/queue"
REFRESH_INTERVAL_MS = 2000
POWERSHELL = "powershell.exe"

COLORS = {
    "background": "#f3f6fb",
    "surface": "#ffffff",
    "ink": "#172033",
    "muted": "#65738b",
    "primary": "#3157d5",
    "primary_hover": "#2546b8",
    "green": "#168454",
    "red": "#c43c4a",
    "border": "#dce3ef",
    "soft_blue": "#e9efff",
}

SUPERVISOR_SCRIPT = Path("startup") / "run-chickensee.ps1"


def find_service_processes() -> Dict[str, List[int]]:
    matches: Dict[str, List[int]] = {
        "sync-agent": [],
        "analytics-api": [],
        "analytics-worker": [],
        "supervisor": [],
    }
    for process in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            name = (process.info["name"] or "").lower()
            command = " ".join(process.info["cmdline"] or []).lower()
        except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess):
            continue

        if name in ("node.exe", "node") and "watcher.js" in command:
            matches["sync-agent"].append(process.info["pid"])
        elif name.startswith("python") and "-m analytics.api" in command:
            matches["analytics-api"].append(process.info["pid"])
        elif name.startswith("python") and "-m analytics.worker" in command:
            matches["analytics-worker"].append(process.info["pid"])
        elif "run-chickensee.ps1" in command:
            matches["supervisor"].append(process.info["pid"])
    return matches


def start_supervisor(
    project_root: Path = PROJECT_ROOT,
    storage_root: Path = DEFAULT_STORAGE_ROOT,
) -> subprocess.Popen:
    script_path = project_root / SUPERVISOR_SCRIPT
    if not script_path.is_file():
        raise FileNotFoundError(f"ChickenSee startup supervisor not found: {script_path}")
    log_dir = storage_root.expanduser() / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    launch_log = log_dir / "startup-launch.log"
    with launch_log.open("a", encoding="utf-8") as output:
        return subprocess.Popen(
            [
                POWERSHELL,
                "-NoProfile",
                "-WindowStyle",
                "Hidden",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script_path),
            ],
            cwd=project_root,
            stdout=output,
            stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )


def capture_service_processes() -> Dict[str, List[Tuple[psutil.Process, float]]]:
    captured: Dict[str, List[Tuple[psutil.Process, float]]] = {
        "sync-agent": [],
        "analytics-api": [],
        "analytics-worker": [],
        "supervisor": [],
    }
    for category, pids in find_service_processes().items():
        for pid in pids:
            try:
                process = psutil.Process(pid)
                captured[category].append((process, process.create_time()))
            except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess):
                continue
    return captured


def stop_processes_after_signal(
    targets: Dict[str, List[Tuple[psutil.Process, float]]],
    graceful_timeout_s: float = 15.0,
) -> bool:
    """Wait for the supervisor, then stop only captured ChickenSee processes if needed."""
    all_targets = [target for group in targets.values() for target in group]
    deadline = time.monotonic() + graceful_timeout_s

    def still_running(target: Tuple[psutil.Process, float]) -> bool:
        process, created_at = target
        try:
            return process.is_running() and process.create_time() == created_at
        except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess):
            return False

    while time.monotonic() < deadline and any(still_running(target) for target in all_targets):
        time.sleep(0.25)

    remaining_supervisors = [
        target for target in targets["supervisor"] if still_running(target)
    ]
    remaining_services = [
        target
        for name, group in targets.items()
        if name != "supervisor"
        for target in group
        if still_running(target)
    ]
    if not remaining_supervisors and not remaining_services:
        return False

    for process, _ in remaining_supervisors:
        try:
            process.terminate()
        except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess):
            continue
    if remaining_supervisors:
        psutil.wait_procs([target[0] for target in remaining_supervisors], timeout=5)
    still_running_supervisors = [
        process.pid
        for process, created_at in remaining_supervisors
        if still_running((process, created_at))
    ]
    if still_running_supervisors:
        raise RuntimeError(
            "Could not stop the ChickenSee supervisor: "
            + ", ".join(f"PID {pid}" for pid in still_running_supervisors)
        )

    for process, _ in remaining_services:
        try:
            process.terminate()
        except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess):
            continue
    _, stubborn = psutil.wait_procs(
        [target[0] for target in remaining_services], timeout=5
    )
    for process in stubborn:
        try:
            process.kill()
        except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess):
            continue
    if stubborn:
        _, still_stubborn = psutil.wait_procs(stubborn, timeout=3)
        if still_stubborn:
            raise RuntimeError(
                "Could not stop ChickenSee processes: "
                + ", ".join(f"PID {process.pid}" for process in still_stubborn)
            )
    still_running_services = [
        process.pid
        for process, created_at in remaining_services
        if still_running((process, created_at))
    ]
    if still_running_services:
        raise RuntimeError(
            "ChickenSee services are still running: "
            + ", ".join(f"PID {pid}" for pid in still_running_services)
        )
    return True


def request_stop(
    storage_root: Path,
    supervisor_pids: List[int],
    agent_dir: Path = AGENT_DIR,
) -> None:
    timestamp = datetime.now().isoformat()
    storage_roots = {storage_root}
    supervisor_state = agent_dir / ".supervisor-state.json"
    if supervisor_state.is_file():
        state = json.loads(supervisor_state.read_text(encoding="utf-8-sig"))
        if state.get("process_id") in supervisor_pids:
            storage_roots.add(Path(state["storage_root"]))
    stop_files = [agent_dir / ".stop-request"]
    stop_files.extend(root / "logs" / "stop-request" for root in storage_roots)
    for stop_file in stop_files:
        stop_file.parent.mkdir(parents=True, exist_ok=True)
        stop_file.write_text(timestamp, encoding="utf-8")


def format_queue_progress(status: str, progress_percent: Optional[float]) -> str:
    if progress_percent is None:
        return "Waiting" if status in ("QUEUED", "WAITING") else "—"
    return f"{max(0.0, min(float(progress_percent), 100.0)):.1f}%"


class ChickenSeeDesktop:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("ChickenSee Control Center")
        self.root.geometry("1050x760")
        self.root.minsize(900, 650)
        self.root.configure(bg=COLORS["background"])
        self.root.protocol("WM_DELETE_WINDOW", self.root.destroy)
        self.events: "queue.Queue[tuple]" = queue.Queue()
        self.refresh_in_progress = False
        self.refresh_pending = False
        self.active_job_id: Optional[int] = None
        self.cancel_in_progress = False
        self.starting_services = False
        self.stopping_services = False
        self.settings = read_agent_settings()
        self._configure_styles()
        self._build_layout()
        self._load_settings_into_form()
        self._refresh_status()
        self.root.after(250, self._drain_events)
        self.root.after(REFRESH_INTERVAL_MS, self._schedule_refresh)

    def _configure_styles(self) -> None:
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure("TFrame", background=COLORS["background"])
        style.configure(
            "TLabel",
            background=COLORS["background"],
            foreground=COLORS["ink"],
            font=("Segoe UI", 10),
        )
        style.configure(
            "Title.TLabel",
            background=COLORS["background"],
            foreground=COLORS["ink"],
            font=("Segoe UI Semibold", 24),
        )
        style.configure(
            "Subtitle.TLabel",
            background=COLORS["background"],
            foreground=COLORS["muted"],
            font=("Segoe UI", 10),
        )
        style.configure(
            "TButton",
            padding=(12, 8),
            font=("Segoe UI Semibold", 10),
            borderwidth=0,
        )
        style.configure(
            "Primary.TButton",
            background=COLORS["primary"],
            foreground="#ffffff",
        )
        style.map("Primary.TButton", background=[("active", COLORS["primary_hover"])])
        style.configure(
            "Stop.TButton",
            background=COLORS["red"],
            foreground="#ffffff",
            padding=(16, 11),
            font=("Segoe UI Semibold", 11),
        )
        style.map(
            "Stop.TButton",
            background=[
                ("disabled", "#b8c0cc"),
                ("active", "#a92e3b"),
            ],
            foreground=[("disabled", "#eef1f5")],
        )
        style.configure(
            "Start.TButton",
            background=COLORS["green"],
            foreground="#ffffff",
            padding=(16, 11),
            font=("Segoe UI Semibold", 11),
        )
        style.map(
            "Start.TButton",
            background=[
                ("disabled", "#b8c0cc"),
                ("active", "#106b43"),
            ],
            foreground=[("disabled", "#eef1f5")],
        )
        style.configure("TNotebook", background=COLORS["background"], borderwidth=0)
        style.configure(
            "TNotebook.Tab",
            padding=(18, 10),
            background=COLORS["background"],
            foreground=COLORS["muted"],
            font=("Segoe UI Semibold", 10),
        )
        style.map(
            "TNotebook.Tab",
            background=[("selected", COLORS["surface"])],
            foreground=[("selected", COLORS["primary"])],
        )
        style.configure("Treeview", rowheight=28, font=("Segoe UI", 10))
        style.configure("Treeview.Heading", font=("Segoe UI Semibold", 9))

    def _build_layout(self) -> None:
        header = ttk.Frame(self.root, padding=(28, 22, 28, 12))
        header.pack(fill="x")
        heading = ttk.Frame(header)
        heading.pack(side="left", fill="x", expand=True)
        ttk.Label(heading, text="ChickenSee", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            heading,
            text="Video analysis and sync at a glance",
            style="Subtitle.TLabel",
        ).pack(anchor="w", pady=(2, 0))
        self.header_status = tk.Label(
            header,
            text="Checking system…",
            bg=COLORS["soft_blue"],
            fg=COLORS["primary"],
            font=("Segoe UI Semibold", 10),
            padx=14,
            pady=8,
        )
        self.header_status.pack(side="right", anchor="n", pady=8)

        self.tabs = ttk.Notebook(self.root)
        self.tabs.pack(fill="both", expand=True, padx=22, pady=(8, 22))
        self.dashboard = ttk.Frame(self.tabs, padding=20)
        self.queue_page = ttk.Frame(self.tabs, padding=20)
        self.setup = ttk.Frame(self.tabs, padding=20)
        self.tabs.add(self.dashboard, text="  Dashboard  ")
        self.tabs.add(self.queue_page, text="  Queue  ")
        self.tabs.add(self.setup, text="  Setup  ")
        self._build_dashboard()
        self._build_queue()
        self._build_setup()

    def _build_dashboard(self) -> None:
        actions = ttk.Frame(self.dashboard)
        actions.pack(fill="x", pady=(0, 18))
        self.start_button = ttk.Button(
            actions,
            text="▶  Start ChickenSee",
            style="Start.TButton",
            command=self.start_services,
        )
        self.start_button.pack(side="left", padx=(0, 8))
        self.stop_button = ttk.Button(
            actions,
            text="⏻  Stop ChickenSee",
            style="Stop.TButton",
            command=self.stop_services,
        )
        self.stop_button.pack(side="left")
        ttk.Button(actions, text="Open API docs", command=self.open_api_docs).pack(
            side="right"
        )
        ttk.Button(actions, text="Open logs", command=self.open_logs).pack(
            side="right", padx=(0, 8)
        )

        cards = ttk.Frame(self.dashboard)
        cards.pack(fill="x")
        self.service_labels: Dict[str, tk.Label] = {}
        card_names = [
            ("sync-agent", "Folder watcher"),
            ("analytics-api", "Analytics API"),
            ("analytics-worker", "Video analyzer"),
        ]
        for index, (key, title) in enumerate(card_names):
            card = tk.Frame(
                cards,
                bg=COLORS["surface"],
                highlightbackground=COLORS["border"],
                highlightthickness=1,
                padx=18,
                pady=16,
            )
            card.grid(row=0, column=index, sticky="nsew", padx=(0 if index == 0 else 10, 0))
            cards.columnconfigure(index, weight=1)
            tk.Label(
                card,
                text=title,
                bg=COLORS["surface"],
                fg=COLORS["muted"],
                font=("Segoe UI Semibold", 10),
            ).pack(anchor="w")
            label = tk.Label(
                card,
                text="Checking…",
                bg=COLORS["surface"],
                fg=COLORS["ink"],
                font=("Segoe UI Semibold", 15),
            )
            label.pack(anchor="w", pady=(8, 0))
            self.service_labels[key] = label

        active_card = tk.Frame(
            self.dashboard,
            bg=COLORS["surface"],
            highlightbackground=COLORS["border"],
            highlightthickness=1,
            padx=18,
            pady=16,
        )
        active_card.pack(fill="x", pady=(14, 18))
        tk.Label(
            active_card,
            text="CURRENT ANALYSIS",
            bg=COLORS["surface"],
            fg=COLORS["muted"],
            font=("Segoe UI Semibold", 9),
        ).pack(anchor="w")
        self.job_label = tk.Label(
            active_card,
            text="No active video",
            bg=COLORS["surface"],
            fg=COLORS["ink"],
            font=("Segoe UI Semibold", 14),
        )
        self.job_label.pack(anchor="w", pady=(6, 0))
        self.storage_label = tk.Label(
            active_card,
            text="",
            bg=COLORS["surface"],
            fg=COLORS["muted"],
            font=("Segoe UI", 9),
            wraplength=900,
            justify="left",
        )
        self.storage_label.pack(anchor="w", pady=(4, 0))

        test_panel = ttk.LabelFrame(
            self.dashboard,
            text="Quick video test",
            padding=(16, 12),
        )
        test_panel.pack(fill="x")
        self.test_directory = tk.StringVar()
        self.test_directory_combo = ttk.Combobox(
            test_panel,
            textvariable=self.test_directory,
            state="readonly",
            width=70,
        )
        self.test_directory_combo.pack(side="left", fill="x", expand=True, padx=(0, 10))
        ttk.Button(
            test_panel,
            text="Choose a video and test",
            command=self.run_video_test,
        ).pack(side="right")
        ttk.Label(
            self.dashboard,
            text="A copy is placed in the selected watched folder. Your original video stays unchanged.",
            style="Subtitle.TLabel",
        ).pack(anchor="w", pady=(8, 0))

        self.activity = tk.Text(
            self.dashboard,
            height=6,
            wrap="word",
            bg=COLORS["surface"],
            fg=COLORS["ink"],
            relief="solid",
            borderwidth=1,
            highlightthickness=0,
            font=("Consolas", 9),
            state="disabled",
        )
        self.activity.pack(fill="both", expand=True, pady=(16, 0))

    def _build_queue(self) -> None:
        heading = ttk.Frame(self.queue_page)
        heading.pack(fill="x")
        title = ttk.Frame(heading)
        title.pack(side="left", fill="x", expand=True)
        ttk.Label(title, text="Detection queue", font=("Segoe UI Semibold", 18)).pack(
            anchor="w"
        )
        ttk.Label(
            title,
            text="Videos are ordered by the analyzer’s oldest-first discovery. Waiting files do not show a fabricated percentage.",
            style="Subtitle.TLabel",
        ).pack(anchor="w", pady=(4, 0))
        ttk.Button(heading, text="Refresh now", command=self._refresh_status).pack(
            side="right", anchor="n"
        )

        current = ttk.LabelFrame(self.queue_page, text="Current analysis", padding=14)
        current.pack(fill="x", pady=(16, 12))
        current_header = ttk.Frame(current)
        current_header.pack(fill="x")
        self.queue_active_label = ttk.Label(
            current_header, text="No active analysis", font=("Segoe UI Semibold", 11)
        )
        self.queue_active_label.pack(side="left", anchor="w", fill="x", expand=True)
        self.cancel_analysis_button = ttk.Button(
            current_header,
            text="Cancel analysis",
            command=self._cancel_active_analysis,
            state="disabled",
        )
        self.cancel_analysis_button.pack(side="right")
        self.queue_progress = ttk.Progressbar(
            current, orient="horizontal", mode="determinate", maximum=100
        )
        self.queue_progress.pack(fill="x", pady=(8, 4))
        self.queue_summary = ttk.Label(
            current, text="Waiting for queue data…", style="Subtitle.TLabel"
        )
        self.queue_summary.pack(anchor="w")

        table_frame = ttk.Frame(self.queue_page)
        table_frame.pack(fill="both", expand=True)
        columns = ("video", "status", "progress", "frames", "details")
        self.queue_tree = ttk.Treeview(
            table_frame, columns=columns, show="headings", height=16
        )
        for key, label, width in (
            ("video", "Video", 230),
            ("status", "Status", 130),
            ("progress", "Progress", 90),
            ("frames", "Frames read / total", 145),
            ("details", "Details", 330),
        ):
            self.queue_tree.heading(key, text=label)
            self.queue_tree.column(key, width=width, anchor="w")
        self.queue_tree.tag_configure("processing", foreground=COLORS["primary"])
        self.queue_tree.tag_configure("queued", foreground=COLORS["ink"])
        self.queue_tree.tag_configure("waiting", foreground=COLORS["muted"])
        self.queue_tree.tag_configure("cancelled", foreground=COLORS["muted"])
        self.queue_tree.tag_configure("failed", foreground=COLORS["red"])
        self.queue_tree.tag_configure("completed", foreground=COLORS["green"])
        scrollbar = ttk.Scrollbar(
            table_frame, orient="vertical", command=self.queue_tree.yview
        )
        self.queue_tree.configure(yscrollcommand=scrollbar.set)
        self.queue_tree.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

    def _build_setup(self) -> None:
        ttk.Label(
            self.setup,
            text="Configure your local ChickenSee system",
            font=("Segoe UI Semibold", 18),
        ).pack(anchor="w")
        ttk.Label(
            self.setup,
            text="Choose video folders, local storage, and optional cloud sync. Save before starting services.",
            style="Subtitle.TLabel",
        ).pack(anchor="w", pady=(4, 16))

        folder_frame = ttk.LabelFrame(self.setup, text="Video folders to watch", padding=12)
        folder_frame.pack(fill="x")
        self.directory_tree = ttk.Treeview(
            folder_frame,
            columns=("path",),
            show="headings",
            height=4,
            selectmode="extended",
        )
        self.directory_tree.heading("path", text="Folder path")
        self.directory_tree.column("path", anchor="w")
        self.directory_tree.pack(fill="x", expand=True)
        self.directory_tree.bind(
            "<<TreeviewSelect>>", self._update_remove_directory_button
        )
        folder_buttons = ttk.Frame(folder_frame)
        folder_buttons.pack(fill="x", pady=(8, 0))
        ttk.Button(folder_buttons, text="Add folder…", command=self.add_directory).pack(
            side="left"
        )
        self.remove_directory_button = ttk.Button(
            folder_buttons,
            text="Remove selected",
            command=self.remove_directories,
            state="disabled",
        )
        self.remove_directory_button.pack(side="left", padx=(8, 0))
        ttk.Label(
            folder_buttons,
            text="Add or remove folders to save changes immediately. Folder contents are never deleted.",
            style="Subtitle.TLabel",
        ).pack(side="left", padx=(12, 0))

        storage_frame = ttk.LabelFrame(self.setup, text="Local results and logs", padding=12)
        storage_frame.pack(fill="x", pady=(12, 0))
        self.storage_path = tk.StringVar()
        ttk.Entry(storage_frame, textvariable=self.storage_path).pack(
            side="left", fill="x", expand=True
        )
        ttk.Button(storage_frame, text="Browse…", command=self.choose_storage).pack(
            side="left", padx=(8, 0)
        )

        cloud_frame = ttk.LabelFrame(self.setup, text="Optional Vercel sync", padding=12)
        cloud_frame.pack(fill="x", pady=(12, 0))
        self.cloud_sync = tk.BooleanVar()
        ttk.Checkbutton(
            cloud_frame,
            text="Upload videos and analysis results to my Vercel portal",
            variable=self.cloud_sync,
        ).grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 8))
        ttk.Label(cloud_frame, text="Sync URL").grid(row=1, column=0, sticky="w", pady=4)
        self.sync_url = tk.StringVar()
        ttk.Entry(cloud_frame, textvariable=self.sync_url).grid(
            row=1, column=1, sticky="ew", padx=(12, 0), pady=4
        )
        ttk.Label(cloud_frame, text="Sync secret").grid(row=2, column=0, sticky="w", pady=4)
        self.sync_secret = tk.StringVar()
        ttk.Entry(cloud_frame, textvariable=self.sync_secret, show="•").grid(
            row=2, column=1, sticky="ew", padx=(12, 0), pady=4
        )
        cloud_frame.columnconfigure(1, weight=1)
        ttk.Label(
            cloud_frame,
            text="Cloud upload is off by default. The secret is saved in the ignored agent\\.env file.",
            style="Subtitle.TLabel",
        ).grid(row=3, column=0, columnspan=2, sticky="w", pady=(8, 0))

        buttons = ttk.Frame(self.setup)
        buttons.pack(fill="x", pady=(16, 0))
        ttk.Button(
            buttons,
            text="Save settings",
            style="Primary.TButton",
            command=self.save_settings,
        ).pack(side="left")
        ttk.Button(
            buttons,
            text="Initialize / repair",
            command=self.initialize_system,
        ).pack(side="left", padx=(8, 0))
        ttk.Button(
            buttons,
            text="Enable startup",
            command=self.install_startup,
        ).pack(side="right")
        ttk.Button(
            buttons,
            text="Remove startup",
            command=self.uninstall_startup,
        ).pack(side="right", padx=(0, 8))

    def _load_settings_into_form(self) -> None:
        for row in self.directory_tree.get_children():
            self.directory_tree.delete(row)
        for directory in self.settings["directories"]:
            self.directory_tree.insert("", "end", values=(directory,))
        self._update_remove_directory_button()
        self.storage_path.set(str(self.settings["storage_root"]))
        self.cloud_sync.set(bool(self.settings["cloud_sync"]))
        self.sync_url.set(str(self.settings["sync_url"]))
        self.sync_secret.set(str(self.settings["sync_secret"]))
        self._update_test_directory_options()

    def _get_form_settings(self) -> Dict[str, object]:
        directories = [
            self.directory_tree.item(row, "values")[0]
            for row in self.directory_tree.get_children()
        ]
        return {
            **self.settings,
            "directories": directories,
            "storage_root": self.storage_path.get().strip(),
            "cloud_sync": self.cloud_sync.get(),
            "sync_url": self.sync_url.get().strip(),
            "sync_secret": self.sync_secret.get(),
        }

    def _update_test_directory_options(self) -> None:
        directories = [
            self.directory_tree.item(row, "values")[0]
            for row in self.directory_tree.get_children()
        ]
        self.test_directory_combo["values"] = directories
        if directories and self.test_directory.get() not in directories:
            self.test_directory.set(directories[0])
        elif not directories:
            self.test_directory.set("")

    def add_directory(self) -> None:
        directory = filedialog.askdirectory(title="Choose a folder containing videos")
        if not directory:
            return
        existing = {
            self.directory_tree.item(row, "values")[0]
            for row in self.directory_tree.get_children()
        }
        resolved = str(Path(directory).resolve())
        if resolved in existing:
            messagebox.showinfo("Already added", "That folder is already in the watch list.")
            return
        row = self.directory_tree.insert("", "end", values=(resolved,))
        directories = [
            self.directory_tree.item(item, "values")[0]
            for item in self.directory_tree.get_children()
        ]
        try:
            write_watch_directories(directories)
        except (OSError, ValueError) as error:
            self.directory_tree.delete(row)
            self._update_test_directory_options()
            messagebox.showerror("Could not add watched folder", str(error))
            return
        self.settings["directories"] = directories
        self._update_test_directory_options()
        self._log("Added watched folder to saved settings. Restart ChickenSee services to apply the change to the folder watcher.")
        messagebox.showinfo(
            "Watched folder added",
            "The folder was added to saved settings. Its videos will be analyzed after "
            "ChickenSee services restart and the files are stable.",
        )

    def remove_directories(self) -> None:
        selected = self.directory_tree.selection()
        if not selected:
            messagebox.showinfo("Select a folder", "Choose one or more folders to remove.")
            return
        current_directories = [
            self.directory_tree.item(row, "values")[0]
            for row in self.directory_tree.get_children()
        ]
        remaining = [
            directory
            for row, directory in zip(
                self.directory_tree.get_children(), current_directories
            )
            if row not in selected
        ]
        if not remaining:
            messagebox.showerror(
                "Keep one watched folder",
                "ChickenSee needs at least one watched folder. Add another folder before removing this one.",
            )
            return
        for row in selected:
            self.directory_tree.delete(row)
        try:
            write_watch_directories(remaining)
        except (OSError, ValueError) as error:
            for row in self.directory_tree.get_children():
                self.directory_tree.delete(row)
            for directory in current_directories:
                self.directory_tree.insert("", "end", values=(directory,))
            self._update_remove_directory_button()
            messagebox.showerror("Could not remove watched folder", str(error))
            return
        self.settings["directories"] = remaining
        self._update_test_directory_options()
        self._update_remove_directory_button()
        self._log("Removed watched folder from saved settings. Restart ChickenSee services to apply the change to the folder watcher.")
        messagebox.showinfo(
            "Watched folder removed",
            "The folder was removed from saved settings. Its files were not deleted.\n\n"
            "Restart ChickenSee services to apply the change to the folder watcher.",
        )

    def _update_remove_directory_button(self, _event=None) -> None:
        if hasattr(self, "remove_directory_button"):
            state = "normal" if self.directory_tree.selection() else "disabled"
            self.remove_directory_button.configure(state=state)

    def choose_storage(self) -> None:
        directory = filedialog.askdirectory(
            title="Choose where ChickenSee saves results and logs",
            initialdir=self.storage_path.get() or str(DEFAULT_STORAGE_ROOT),
        )
        if directory:
            self.storage_path.set(directory)

    def save_settings(self) -> None:
        settings = self._get_form_settings()
        error = validate_agent_settings(settings)
        if error:
            messagebox.showerror("Check your setup", error)
            return
        try:
            write_agent_settings(settings)
        except (OSError, ValueError) as error:
            messagebox.showerror("Could not save settings", str(error))
            return
        self.settings = read_agent_settings()
        self._load_settings_into_form()
        self._log("Settings saved. Restart services to apply folder or sync changes.")
        messagebox.showinfo(
            "Settings saved",
            "Your settings are saved. Restart ChickenSee services to apply changes.",
        )
        self._refresh_status()

    def start_services(self) -> None:
        processes = find_service_processes()
        if processes["supervisor"]:
            self._refresh_status()
            return
        self.starting_services = True
        self._update_power_buttons(processes["supervisor"])
        self._log("Starting ChickenSee services…")
        threading.Thread(target=self._start_services_worker, daemon=True).start()

    def _start_services_worker(self) -> None:
        try:
            launch_log = (
                Path(str(self.settings["storage_root"])).expanduser()
                / "logs"
                / "startup-launch.log"
            )
            process = start_supervisor(
                PROJECT_ROOT, Path(str(self.settings["storage_root"]))
            )
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if find_service_processes()["supervisor"]:
                    self.events.put(
                        ("start_done", True, "ChickenSee services are starting.")
                    )
                    return
                exit_code = process.poll()
                if exit_code is not None and exit_code != 0:
                    break
                time.sleep(0.5)

            detail = ""
            if launch_log.is_file():
                detail = launch_log.read_text(encoding="utf-8", errors="replace")[-3000:]
            if process.poll() is None:
                detail = detail or "The supervisor did not become visible within 20 seconds."
            elif not detail:
                detail = f"The supervisor exited with code {process.returncode}."
            raise RuntimeError(
                f"ChickenSee did not start. Review {launch_log}.\n{detail}"
            )
        except (OSError, RuntimeError) as error:
            self.events.put(("start_done", False, str(error)))

    def stop_services(self) -> None:
        processes = find_service_processes()
        if not processes["supervisor"]:
            messagebox.showwarning(
                "Startup services are not running",
                "There are no ChickenSee startup services for the Stop button to stop.",
            )
            return
        if not messagebox.askyesno(
            "Stop ChickenSee?",
            "This will stop the folder watcher, analytics API, and video analyzer.",
        ):
            return
        self.stopping_services = True
        self._update_power_buttons(processes["supervisor"])
        targets = capture_service_processes()
        try:
            request_stop(
                Path(str(self.settings["storage_root"])).expanduser(),
                processes["supervisor"],
            )
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self.stopping_services = False
            self._update_power_buttons(processes["supervisor"])
            messagebox.showerror("Could not stop services", str(error))
            return
        self._log("Stop requested. Waiting for the supervisor to stop its services…")
        threading.Thread(
            target=self._stop_services_worker,
            args=(targets,),
            daemon=True,
        ).start()

    def _stop_services_worker(
        self, targets: Dict[str, List[Tuple[psutil.Process, float]]]
    ) -> None:
        try:
            used_fallback = stop_processes_after_signal(targets)
            message = (
                "The supervisor did not stop within 15 seconds; stopped the captured "
                "ChickenSee processes directly."
                if used_fallback
                else "ChickenSee stopped."
            )
            self.events.put(("stop_done", True, message))
        except (OSError, RuntimeError) as error:
            self.events.put(("stop_done", False, str(error)))

    def run_video_test(self) -> None:
        if not find_service_processes()["analytics-worker"]:
            messagebox.showerror(
                "Video analyzer is not running",
                "The analyzer starts automatically at Windows sign-in. Wait for it to appear as Running before testing a video.",
            )
            return
        target = self.test_directory.get()
        if not target or not Path(target).is_dir():
            messagebox.showerror("Choose a watch folder", "Add and select an existing watched folder first.")
            return
        source = filedialog.askopenfilename(
            title="Choose a short sample video",
            filetypes=[("MP4 videos", "*.mp4"), ("All files", "*.*")],
        )
        if not source:
            return
        try:
            destination_dir = Path(target).resolve()
            source_path = Path(source).resolve()
            if source_path.parent == destination_dir:
                messagebox.showinfo(
                    "Already in watch folder",
                    "This video is already in the selected watch folder. The worker will pick it up automatically.",
                )
                return
            destination = destination_dir / (
                f"chickensee-test-{datetime.now():%Y%m%d-%H%M%S-%f}{source_path.suffix.lower()}"
            )
            shutil.copy2(source_path, destination)
        except OSError as error:
            messagebox.showerror("Could not copy the test video", str(error))
            return
        self._log(f"Test video copied to {destination}. Analysis starts when the file is stable.")
        messagebox.showinfo(
            "Test video queued",
            "A copy of the video was placed in the watch folder.\n\n"
            "The worker will analyze it after the file stops changing. "
            "Check the current job and results folders on the Dashboard.",
        )

    def initialize_system(self) -> None:
        if not messagebox.askyesno(
            "Initialize ChickenSee",
            "This checks Python and Node.js dependencies and installs missing packages. "
            "An internet connection may be required.",
        ):
            return
        self._set_busy(True)
        self.events.put(("log", "Checking model and runtime dependencies…"))
        threading.Thread(target=self._initialize_worker, daemon=True).start()

    def _initialize_worker(self) -> None:
        try:
            python = sys.executable
            if not Path(python).exists():
                raise RuntimeError(f"Python executable not found: {python}")
            model = PROJECT_ROOT / "custom_poultry.pt"
            if not model.is_file():
                raise RuntimeError(f"Custom model weights are missing: {model}")

            import_check = [
                python,
                "-c",
                "import cv2, fastapi, psutil, sqlalchemy, ultralytics, uvicorn",
            ]
            if self._run_logged_command(import_check, PROJECT_ROOT) != 0:
                requirements = PROJECT_ROOT / "analytics" / "requirements.txt"
                self.events.put(("log", "Installing Python analytics dependencies…"))
                if self._run_logged_command(
                    [python, "-m", "pip", "install", "-r", str(requirements)],
                    PROJECT_ROOT,
                ) != 0:
                    raise RuntimeError("Python dependency installation failed. See the activity log.")

            npm = shutil.which("npm")
            if not npm:
                raise RuntimeError("Node.js / npm was not found. Install Node.js 18 or newer, then retry.")
            node_modules = AGENT_DIR / "node_modules"
            node = shutil.which("node")
            if not node:
                raise RuntimeError("Node.js was not found. Install Node.js 18 or newer, then retry.")
            node_check = subprocess.run(
                [
                    node,
                    "--input-type=module",
                    "-e",
                    "import('chokidar'); import('@vercel/blob')",
                ],
                cwd=AGENT_DIR,
                capture_output=True,
                text=True,
                timeout=30,
            )
            if not node_modules.is_dir() or node_check.returncode != 0:
                self.events.put(("log", "Installing sync-agent dependencies…"))
                if self._run_logged_command([npm, "ci"], AGENT_DIR) != 0:
                    raise RuntimeError("Sync-agent dependency installation failed. See the activity log.")

            self.events.put(("log", "ChickenSee initialization completed successfully."))
            self.events.put(("initialize_done", True, "Setup is ready. Save your settings, then start services."))
        except (OSError, RuntimeError) as error:
            self.events.put(("log", f"Initialization failed: {error}"))
            self.events.put(("initialize_done", False, str(error)))

    def _run_logged_command(self, command: List[str], working_dir: Path) -> int:
        self.events.put(("log", f"Running: {Path(command[0]).name} {' '.join(command[1:])}"))
        process = subprocess.Popen(
            command,
            cwd=working_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if process.stdout:
            for line in process.stdout:
                clean = line.rstrip()
                if clean:
                    self.events.put(("log", clean))
        return process.wait()

    def install_startup(self) -> None:
        settings = self._get_form_settings()
        error = validate_agent_settings(settings)
        if error:
            messagebox.showerror("Finish setup first", error)
            return
        try:
            write_agent_settings(settings)
        except (OSError, ValueError) as error:
            messagebox.showerror("Could not save settings", str(error))
            return
        self._run_installer("install-startup.ps1", "Startup and desktop shortcuts installed.")

    def uninstall_startup(self) -> None:
        self._run_installer("uninstall-startup.ps1", "Automatic startup removed.")

    def _run_installer(self, script: str, success_message: str) -> None:
        script_path = PROJECT_ROOT / "startup" / script
        try:
            process = subprocess.Popen(
                [
                    POWERSHELL,
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(script_path),
                ],
                cwd=PROJECT_ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except OSError as error:
            messagebox.showerror("Could not update startup", str(error))
            return
        self._set_busy(True)
        threading.Thread(
            target=self._read_process_output,
            args=(process, success_message),
            daemon=True,
        ).start()

    def _read_process_output(self, process: subprocess.Popen, success_message: str) -> None:
        if process.stdout:
            for line in process.stdout:
                clean = line.strip()
                if clean:
                    self.events.put(("log", clean))
        return_code = process.wait()
        self.events.put(("startup_done", return_code == 0, success_message))

    def open_logs(self) -> None:
        root = Path(str(self._get_form_settings()["storage_root"])).expanduser() / "logs"
        try:
            root.mkdir(parents=True, exist_ok=True)
            os.startfile(str(root))
        except OSError as error:
            messagebox.showerror("Could not open logs", str(error))

    def open_api_docs(self) -> None:
        webbrowser.open("http://127.0.0.1:8000/docs")

    def _refresh_status(self) -> None:
        if self.refresh_in_progress:
            self.refresh_pending = True
            self.queue_summary.configure(text="Refresh requested; updating after the current check…")
            return
        self.refresh_in_progress = True
        threading.Thread(target=self._status_worker, daemon=True).start()

    def _cancel_active_analysis(self) -> None:
        job_id = self.active_job_id
        if job_id is None or self.cancel_in_progress:
            return
        if not messagebox.askyesno(
            "Cancel analysis?",
            "Stop analyzing the current video? The original video will remain in its watch folder, "
            "but the incomplete detected video will be discarded.",
        ):
            return
        self.cancel_in_progress = True
        self.cancel_analysis_button.configure(state="disabled", text="Cancelling…")
        threading.Thread(
            target=self._cancel_analysis_worker,
            args=(job_id,),
            daemon=True,
        ).start()

    def _cancel_analysis_worker(self, job_id: int) -> None:
        request = urllib.request.Request(
            f"http://127.0.0.1:8000/jobs/{job_id}/cancel",
            data=b"",
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
            self.events.put(("cancel_done", True, payload.get("message", "Cancellation requested.")))
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read().decode("utf-8")).get("detail", str(error))
            except (json.JSONDecodeError, OSError):
                detail = str(error)
            self.events.put(("cancel_done", False, detail))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
            self.events.put(("cancel_done", False, f"Could not request cancellation: {error}"))

    def _status_worker(self) -> None:
        statuses = find_service_processes()
        health = None
        health_error = None
        queue_data = None
        queue_error = None
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=2) as response:
                health = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
            health_error = str(error)
        if health:
            try:
                with urllib.request.urlopen(QUEUE_URL, timeout=4) as response:
                    queue_data = json.loads(response.read().decode("utf-8"))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
                queue_error = str(error)
        else:
            queue_error = health_error or "Analytics API is unavailable."
        self.events.put(("status", statuses, health, health_error, queue_data, queue_error))

    def _schedule_refresh(self) -> None:
        self._refresh_status()
        self.root.after(REFRESH_INTERVAL_MS, self._schedule_refresh)

    def _drain_events(self) -> None:
        while True:
            try:
                event = self.events.get_nowait()
            except queue.Empty:
                break
            if event[0] == "log":
                self._log(event[1])
            elif event[0] == "status":
                self.refresh_in_progress = False
                self._display_status(event[1], event[2], event[3])
                self._display_queue(event[4], event[5])
                if self.refresh_pending:
                    self.refresh_pending = False
                    self.root.after(0, self._refresh_status)
            elif event[0] == "cancel_done":
                self.cancel_in_progress = False
                self.cancel_analysis_button.configure(text="Cancel analysis")
                if event[1]:
                    self._log(event[2])
                else:
                    messagebox.showerror("Could not cancel analysis", event[2])
                self._refresh_status()
            elif event[0] == "initialize_done":
                self._set_busy(False)
                if event[1]:
                    messagebox.showinfo("Initialization complete", event[2])
                else:
                    messagebox.showerror("Initialization failed", event[2])
            elif event[0] == "stop_done":
                self.stopping_services = False
                if event[1]:
                    self._log(event[2])
                else:
                    self._log(f"Stop failed: {event[2]}")
                    messagebox.showerror("Could not stop ChickenSee", event[2])
                self._refresh_status()
            elif event[0] == "start_done":
                self.starting_services = False
                if event[1]:
                    self._log(event[2])
                else:
                    self._log(f"Start failed: {event[2]}")
                    messagebox.showerror("Could not start ChickenSee", event[2])
                self._refresh_status()
            elif event[0] == "startup_done":
                self._set_busy(False)
                if event[1]:
                    messagebox.showinfo("Startup settings updated", event[2])
                else:
                    messagebox.showerror(
                        "Startup setup failed",
                        "The startup installer failed. See the activity log for details.",
                    )
        self.root.after(250, self._drain_events)

    def _display_status(self, statuses: Dict[str, List[int]], health, health_error) -> None:
        active = []
        for key, label in (
            ("sync-agent", "Folder watcher"),
            ("analytics-api", "Analytics API"),
            ("analytics-worker", "Video analyzer"),
        ):
            pids = statuses[key]
            label_text = f"Running · PID {pids[0]}" if pids else "Stopped"
            color = COLORS["green"] if pids else COLORS["red"]
            self.service_labels[key].configure(text=label_text, fg=color)
            if pids:
                active.append(label)

        if len(active) == 3:
            self.header_status.configure(
                text="All services running",
                bg="#e6f6ee",
                fg=COLORS["green"],
            )
        elif active:
            self.header_status.configure(
                text=f"{len(active)} of 3 services running",
                bg="#fff5df",
                fg="#9b6a06",
            )
        else:
            self.header_status.configure(
                text="Services stopped",
                bg="#fdecef",
                fg=COLORS["red"],
            )

        if health:
            job = health.get("system", {}).get("active_processing_job")
            self.job_label.configure(
                text=job or "Startup services are running; no video is being analyzed right now"
            )
            self.storage_label.configure(
                text=(
                    f"Completed: {health.get('storage', {}).get('completed_jobs', 0)}"
                    f"    Failed: {health.get('storage', {}).get('failed_jobs', 0)}"
                    f"    Results: {self.settings['storage_root']}"
                    f"    Cloud sync: {'On' if self.settings['cloud_sync'] else 'Off'}"
                )
            )
        else:
            self.job_label.configure(
                text="Analytics API is not responding" if health_error else "Waiting for API…"
            )
            self.storage_label.configure(
                text="Services start automatically after Windows sign-in."
            )

        self._update_power_buttons(statuses["supervisor"])

    def _update_power_buttons(self, supervisor_pids: List[int]) -> None:
        busy = self.starting_services or self.stopping_services
        if self.starting_services:
            self.start_button.configure(
                state="disabled", text="Starting ChickenSee…"
            )
        else:
            self.start_button.configure(
                state="disabled" if supervisor_pids or busy else "normal",
                text="▶  Start ChickenSee",
            )
        if self.stopping_services:
            self.stop_button.configure(
                state="disabled", text="Stopping ChickenSee…"
            )
        else:
            self.stop_button.configure(
                state="normal" if supervisor_pids and not busy else "disabled",
                text="⏻  Stop ChickenSee",
            )

    def _display_queue(self, queue_data, queue_error) -> None:
        for item_id in self.queue_tree.get_children():
            self.queue_tree.delete(item_id)
        if not queue_data:
            self.queue_active_label.configure(text="Queue unavailable")
            self.queue_progress.configure(value=0)
            self.queue_summary.configure(
                text=f"Could not load the detection queue: {queue_error or 'No queue data returned.'}"
            )
            return

        items = queue_data.get("items", [])
        active = next(
            (item for item in items if item.get("status") == "PROCESSING"), None
        )
        if active:
            self.active_job_id = active.get("job_id")
            percentage = active.get("progress_percent")
            progress_text = format_queue_progress("PROCESSING", percentage)
            self.queue_active_label.configure(
                text=f"{active.get('video_filename', 'Video')}  ·  {progress_text}"
            )
            self.queue_progress.configure(value=percentage or 0)
            self.cancel_analysis_button.configure(
                state="disabled" if self.cancel_in_progress else "normal",
                text="Cancelling…" if self.cancel_in_progress else "Cancel analysis",
            )
        else:
            self.active_job_id = None
            self.queue_active_label.configure(text="No active analysis")
            self.queue_progress.configure(value=0)
            self.cancel_analysis_button.configure(state="disabled", text="Cancel analysis")

        summary = queue_data.get("summary", {})
        directory_count = len(queue_data.get("watch_directories", []))
        refresh_time = datetime.now().strftime("%H:%M:%S")
        self.queue_summary.configure(
            text=(
                f"{summary.get('processing', 0)} processing  ·  "
                f"{summary.get('queued', 0)} queued  ·  "
                f"{summary.get('waiting', 0)} waiting for stable files  ·  "
                f"{summary.get('completed', 0)} completed  ·  "
                f"{summary.get('failed', 0)} failed  ·  "
                f"{summary.get('cancelled', 0)} cancelled  ·  "
                f"Watching {directory_count} folders  ·  Updated {refresh_time}"
            )
        )
        missing_directories = queue_data.get("missing_watch_directories", [])
        if missing_directories:
            self.queue_summary.configure(
                text=(
                    f"{self.queue_summary.cget('text')}  ·  Missing folders: "
                    + ", ".join(missing_directories)
                )
            )
        for warning in queue_data.get("warnings", []):
            self.queue_summary.configure(text=f"{self.queue_summary.cget('text')}  ·  {warning}")

        for item in items:
            status = item.get("status", "UNKNOWN")
            progress = format_queue_progress(status, item.get("progress_percent"))
            frames = "—"
            if item.get("progress_frames") is not None and item.get("total_frames"):
                frames = f"{item['progress_frames']} / {item['total_frames']}"
            details = item.get("details") or item.get("video_path") or ""
            self.queue_tree.insert(
                "",
                "end",
                iid=item["item_id"],
                values=(
                    item.get("video_filename", ""),
                    status.replace("_", " ").title(),
                    progress,
                    frames,
                    details,
                ),
                tags=(status.lower(),),
            )

    def _set_busy(self, busy: bool) -> None:
        state = "disabled" if busy else "normal"
        for widget in self.setup.winfo_children():
            self._set_widget_state(widget, state)

    def _set_widget_state(self, widget, state: str) -> None:
        try:
            if isinstance(widget, (ttk.Button, ttk.Entry, ttk.Checkbutton, ttk.Combobox)):
                widget.configure(state=state)
        except tk.TclError:
            pass
        for child in widget.winfo_children():
            self._set_widget_state(child, state)

    def _log(self, message: str) -> None:
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.activity.configure(state="normal")
        self.activity.insert("end", f"[{timestamp}] {message}\n")
        self.activity.see("end")
        self.activity.configure(state="disabled")


def main() -> None:
    root = tk.Tk()
    try:
        ChickenSeeDesktop(root)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        root.withdraw()
        messagebox.showerror("ChickenSee setup could not be loaded", str(error))
        root.destroy()
        return
    root.mainloop()


if __name__ == "__main__":
    main()
