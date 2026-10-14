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

> 💡 Change this path to wherever you cloned/downloaded this project.

---

## Step 2 — Install Dependencies

```powershell
npm install
```

---

## Step 3 — Run the Interactive Setup (Configure Directories)

Instead of manually editing config files, run the built-in setup tool:

```powershell
npm run setup
```

You will see an interactive menu like this:

```
╔══════════════════════════════════════════════════════╗
║       ChickenSee Agent — Directory Configurator       ║
╚══════════════════════════════════════════════════════╝

  Vercel Sync URL : (not set)
  Sync Secret     : (not set)

  Watched Directories: (none configured)

  [1] Add a directory to watch
  [2] Remove a directory
  [3] Set Vercel Sync URL
  [4] Set Sync Secret
  [5] Save & Exit
```

### What to configure:

| Option | What to enter |
|---|---|
| **[3] Set Vercel Sync URL** | `https://YOUR-APP-NAME.vercel.app/api/sync` |
| **[4] Set Sync Secret** | The same `SYNC_SECRET` value you set in Vercel env vars |
| **[1] Add a directory to watch** | Full path to any folder containing your `.mp4` or `.sqlite` files |

### Example — adding your separate startup app's data folders:

Press `1` and enter your folder path when prompted:
```
C:\ChickenSee\Recordings
```
Press `1` again to add more folders (you can add as many as you like):
```
D:\Camera\Videos
C:\Users\Kairi\AppData\Local\ChickenApp\data
```

When done, press **`5`** to save and exit. Your settings are saved to:
- `agent/.env` — connection settings (URL + secret)
- `agent/directories.json` — list of all watched folders

> ⚠️ **Important:** The `SYNC_SECRET` must **exactly match** the `SYNC_SECRET` you set in your Vercel project environment variables.

---

## Step 4 — Start the Watcher

```powershell
npm start
```

You should see all your configured directories listed:

```
[START] ══════════════════════════════════════════════════
[START]   ChickenSee Sync Agent
[START] ══════════════════════════════════════════════════
[START] Sync target : https://your-app.vercel.app/api/sync
[START] Directories : 3 configured
[START]   → C:\ChickenSee\Recordings
[START]   → D:\Camera\Videos
[START]   → C:\Users\Kairi\AppData\Local\ChickenApp\data
[START] ══════════════════════════════════════════════════
```

The agent is now watching **all your configured folders simultaneously**.

---

## Step 5 — Test It

The agent auto-detects any `.mp4`, `.sqlite`, or `.db` file dropped into any of your watched folders. You can test by copying a file:

```powershell
# Copy a test video into any watched folder
copy "C:\path\to\any\video.mp4" "C:\ChickenSee\Recordings\test_video.mp4"
```

The terminal will immediately respond:

```
[DETECT] New file ready: test_video.mp4  (C:\ChickenSee\Recordings)
[Attempt 1/3] Uploading "test_video.mp4" (25.4 MB)...
[SUCCESS] Synced "test_video.mp4" → https://...blob.vercel-storage.com/videos/test_video.mp4
```

---

## Step 6 — View on the Dashboard

1. Open your Vercel app URL in a browser
2. Log in with your `DASHBOARD_PASSWORD`
3. The **Videos** tab shows your uploaded MP4 files with a built-in streaming player
4. The **SQLite Tables** tab shows your database tables with paginated rows

---

## Updating Directories Later

To add or remove watched folders at any time, just re-run the setup:

```powershell
npm run setup
```

Changes take effect the **next time you start** the watcher (`npm start`).

---

## Running the Agent Permanently (Auto-Start on Boot)

### Option A: Windows Auto-Start on Boot (Recommended for Windows)

The agent includes a built-in silent Windows startup installer. This configures the agent to automatically run in the background every time your PC turns on or you log in, without keeping an open terminal window on your screen:

```powershell
# From the agent folder:
npm run startup:install
```

You'll see:
```text
==========================================================
 [SUCCESS] ChickenSee Agent registered for Auto-Start!
==========================================================
Shortcut created at:
  C:\Users\...\Startup\ChickenSeeAgent.lnk
```

To remove or disable auto-start at any time:
```powershell
npm run startup:uninstall
```

---

### Option B: Background Service via PM2

Alternatively, you can manage the process using **PM2**:

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
| `401 Unauthorized` in terminal | SYNC_SECRET mismatch | Re-run `npm run setup` → option 4 and match the Vercel env var exactly |
| `fetch failed` / network error | Wrong Vercel URL | Re-run `npm run setup` → option 3 and double-check your URL |
| File not detected | File type not supported | Only `.mp4`, `.sqlite`, `.db` files are watched |
| Folder not being watched | Path not configured | Re-run `npm run setup` → option 1 and add the correct path |
| File uploaded but not in dashboard | Vercel Blob not attached | Attach Blob storage in Vercel project → Storage tab |
| Video shows but won't play | Blob Access set to Private | Re-create Blob store with **Public** access |

---

## 7-Day Automated Video Retention Policy

To keep your cloud storage within free tier limits, an automated **7-day retention policy** is now active:

* **Daily Automated Cron (`03:00 UTC`)**: Vercel automatically runs `/api/cron/cleanup?days=7` every day. Any `.mp4` video older than 7 days is deleted from Vercel Blob.
* **Telemetry & Analytics are Permanent**: SQLite databases (`chicken_telemetry.db`), numerical behavior rows, and sensor metrics are **never deleted**. Only the heavy video files are pruned after 7 days.
* **Manual One-Click Cleanup**: You can click the **Clean >7d** button in the dashboard header at any time to run the cleanup immediately.

