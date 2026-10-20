# ChickenSee: Optiplex-to-Vercel Video & SQLite Sync Portal

A production-ready bridge connecting an on-premise local server (Dell Optiplex) with a Vercel-hosted Next.js web application.

```
┌────────────────────────────────┐                 ┌────────────────────────────────┐
│   Local Server (Optiplex)      │                 │         Vercel Cloud           │
│                                │                 │                                │
│  ./data/ (chokidar watcher)    │                 │  /api/sync (x-sync-secret)     │
│   ├── video_2026.mp4 ──────────┼──HTTP Stream───>│      │                         │
│   └── telemetry.sqlite ────────┼──(Fetch Chunk)─>│      ▼                         │
│                                │                 │  Vercel Blob Storage           │
│  State file: .sync-state.json  │                 │   ├── videos/*.mp4             │
│                                │                 │   └── databases/*.sqlite       │
└────────────────────────────────┘                 │      │                         │
                                                   │      ▼                         │
                                                   │  Next.js 14 Dashboard UI       │
                                                   │   ├── Video Player List        │
                                                   │   └── SQLite WASM Table Viewer │
                                                   └────────────────────────────────┘
```

---

## 📁 Repository Structure

```
.
├── agent/                         # Optiplex Local Watcher Client
│   ├── data/                      # Local drop folder for .mp4, .sqlite, .db
│   ├── watcher.js                 # Chokidar watcher with stream upload & retry
│   ├── package.json               # Agent dependencies (chokidar, dotenv)
│   └── .env.example               # Agent environment template
├── startup/                       # Windows all-in-one startup supervisor
│   ├── chickensee_desktop.py      # Tkinter Control Center
│   ├── configuration.py           # Desktop setup and local settings
│   ├── run-chickensee.ps1         # Starts and restarts watcher, API, and worker
│   ├── start-chickensee.bat       # Windows sign-in startup launcher
│   ├── install-startup.ps1        # Adds desktop and sign-in shortcuts
│   └── uninstall-startup.ps1      # Removes automatic startup
├── app/                            # Next.js 14 App Router
│   ├── api/
│   │   ├── auth/route.ts          # 1-User login and session management
│   │   ├── sync/route.ts          # Authenticated Vercel Blob stream uploader
│   │   ├── videos/route.ts        # MP4 Blob metadata lister
│   │   └── database/route.ts      # SQLite WebAssembly query executor (sql.js)
│   ├── login/page.tsx             # Protected password login screen
│   ├── page.tsx                   # Light orange-accent portal with behavior/environment reports
│   ├── layout.tsx                 # Root layout & styling
│   └── globals.css                # Tailwind CSS & portal theme
├── lib/
│   ├── auth.ts                    # Password verification & session tokens
│   ├── blob.ts                    # Vercel Blob SDK wrappers
│   └── db-viewer.ts               # sql.js WebAssembly reader (serverless-safe)
├── middleware.ts                  # Route protection guard
├── tailwind.config.ts             # Tailwind CSS tokens
├── next.config.mjs                # Next.js & WebAssembly build config
└── package.json                   # Web portal dependencies
```

---

## 🚀 Quick Start & Deployment Guide

### 1. Deploy the Frontend / API to Vercel

1. Push this repository to GitHub or run `vercel` CLI:
   ```bash
   vercel
   ```
2. In the Vercel Dashboard for your project:
   - Navigate to **Storage** tab > Click **Create Database** > Select **Blob**.
   - Connect the Blob Store to your project (this automatically exposes `BLOB_READ_WRITE_TOKEN`).
3. Add the following **Environment Variables** in Vercel Project Settings:
   - `SYNC_SECRET`: A high-entropy random string (e.g. `openssl rand -hex 32`)
   - `DASHBOARD_PASSWORD`: The single-user access password for viewing your dashboard.
   - `JWT_SECRET`: A 32-byte string for session cookies.

---


### 2. Install the ChickenSee Control Center on Windows

On the OptiPlex, install the Python analytics and Node sync-agent dependencies:
```powershell
python -m pip install -r analytics\requirements.txt
Push-Location agent
npm ci
Pop-Location
```

