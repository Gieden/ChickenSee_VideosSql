import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { put } from '@vercel/blob';

dotenv.config();

const SYNC_URL = process.env.VERCEL_SYNC_URL;
const SYNC_SECRET = process.env.SYNC_SECRET;
const STABILITY_THRESHOLD = parseInt(process.env.STABILITY_THRESHOLD_MS || '2500', 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '500', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '5', 10);
const ENABLE_CLOUD_SYNC = (process.env.ENABLE_CLOUD_SYNC || '1').toLowerCase() !== '0';
const LOCAL_STORAGE_ROOT = process.env.CHICKENSEE_LOCAL_STORAGE
  || 'C:\\Users\\Kairi\\Documents\\ChickenSee_Local_Storage';
const STATE_FILE = path.resolve('./.sync-state.json');
const CONFIG_FILE = path.resolve('./directories.json');

let cloudSyncDisabledReason = ENABLE_CLOUD_SYNC ? null : 'disabled by ENABLE_CLOUD_SYNC=0';

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

  return Array.from(dirs);
}

// ─── State Management ─────────────────────────────────────────────────────────
let syncState = {};
try {
  if (fs.existsSync(STATE_FILE)) {
    syncState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  }
} catch (err) {
  console.warn('[WARN] Could not read sync state file, starting fresh:', err.message);
  syncState = {};
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

function isPermanentCloudError(message) {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('has been suspended')
    || m.includes('store has been suspended')
    || m.includes('payment required')
    || m.includes('blob store') && m.includes('suspend')
  );
}

function localSubdirFor(ext) {
  if (ext === '.mp4') return 'incoming';
  if (ext === '.sqlite' || ext === '.db') return 'databases';
  return 'misc';
}

function archiveLocally(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const resolved = path.resolve(filePath);
    const localRoot = path.resolve(LOCAL_STORAGE_ROOT);
    if (resolved.toLowerCase().startsWith(localRoot.toLowerCase() + path.sep)) {
      return null;
    }

    const ext = path.extname(filePath).toLowerCase();
    const destDir = path.join(localRoot, localSubdirFor(ext));
    fs.mkdirSync(destDir, { recursive: true });

    const destPath = path.join(destDir, path.basename(filePath));
    const srcStats = fs.statSync(filePath);
    if (fs.existsSync(destPath)) {
      const destStats = fs.statSync(destPath);
      if (destStats.size === srcStats.size) {
        return destPath;
      }
    }
    fs.copyFileSync(filePath, destPath);
    log('LOCAL', `Saved "${path.basename(filePath)}" → ${destPath}`);
    return destPath;
  } catch (err) {
    log('WARN', `Local archive failed for "${path.basename(filePath)}": ${err.message}`);
    return null;
  }
}

function disableCloudSync(reason) {
  if (cloudSyncDisabledReason) return;
  cloudSyncDisabledReason = reason;
  log('WARN', `Cloud upload disabled for this session: ${reason}`);
  log('WARN', 'Files will continue to be stored locally. Unsuspend / reconnect Vercel Blob to resume uploads.');
}

