# ChickenSee Control Center — OptiPlex Setup Guide

ChickenSee Control Center is a Windows desktop app for setting up and running the local video watcher, analytics API, and video-analysis worker. It can also start those services automatically when your Windows account signs in.

## Requirements

- Windows 10/11
- Python 3.10+ added to `PATH`, including the `pythonw.exe` windowed launcher
- Node.js 18+ added to `PATH`
- The `custom_poultry.pt` weights file in the project root
- Internet access during dependency installation and, optionally, cloud sync

## 1. Install and initialize

Open PowerShell in the project root:

```powershell
python -m pip install -r analytics\requirements.txt
Push-Location agent
npm ci
Pop-Location
```

Start the desktop app:

```powershell
python startup\chickensee_desktop.py
```

The Setup tab also has an **Initialize / repair** button that verifies the model and installs missing Python or agent packages.

## 2. Complete Setup

In the app’s **Setup** tab:

1. Add every existing folder where your recorder saves videos. Adding or removing a folder saves the watch list immediately; restart ChickenSee services to apply folder changes. The queue reads the saved folders and refreshes every couple of seconds.
2. Choose a local storage folder for analysis reports, annotated detection videos, and service logs. Default: `C:\ChickenSee_Local_Storage`.
3. Leave cloud sync off for local-only operation. To upload to Vercel, enable cloud sync and enter the Vercel `/api/sync` URL and the exact `SYNC_SECRET` value configured for that deployment.
4. Select **Save settings** after changing local storage or cloud-sync settings. The sync secret is stored in `agent\.env`, which is ignored by Git.
5. Select **Initialize / repair** if you have not initialized the dependencies yet.

Cloud sync is opt-in and off by default. Enabling it requires a valid HTTPS URL and secret.

## 3. Test Video Analysis

After Windows sign-in, open the **ChickenSee Control Center** desktop shortcut. Its Dashboard displays the status of the startup-managed services. Use **Start ChickenSee** or **Stop ChickenSee** to start or stop the watcher, analytics API, and video analyzer without closing the Control Center.

1. Under **Quick video test**, select one of your configured watch folders, then choose a short MP4 sample.
2. ChickenSee copies the sample into the selected folder; the source video is left unchanged.
3. Wait until the copied video has stopped changing for about 20 seconds. The worker then analyzes it. Longer recordings take longer.
4. The **Queue** tab shows videos being processed, stable videos waiting in oldest-first order, and recent completed, failed, or cancelled jobs. Use **Cancel analysis** to stop the current video; the original stays in its watch folder and the incomplete detected output is discarded. The active percentage is calculated from video frames actually read; files waiting to become stable do not get a made-up percentage.
5. The Dashboard shows service state. Check the configured local storage folder for `results` (JSON reports), `videos` (annotated MP4s), and `logs`. The original video stays in its watched folder; ChickenSee does not create a second local archive copy.
6. If cloud sync is enabled, only the completed `_detected.mp4` and analysis JSON are uploaded. Verify the upload messages in the watcher logs and the Results/Videos tabs in your portal.

The local API is available at `http://localhost:8000/docs`; `/health`, `/jobs`, and `/queue` show health, job state, and the detection queue.

## 4. Enable Automatic Startup

Select **Enable startup** in the Setup tab. The installer:

- Adds a **ChickenSee Control Center** shortcut to the Windows desktop.
- Adds a background service launcher to the current user's Startup folder.
- Starts the watcher, analytics API, and worker after that user signs in.
- Restarts a service if it exits unexpectedly.

Sign out and back in (or restart Windows and sign in) to check automatic startup. This runs after sign-in, not at the Windows login screen. Open the Control Center desktop shortcut to see service status, stop the supervised services, test a video, view logs, or change setup.

Select **Remove startup** to disable automatic service startup. It leaves the desktop app shortcut in place and does not immediately stop services that are already running. Use **Stop ChickenSee** to stop services and **Start ChickenSee** to start them again manually.

## Configuration files and logs

- `agent\directories.json` — video watch folders.
- `agent\.env` — local storage, cloud sync URL and secret, and sync options.
- `<local storage>\results` — analysis JSON files.
- `<local storage>\videos` — completed annotated `_detected.mp4` outputs only.
- `<local storage>\logs` — worker, API, watcher, and startup supervisor logs.

## Troubleshooting

| Problem | What to check |
|---|---|
| A service shows Stopped | Open **Open logs** in the Dashboard and check the service's error log. Use **Initialize / repair** if packages are missing. |
| No video is discovered | Confirm the exact folder is listed in Setup and the MP4 copy has stopped changing for at least 20 seconds. |
| Startup shortcut does not work | Confirm Python and Node.js are on `PATH`, `pythonw.exe` is next to `python.exe`, and the project folder has not moved since startup was installed. Run **Enable startup** again after moving the project. |
| Portal uploads fail | Confirm cloud sync is enabled and the Vercel URL and `SYNC_SECRET` match. Local reports remain available even when cloud uploads are off. |
| Port 8000 is already in use | Another analytics API may be running. Stop the duplicate service before starting ChickenSee. |
