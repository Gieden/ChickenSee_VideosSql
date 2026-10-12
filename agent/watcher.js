import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const SYNC_URL = process.env.VERCEL_SYNC_URL;
const SYNC_SECRET = process.env.SYNC_SECRET;
const WATCH_DIR = path.resolve(process.env.WATCH_DIR || './data');
const STABILITY_THRESHOLD = parseInt(process.env.STABILITY_THRESHOLD_MS || '2500', 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '500', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const STATE_FILE = path.resolve('./.sync-state.json');

// Ensure watch directory exists
if (!fs.existsSync(WATCH_DIR)) {
  fs.mkdirSync(WATCH_DIR, { recursive: true });
}

// Persistent sync tracking
let syncState = {};
try {
  if (fs.existsSync(STATE_FILE)) {
    syncState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  }
} catch (err) {
  console.warn('[WARN] Failed to load sync state, initializing fresh state.');
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(syncState, null, 2));
  } catch (err) {
    console.error('[ERROR] Failed to persist sync state:', err.message);
  }
}

function log(level, message, meta = '') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message} ${meta}`.trim());
}

async function uploadFileWithRetry(filePath, attempt = 1) {
  const filename = path.basename(filePath);
  const stats = fs.statSync(filePath);
  const ext = path.extname(filename).toLowerCase();

  const mimeType = ext === '.mp4' 
    ? 'video/mp4' 
    : 'application/x-sqlite3';

  log('INFO', `[Attempt ${attempt}/${MAX_RETRIES}] Initiating upload for "${filename}" (${(stats.size / 1024 / 1024).toFixed(2)} MB)...`);

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
      duplex: 'half', // Required in Node.js 18+ for streaming request bodies
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Server returned HTTP ${response.status}: ${errText}`);
    }

    const result = await response.json();
    log('SUCCESS', `Successfully synced "${filename}" -> Vercel Blob:`, result.url || result.pathname);

    // Save state
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
      log('INFO', `Retrying in ${delayMs / 1000} seconds...`);
      await new Promise((r) => setTimeout(r, delayMs));
      return uploadFileWithRetry(filePath, attempt + 1);
    } else {
      log('ERROR', `Exceeded maximum retries for "${filename}". Skipping for now.`);
    }
  }
}

function shouldSync(filePath) {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();
  
  if (!['.mp4', '.sqlite', '.db'].includes(ext)) {
    return false;
  }

  if (filename.startsWith('.') || filename.endsWith('.tmp') || filename.endsWith('.part')) {
    return false;
  }

  const stats = fs.statSync(filePath);
  const previous = syncState[filename];

  // If already uploaded and size/modification time hasn't changed, skip
  if (previous && previous.size === stats.size && Math.abs(previous.mtime - stats.mtimeMs) < 1000) {
    return false;
  }

  return true;
}

// Initialize Chokidar Watcher
log('START', `ChickenSee Sync Agent started.`);
log('START', `Watching directory: ${WATCH_DIR}`);
log('START', `Sync target: ${SYNC_URL}`);

const watcher = chokidar.watch(WATCH_DIR, {
  ignored: /(^|[\/\\])\..|.*\.tmp$|.*\.part$/,
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
      log('DETECT', `New file detected and ready: ${path.basename(filePath)}`);
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
    log('ERROR', `Watcher encounter an error: ${error.message}`);
  });