// ─── Direct Large-File Upload using Token ─────────────────────────────────────
async function uploadDirectWithToken(filePath, filename, ext, stats) {
  // 1. Request client upload token from our Next.js API
  const tokenRes = await fetch(SYNC_URL, {
    method: 'POST',
    headers: {
      'x-sync-secret': SYNC_SECRET,
      'x-filename': encodeURIComponent(filename),
      'x-action': 'get-upload-token',
    },
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Token request failed (HTTP ${tokenRes.status}): ${errText}`);
  }

  const tokenData = await tokenRes.json();
  if (!tokenData.clientToken) {
    throw new Error('No clientToken returned by server');
  }

  const mimeType = ext === '.mp4' ? 'video/mp4' : 'application/x-sqlite3';
  const fileStream = fs.createReadStream(filePath);

  // 2. Upload directly to Vercel Blob with multipart: true
  // This bypasses the Vercel Function 4.5MB payload limit completely!
  const blob = await put(tokenData.blobPath, fileStream, {
    access: 'public',
    addRandomSuffix: false,
    contentType: mimeType,
    token: tokenData.clientToken,
    multipart: true,
  });

  return blob;
}

// ─── Fallback Direct Streaming Upload ─────────────────────────────────────────
async function uploadViaServerStream(filePath, filename, ext, stats) {
  const mimeType = ext === '.mp4' ? 'video/mp4' : 'application/x-sqlite3';
  const fileStream = fs.createReadStream(filePath);

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

  return await response.json();
}

// ─── Upload logic with Automatic Retry ────────────────────────────────────────
async function uploadFileWithRetry(filePath, attempt = 1) {
  const filename = path.basename(filePath);
  const stats = fs.statSync(filePath);
  const ext = path.extname(filename).toLowerCase();
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

  if (cloudSyncDisabledReason) {
    log('SKIP', `Cloud upload skipped for "${filename}" (${cloudSyncDisabledReason})`);
    return;
  }

  log('INFO', `[Attempt ${attempt}/${MAX_RETRIES}] Uploading "${filename}" (${sizeMB} MB)...`);

  try {
    let result;

    // For files > 4MB (like videos), use token-based direct multipart upload to bypass Vercel 4.5MB limit
    if (stats.size > 4 * 1024 * 1024) {
      result = await uploadDirectWithToken(filePath, filename, ext, stats);
    } else {
      result = await uploadViaServerStream(filePath, filename, ext, stats);
    }

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
    if (isPermanentCloudError(error.message)) {
      disableCloudSync('Vercel Blob store is suspended');
      return;
    }
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
  const prev = syncState[filename];

  // Already synced and hasn't changed
  if (prev && prev.size === stats.size && prev.mtime === stats.mtimeMs) {
    return false;
  }

  return true;
}

// ─── Sequential Upload Queue ──────────────────────────────────────────────────
const uploadQueue = [];
let isProcessingQueue = false;

function enqueueUpload(filePath) {
  if (!uploadQueue.includes(filePath)) {
    uploadQueue.push(filePath);
    // Sort queue by file size ascending so small files sync first
    uploadQueue.sort((a, b) => {
      try {
        return fs.statSync(a).size - fs.statSync(b).size;
      } catch {
        return 0;
      }
    });
    log('QUEUE', `Queued "${path.basename(filePath)}" (Queue size: ${uploadQueue.length})`);
    processQueue();
  }
}

async function processQueue() {
  if (isProcessingQueue || uploadQueue.length === 0) return;
  isProcessingQueue = true;

  while (uploadQueue.length > 0) {
    const nextFile = uploadQueue.shift();
    if (shouldSync(nextFile)) {
      log('QUEUE', `Processing (${uploadQueue.length} remaining): "${path.basename(nextFile)}"`);
      archiveLocally(nextFile);
      await uploadFileWithRetry(nextFile);
    }
  }

  isProcessingQueue = false;
}

// ─── Main Watcher Initializer ─────────────────────────────────────────────────
function startWatcher() {
  const watchDirs = resolveWatchDirs();

  console.log('[START] ══════════════════════════════════════════════════');
  console.log('[START]   ChickenSee Sync Agent (Sequential Queue)');
  console.log('[START] ══════════════════════════════════════════════════');
  console.log(`[START] Sync target : ${SYNC_URL || '(not set - check .env)'}`);
  console.log(`[START] Cloud sync  : ${cloudSyncDisabledReason ? `OFF (${cloudSyncDisabledReason})` : 'ON'}`);
  console.log(`[START] Local store : ${LOCAL_STORAGE_ROOT}`);
  console.log(`[START] Directories : ${watchDirs.length} configured`);
  watchDirs.forEach((d) => console.log(`[START]   → ${d}`));
  console.log('[START] ══════════════════════════════════════════════════');

  // Verify and create directories if needed
  watchDirs.forEach((d) => {
    if (!fs.existsSync(d)) {
      try {
        fs.mkdirSync(d, { recursive: true });
        log('INFO', `Created directory: ${d}`);
      } catch (err) {
        log('WARN', `Could not create directory ${d}:`, err.message);
      }
    }
  });

  const watcher = chokidar.watch(watchDirs, {
    persistent: true,
    ignoreInitial: false,
    usePolling: true,
    interval: POLL_INTERVAL,
    binaryInterval: POLL_INTERVAL,
    awaitWriteFinish: {
      stabilityThreshold: STABILITY_THRESHOLD,
      pollInterval: POLL_INTERVAL,
    },
    ignored: /(^|[\/\\])\..|(\.tmp$)|(\.part$)/,
    depth: 3,
  });

  watcher
    .on('add', (filePath) => {
      if (shouldSync(filePath)) {
        log('DETECT', `New file ready: ${path.basename(filePath)}  (${path.dirname(filePath)})`);
        enqueueUpload(filePath);
      }
    })
    .on('change', (filePath) => {
      if (shouldSync(filePath)) {
        log('DETECT', `File changed: ${path.basename(filePath)}  (${path.dirname(filePath)})`);
        enqueueUpload(filePath);
      }
    })
    .on('error', (err) => {
      log('ERROR', 'Watcher error:', err.message);
    })
    .on('ready', () => {
      log('READY', 'Initial scan complete. Watching for new or updated files...');
    });

  process.on('SIGINT', () => {
    log('SHUTDOWN', 'Stopping watcher gracefully...');
    watcher.close().then(() => {
      saveState();
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    watcher.close().then(() => {
      saveState();
      process.exit(0);
    });
  });
}

startWatcher();
