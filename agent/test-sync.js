import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const SYNC_URL = process.env.VERCEL_SYNC_URL;
const SYNC_SECRET = process.env.SYNC_SECRET;

console.log('Testing URL:', SYNC_URL);
console.log('Using SYNC_SECRET:', SYNC_SECRET);

async function testSync() {
  try {
    const res = await fetch(SYNC_URL, {
      method: 'POST',
      headers: {
        'x-sync-secret': SYNC_SECRET,
        'x-action': 'get-upload-token',
        'x-filename': 'test_upload.mp4',
      },
    });

    const status = res.status;
    const body = await res.text();
    console.log(`Response Status: ${status}`);
    console.log(`Response Body: ${body}`);

    if (status === 200) {
      console.log('\n SUCCESS: Sync authentication succeeded! Token generated properly.');
    } else {
      console.log('\n❌ FAILED: Status', status);
    }
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

testSync();
