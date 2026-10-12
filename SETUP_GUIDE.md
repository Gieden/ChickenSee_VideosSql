# 🚀 ChickenSee Portal — Local Agent Setup & Testing Guide

This guide walks you through running the **local Optiplex watcher agent** to sync video and SQLite files to your live Vercel dashboard.

---

## Prerequisites

- Node.js 18+ installed on your local machine / Optiplex server
- Your Vercel app is already deployed and live
- You know your Vercel app URL (e.g. `https://chicken-see-videos-sql.vercel.app`)

---

## Step 1 — Navigate to the Agent Folder

Open a terminal (PowerShell or Command Prompt) and go to the `agent` folder:

```powershell
cd "C:\Users\Kairi\Documents\ChickenSee_Videos(sql)\agent"
```

---

## Step 2 — Create the Environment Config File

Copy the example config and open it for editing:

```powershell
copy .env.example .env
notepad .env
```

Fill in your values:

```env
VERCEL_SYNC_URL="https://YOUR-APP-NAME.vercel.app/api/sync"
SYNC_SECRET="optiplex-sync-secret-2026"
WATCH_DIR="./data"
POLL_INTERVAL_MS=500
STABILITY_THRESHOLD_MS=2500
MAX_RETRIES=3
```

> ⚠️ **Important:** The `SYNC_SECRET` value here must **exactly match** the `SYNC_SECRET` environment variable you set in your Vercel project settings.

---

## Step 3 — Install Dependencies

```powershell
npm install
```

---

## Step 4 — Start the Watcher

```powershell
npm start
```

You should see output like this:

```
[2026-10-12T...] [START] ChickenSee Sync Agent started.
[2026-10-12T...] [START] Watching directory: C:\...\agent\data
[2026-10-12T...] [START] Sync target: https://your-app.vercel.app/api/sync
```

The watcher is now **running in the background** monitoring the `agent/data/` folder.

---

## Step 5 — Drop a File to Test

While the watcher is running, copy any `.mp4`, `.sqlite`, or `.db` file into the `agent/data/` folder:

```powershell
# Example: copy a video file
copy "C:\path\to\your\video.mp4" ".\data\test_video.mp4"

# Example: copy a SQLite database
copy "C:\path\to\your\database.sqlite" ".\data\test_db.sqlite"
```

The terminal will immediately respond:

```
[DETECT] New file detected and ready: test_video.mp4
[Attempt 1/3] Initiating upload for "test_video.mp4" (25.4 MB)...
[SUCCESS] Successfully synced "test_video.mp4" -> Vercel Blob: https://...blob.vercel-storage.com/videos/test_video.mp4
```

---

## Step 6 — View on the Dashboard

1. Open your Vercel app URL in a browser
2. Log in with your `DASHBOARD_PASSWORD`
3. The **Videos** tab will show your uploaded MP4 files with a built-in streaming player
4. The **SQLite Tables** tab will show your database tables with paginated rows

---

## Running the Agent Permanently (Background Service)

To keep the watcher running even after closing the terminal, use **PM2**:

```powershell
# Install PM2 globally
npm install -g pm2

# Start the agent as a background service
pm2 start watcher.js --name "chickensee-agent"

# Save the process list so it auto-starts on reboot
pm2 save
pm2 startup
```

To check logs at any time:
```powershell
pm2 logs chickensee-agent
```

To stop the agent:
```powershell
pm2 stop chickensee-agent
```

---

## Troubleshooting

| Problem | Likely Cause | Fix |
|---|---|---|
| `401 Unauthorized` in terminal | SYNC_SECRET mismatch | Make sure `SYNC_SECRET` in `agent/.env` matches Vercel env vars exactly |
| `fetch failed` / network error | Wrong Vercel URL | Double-check `VERCEL_SYNC_URL` in `agent/.env` |
| File not detected | File type not supported | Only `.mp4`, `.sqlite`, `.db` are watched |
| File uploaded but not in dashboard | Vercel Blob not attached | Attach Blob storage in Vercel project → Storage tab |
| Video shows but won't play | Blob Access set to Private | Re-create Blob store with **Public** access |
