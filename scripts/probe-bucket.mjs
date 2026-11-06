// Probe the Supabase Storage bucket listing with the anon key to see folder behavior.
const URL = 'https://stovfnbqgufxtpaoznbv.supabase.co';
const KEY = 'sb_publishable_D56jgW8116Z6v9n19vbmlQ_tkjzllDN';
const BUCKET = 'chickensee-sync';

async function list(folder, opts = {}) {
  const res = await fetch(`${URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}`, apikey: KEY },
    body: JSON.stringify({ prefix: folder, limit: 100, offset: 0, ...opts }),
  });
  const text = await res.text();
  console.log(`list(${JSON.stringify(folder)}) -> ${res.status}`);
  try { console.log(JSON.stringify(JSON.parse(text), null, 1).slice(0, 1500)); } catch { console.log(text.slice(0, 300)); }
}

await list('databases', { delimiter: '/' });
await list('databases');
