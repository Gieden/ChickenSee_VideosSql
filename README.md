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
├── app/                           # Next.js 14 App Router
│   ├── api/
│   │   ├── auth/route.ts          # 1-User login and session management
│   │   ├── sync/route.ts          # Authenticated Vercel Blob stream uploader
│   │   ├── videos/route.ts        # MP4 Blob metadata lister
│   │   └── database/route.ts      # SQLite WebAssembly query executor (sql.js)
│   ├── login/page.tsx             # Protected password login screen
│   ├── page.tsx                   # Dark-mode dashboard (Videos + SQLite Tables)
│   ├── layout.tsx                 # Root layout & styling
│   └── globals.css                # Tailwind CSS & custom dark scrollbars
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


### 2. Configure & Run the Local Agent (Optiplex Server)

Open **PowerShell** or **Command Prompt** (NOT the code blocks below — type each line one at a time):

**Navigate to the agent folder:**
```powershell
cd agent
```

**Install dependencies:**
```powershell
npm install
```

**Run the interactive setup tool** (configure directories & connection settings):
```powershell
npm run setup
```

The setup menu will appear. Use it to:
- **Option 3** — Enter your Vercel Sync URL: `https://your-app.vercel.app/api/sync`
- **Option 4** — Enter your Sync Secret (must match `SYNC_SECRET` in Vercel)
- **Option 1** — Add the folder paths where your `.mp4` and `.sqlite` files are stored
- **Option 5** — Save and exit

> 📖 See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for a full step-by-step walkthrough with screenshots.

**Start the watcher:**
```powershell
npm start
```

**Run in the background permanently (recommended):**
```powershell
npm install -g pm2
pm2 start watcher.js --name "chickensee-agent"
pm2 save
pm2 startup
```

---

## 🔒 Security & Architecture Highlights

1. **Memory-Efficient Streaming:**
   The Optiplex watcher utilizes Node.js streams (`fs.createReadStream`) with HTTP chunked transfer directly into Vercel Blob (`put(pathname, req.body)`). Files of any size (even multi-gigabyte `.mp4` recordings) are streamed without buffering entire payloads into RAM.

2. **Serverless SQLite Inspection via WebAssembly:**
   Traditional native bindings like `better-sqlite3` fail or require custom build steps on AWS Lambda/Vercel serverless environments. This application utilizes **`sql.js` (WebAssembly)**, downloading the database buffer on demand from Vercel Blob and executing read queries in pure WebAssembly.

3. **Protection Against Partial Writes:**
   `chokidar`'s `awaitWriteFinish` option ensures that video or database files actively being written by cameras or capture scripts are not uploaded prematurely until write locks have released.

4. **Multi-Directory Watcher:**
   The agent reads watched folder paths from `agent/directories.json` (configured via `npm run setup`), allowing it to monitor multiple separate folders simultaneously — useful when your startup application saves videos and databases in different locations.

