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
| `401 Unauthorized` in terminal | SYNC_SECRET mismatch | Re-run `npm run setup` → option 4 and match the Vercel env var exactly |
| `fetch failed` / network error | Wrong Vercel URL | Re-run `npm run setup` → option 3 and double-check your URL |
| File not detected | File type not supported | Only `.mp4`, `.sqlite`, `.db` files are watched |
| Folder not being watched | Path not configured | Re-run `npm run setup` → option 1 and add the correct path |
| File uploaded but not in dashboard | Vercel Blob not attached | Attach Blob storage in Vercel project → Storage tab |
| Video shows but won't play | Blob Access set to Private | Re-create Blob store with **Public** access |
