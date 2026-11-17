import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';

import {
  calculateSensorAverages,
  queryDownsampledSensorData,
  querySensorHourOptions,
  querySensorTableData,
} from './db-viewer.ts';

const SQL = await initSqlJs({
  locateFile: (file) => `${process.cwd()}\\node_modules\\sql.js\\dist\\${file}`,
});

test('hour options use the viewer timezone and filter chart, averages, and table rows', () => {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE sensor_logs (
      elapsed_seconds REAL,
      captured_at TEXT,
      temperature REAL,
      humidity REAL,
      ammonia_ppm REAL,
      sound_db REAL,
      note TEXT
    );
    INSERT INTO sensor_logs VALUES
      (0, '2026-11-13T23:00:00.000Z', 20, 50, 1, 60, NULL),
      (3599.9, '2026-11-13T23:59:59.900Z', 22, 52, 2, 62, NULL);
    CREATE TABLE recording (
      video_file TEXT,
      started_at TEXT,
      ended_at TEXT,
      frame_count INTEGER,
      duration_seconds REAL
    );
    INSERT INTO recording VALUES ('paired.mp4', 'start', 'end', 900, 2700);
  `);
  const insert = db.prepare('INSERT INTO sensor_logs VALUES (?, ?, ?, ?, ?, ?, ?);');
  for (let index = 0; index < 56; index += 1) {
    const capturedAt = new Date(Date.parse('2026-11-14T00:00:00.000Z') + index * 1000).toISOString();
    insert.run([3600 + index, capturedAt, 30, 60, 3, 70, index === 55 ? 'target row' : null]);
  }
  insert.free();

  const options = querySensorHourOptions(db, 'Asia/Manila');
  assert.equal(options.length, 2);
  assert.match(options[0].label, /7:00 AM–8:00 AM/);
  assert.equal(options[0].totalReadings, 2);
  assert.match(options[1].label, /8:00 AM–9:00 AM/);
  assert.equal(options[1].totalReadings, 56);

  const range = { startAt: options[1].startAt, endAt: options[1].endAt };
  assert.equal(calculateSensorAverages(db, range).totalReadings, 56);
  assert.equal(calculateSensorAverages(db, range).avgTemperature, 30);
  assert.equal(calculateSensorAverages(db, range).durationSeconds, 55);
  assert.equal(queryDownsampledSensorData(db, 150, range).length, 56);

  const firstPage = querySensorTableData(db, range, 50, 0);
  const secondPage = querySensorTableData(db, range, 50, 50);
  const searchResults = querySensorTableData(db, range, 50, 0, 'target');
  assert.equal(firstPage.totalRows, 56);
  assert.equal(firstPage.values.length, 50);
  assert.equal(secondPage.values.length, 6);
  assert.equal(firstPage.values[0][2], 30);
  assert.equal(searchResults.totalRows, 1);
  assert.equal(searchResults.values[0][6], 'target row');

  const singleReadingRange = {
    startAt: '2026-11-14T00:00:55.000Z',
    endAt: '2026-11-14T00:00:56.000Z',
  };
  assert.equal(calculateSensorAverages(db, singleReadingRange).durationSeconds, 0);
  db.close();
});