Launch the desktop app:
```powershell
python startup\chickensee_desktop.py
```

Use the **Setup** tab to select video folders, choose local output storage, and optionally configure Vercel sync. **Initialize / repair** checks the model and fills in missing Python or Node packages. Use **Start ChickenSee** and **Stop ChickenSee** on the Dashboard to control services, use **Quick video test** to copy a sample MP4 into a watched folder, and select **Enable startup** to create the desktop shortcut and start services at Windows sign-in.

Cloud sync is off by default. Turn it on only after entering the deployed `/api/sync` URL and matching `SYNC_SECRET`. The API runs locally at `http://localhost:8000/docs`.

See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for full Windows setup, test, and troubleshooting instructions.

---

## 🔒 Security & Architecture Highlights

1. **Memory-Efficient Streaming:**
   The Optiplex watcher utilizes Node.js streams (`fs.createReadStream`) with HTTP chunked transfer directly into Vercel Blob (`put(pathname, req.body)`). Files of any size (even multi-gigabyte `.mp4` recordings) are streamed without buffering entire payloads into RAM.

2. **Serverless SQLite Inspection via WebAssembly:**
   Traditional native bindings like `better-sqlite3` fail or require custom build steps on AWS Lambda/Vercel serverless environments. This application utilizes **`sql.js` (WebAssembly)**, downloading the database buffer on demand from Vercel Blob and executing read queries in pure WebAssembly.

3. **Protection Against Partial Writes:**
   `chokidar`'s `awaitWriteFinish` option ensures that video or database files actively being written by cameras or capture scripts are not uploaded prematurely until write locks have released.

4. **Multi-Directory Watcher:**
   The agent reads watched folder paths from `agent/directories.json` (configured in the Control Center Setup tab), allowing it to monitor multiple separate folders simultaneously — useful when your recorder saves videos and databases in different locations.

---

## 🐔 Edge AI Computer Vision & Behavior Telemetry Pipeline

The edge processing hub running on the Dell OptiPlex server includes a high-performance computer vision, tracking, behavior classification, and sensor synchronization pipeline located in the `edge/` directory.

### Key Components:
- **`edge/detector.py`**: Optimizes YOLO26n (`custom_poultry.pt`) CPU inference using PyTorch multi-threading and ByteTrack association (`bytetrack_poultry.yaml`). Differentiates Roosters (strictly red) from Hens, and performs Hens Re-ID via Leg Band detection with HSV feet-crop fallback. Includes LRU track memory pruning to eliminate memory leaks during 12-hour continuous shifts.
- **`edge/behavior.py`**: Real-time behavior classification (Feeding, Drinking, Resting/Inactive, Walking/Active, Agitation) based on spatial proximity to feeders/drinkers and kinematic motion velocity. Maintains individual bird activity budgets and health flags (e.g. lethargy alert).
- **`edge/sensors.py`**: Environmental and physical sensor hub (Temperature, Humidity, Ammonia NH3 ppm, Lux, THI heat stress index, feeder load cell, water flow). Features a thread-safe ring buffer with nearest-neighbor temporal synchronization to pair sensor metrics with vision frames.
- **`edge/aggregator.py`**: Enforces strict **06:00:00 to 18:00:00 daily operational window**. Aggregates detection counts, flock mobility, behavior time-budgets, and environmental averages, flushing to local SQLite (`agent/data/chicken_telemetry.db`), CSV, and JSON every hour on the hour.
- **`edge/pipeline.py`**: Master orchestrator with video stream watchdog, auto-reconnect backoff, and periodic garbage collection.

### Quick Start Commands:

```powershell
# 1. Run the test verification suite:
python edge/test_pipeline.py

# 2. Run the pipeline interactively with live display:
python -m edge.pipeline --view --force-start

# 3. Run in headless server mode on Dell OptiPlex:
python -m edge.pipeline

# 4. Install as persistent Windows Service (auto-start on boot):
powershell -ExecutionPolicy Bypass -File edge/service/install-service-windows.ps1
```
