import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import test from 'node:test';

import { isSyncCandidate } from './sync-policy.js';

test('only completed detected videos in local videos directory are synced', () => {
  const storage = path.join(os.tmpdir(), 'chickensee-sync-policy');
  assert.equal(
    isSyncCandidate(path.join(storage, 'videos', 'sample_detected.mp4'), storage),
    true,
  );
  assert.equal(
    isSyncCandidate(path.join(storage, 'videos', 'sample_detected.processing.mp4'), storage),
    false,
  );
  assert.equal(
    isSyncCandidate(path.join(storage, 'videos', 'sample.mp4'), storage),
    false,
  );
  assert.equal(
    isSyncCandidate(path.join(storage, 'incoming', 'sample.mp4'), storage),
    false,
  );
  assert.equal(isSyncCandidate(path.join(storage, 'results', 'sample.json'), storage), true);
});

test('source watch folders do not sync original MP4s', () => {
  const storage = path.join(os.tmpdir(), 'chickensee-sync-policy');
  const watchFolder = path.join(os.tmpdir(), 'camera-recordings');
  assert.equal(
    isSyncCandidate(path.join(watchFolder, 'uploaded.mp4'), storage),
    false,
  );
  assert.equal(
    isSyncCandidate(path.join(watchFolder, 'telemetry.db'), storage),
    true,
  );
});
