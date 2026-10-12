import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const SYNC_URL = process.env.VERCEL_SYNC_URL;
const SYNC_SECRET = process.env.SYNC_SECRET;
const STABILITY_THRESHOLD = parseInt(process.env.STABILITY_THRESHOLD_MS || '2500', 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '500', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const STATE_FILE = path.resolve('./.sync-state.json');
const CONFIG_FILE = path.resolve('./directories.json');

// ─── Resolve watch directories ────────────────────────────────────────────────
// Priority: directories.json > WATCH_DIRS env (comma-separated) > WATCH_DIR > ./data
function resolveWatchDirs() {
  const dirs = new Set();

  // 1. Read from directories.json (set via `npm run setup`)
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      if (Array.isArray(config.directories)) {
        config.directories.forEach((d) => dirs.add(path.resolve(d)));
      }
    } catch (err) {
      console.warn('[WARN] Could not parse directories.json:', err.message);
    }
  }

  // 2. WATCH_DIRS env var (comma-separated list)
  if (process.env.WATCH_DIRS) {
    process.env.WATCH_DIRS.split(',')
      .map((d) => d.trim())
      .filter(Boolean)
      .forEach((d) => dirs.add(path.resolve(d)));
  }

  // 3. Fallback single WATCH_DIR env var or ./data
  if (dirs.size === 0) {
    dirs.add(path.resolve(process.env.WATCH_DIR || './data'));
  }

  return [...dirs];
}

const WATCH_DIRS = resolveWatchDirs();

// Ensure all watch directories exist
for (const dir of WATCH_DIRS) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[INIT] Created missing watch directory: ${dir}`);
  }
}

// ─── Persistent sync state ────────────────────────────────────────────────────
let syncState = {};
try {
  if (fs.existsSync(STATE_FILE)) {
    syncState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  }
} catch {
  console.warn('[WARN] Failed to load sync state, starting fresh.');
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(syncState, null, 2));
  } catch (err) {
    console.error('[ERROR] Failed to persist sync state:', err.message);
  }
}

// ─── Logging ──────────────────────────────────────────────────────────────────
function log(level, message, meta = '') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message} ${meta}`.trim());
}

// ─── Upload logic ─────────────────────────────────────────────────────────────
async function uploadFileWithRetry(filePath, attempt = 1) {
  const filename = path.basename(filePath);
  const stats = fs.statSync(filePath);
  const ext = path.extname(filename).toLowerCase();

  const mimeType = ext === '.mp4'
    ? 'video/mp4'
    : 'application/x-sqlite3';

  log('INFO', `[Attempt ${attempt}/${MAX_RETRIES}] Uploading "${filename}" (${(stats.size / 1024 / 1024).toFixed(2)} MB)...`);

  const fileStream = fs.createReadStream(filePath);

  try {
    const response = await fetch(SYNC_URL, {
      method: 'POST',
      headers: {
        'x-sync-secret': SYNC_SECRET,
        'x-filename': encodeURIComponent(filename),
        'content-type': mimeType,
        'content-length': stats.size.toString(),
      },
      body: fileStream,
      duplex: 'half',
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const result = await response.json();
    log('SUCCESS', `Synced "${filename}" →`, result.url || result.pathname);

    syncState[filename] = {
      size: stats.size,
      mtime: stats.mtimeMs,
      uploadedAt: new Date().toISOString(),
      url: result.url,
    };
    saveState();
  } catch (error) {
    log('ERROR', `Upload failed for "${filename}": ${error.message}`);
    if (attempt < MAX_RETRIES) {
      const delayMs = Math.pow(2, attempt) * 1000;
      log('INFO', `Retrying in ${delayMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
      return uploadFileWithRetry(filePath, attempt + 1);
    } else {
      log('ERROR', `Max retries exceeded for "${filename}". Will retry on next file change.`);
    }
  }
}

function shouldSync(filePath) {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();

  if (!['.mp4', '.sqlite', '.db'].includes(ext)) return false;
  if (filename.startsWith('.') || filename.endsWith('.tmp') || filename.endsWith('.part')) return false;

  if (!fs.existsSync(filePath)) return false;

  const stats = fs.statSync(filePath);
  const previous = syncState[filename];

  if (previous && previous.size === stats.size && Math.abs(previous.mtime - stats.mtimeMs) < 1000) {
    return false;
  }

  return true;
}

// ─── Start watcher ────────────────────────────────────────────────────────────
log('START', '══════════════════════════════════════════════════');
log('START', '  ChickenSee Sync Agent');
log('START', '══════════════════════════════════════════════════');
log('START', `Sync target : ${SYNC_URL}`);
log('START', `Directories : ${WATCH_DIRS.length} configured`);
WATCH_DIRS.forEach((d) => log('START', `  → ${d}`));
log('START', '══════════════════════════════════════════════════');

const watcher = chokidar.watch(WATCH_DIRS, {
  ignored: /(^|[\/\\])\\..|.*\.tmp$|.*\.part$/,
  persistent: true,
  ignoreInitial: false,
  awaitWriteFinish: {
    stabilityThreshold: STABILITY_THRESHOLD,
    pollInterval: POLL_INTERVAL,
  },
});

watcher
  .on('add', (filePath) => {
    if (shouldSync(filePath)) {
      log('DETECT', `New file ready: ${path.basename(filePath)}  (${path.dirname(filePath)})`);
      uploadFileWithRetry(filePath);
    }
  })
  .on('change', (filePath) => {
    if (shouldSync(filePath)) {
      log('DETECT', `Modified file ready: ${path.basename(filePath)}`);
      uploadFileWithRetry(filePath);
    }
  })
  .on('error', (error) => {
    log('ERROR', `Watcher error: ${error.message}`);
  });
