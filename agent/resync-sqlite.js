/**
 * resync-sqlite.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One-shot tool: re-uploads every .sqlite / .db file found under the watched
 * directories using the new session-namespaced storage path
 * (databases/<session_folder>/<filename>) so each recording's database is
 * visible as a separate entry in the SQLite Data Viewer.
 *
 * Usage:  node resync-sqlite.js
 * ─────────────────────────────────────────────────────────────────────────────
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const SYNC_URL    = process.env.VERCEL_SYNC_URL;
const SYNC_SECRET = process.env.SYNC_SECRET;

if (!SYNC_URL || !SYNC_SECRET) {
  console.error('ERROR: VERCEL_SYNC_URL and SYNC_SECRET must be set in agent/.env');
  process.exit(1);
}

// ─── Collect all watch directories ───────────────────────────────────────────
const WATCH_DIRS = (process.env.WATCH_DIRS || '')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean);

console.log('--- ChickenSee SQLite Re-Sync Tool ---');
console.log('Watch dirs:', WATCH_DIRS);
console.log('Vercel target:', SYNC_URL);
console.log('');

// ─── Walk a directory tree and collect SQLite files ───────────────────────────
function findSqliteFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findSqliteFiles(full, results);
    } else if (/\.(sqlite|db)$/i.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

async function uploadFile(filePath) {
  const filename      = path.basename(filePath);
  const sessionFolder = path.basename(path.dirname(filePath));
  const stats         = fs.statSync(filePath);
  const sizeMB        = (stats.size / 1024 / 1024).toFixed(2);

  process.stdout.write(`  [${sessionFolder}/${filename}] (${sizeMB} MB)... `);

  // 1. Get signed upload URL
  let uploadInfo;
  try {
    const res = await fetch(SYNC_URL, {
      method: 'POST',
      headers: {
        'x-sync-secret': SYNC_SECRET,
        'x-filename':    encodeURIComponent(filename),
        'x-folder':      encodeURIComponent(sessionFolder),
        'x-action':      'get-upload-url',
      },
    });
    uploadInfo = await res.json().catch(() => ({}));
    if (!res.ok || !uploadInfo.uploadUrl) {
      throw new Error(uploadInfo.error || `HTTP ${res.status}`);
    }
  } catch (err) {
    console.log(`✗ URL request failed: ${err.message}`);
    return false;
  }

  // 2. Upload the file
  try {
    const fileStream = fs.readFileSync(filePath); // small files — read all at once
    const res = await fetch(uploadInfo.uploadUrl, {
      method: 'PUT',
      headers: {
        'content-type':   'application/x-sqlite3',
        'content-length': stats.size.toString(),
        'x-upsert':       'true',
      },
      body: fileStream,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    console.log(`✓ → ${uploadInfo.storagePath}`);
    return true;
  } catch (err) {
    console.log(`✗ Upload failed: ${err.message}`);
    return false;
  }
}

async function main() {
  const allFiles = WATCH_DIRS.flatMap((dir) => findSqliteFiles(dir));
  console.log(`Found ${allFiles.length} SQLite file(s) to re-sync.\n`);

  let ok = 0, fail = 0;
  for (const f of allFiles) {
    const success = await uploadFile(f);
    success ? ok++ : fail++;
  }

  console.log(`\n========================================`);
  console.log(`Re-sync complete: ${ok} succeeded, ${fail} failed.`);
  console.log(`========================================`);
}

main();

