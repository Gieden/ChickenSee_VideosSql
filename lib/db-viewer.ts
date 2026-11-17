import fs from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';
import type { Database, SqlValue } from 'sql.js';

let SQLModule: any = null;

async function getSqlModule() {
  if (!SQLModule) {
    const candidatePaths = [
      path.join(process.cwd(), 'public', 'sql-wasm.wasm'),
      path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
      path.join(__dirname, 'sql-wasm.wasm'),
      '/var/task/public/sql-wasm.wasm',
      '/var/task/node_modules/sql.js/dist/sql-wasm.wasm',
    ];

    let wasmBinary: ArrayBuffer | undefined;
    for (const candidate of candidatePaths) {
      try {
        if (fs.existsSync(candidate)) {
          const buf = fs.readFileSync(candidate);
          wasmBinary = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          break;
        }
      } catch {
        // ignore and continue
      }
    }

    if (wasmBinary) {
      SQLModule = await initSqlJs({ wasmBinary });
    } else {
      SQLModule = await initSqlJs({
        locateFile: (file) => {
          for (const candidate of [
            path.join(process.cwd(), 'public', file),
            path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
          ]) {
            try {
              if (fs.existsSync(candidate)) return candidate;
            } catch {
              // ignore
            }
          }
          return path.join(process.cwd(), 'public', file);
        },
      });
    }
  }
  return SQLModule;
}

export interface QueryResult {
  columns: string[];
  values: SqlValue[][];
  totalRows: number;
}

export async function openDatabaseFromBytes(content: ArrayBuffer): Promise<Database> {
  const SQL = await getSqlModule();
  const uInt8Array = new Uint8Array(content);
  return new SQL.Database(uInt8Array);
}

export function getDatabaseTables(db: Database): string[] {
  const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC;");
  if (!res.length || !res[0].values) return [];
  return res[0].values.map((row) => String(row[0]));
}

export function queryTableData(
  db: Database,
  tableName: string,
  limit: number = 50,
  offset: number = 0
): QueryResult {
  // Sanitize tableName against SQL injection
  const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  if (!sanitizedTable) {
    throw new Error('Invalid table name.');
  }

  // Count total rows
  const countRes = db.exec(`SELECT COUNT(*) FROM "${sanitizedTable}";`);
  const totalRows = countRes.length && countRes[0].values.length ? Number(countRes[0].values[0][0]) : 0;

  // Query paginated rows
  const query = `SELECT * FROM "${sanitizedTable}" LIMIT ${Math.min(limit, 200)} OFFSET ${offset};`;
  const result = db.exec(query);

  if (!result.length) {
    // If table is empty, query schema for column names
    const pragmaRes = db.exec(`PRAGMA table_info("${sanitizedTable}");`);
    const columns = pragmaRes.length ? pragmaRes[0].values.map((col) => String(col[1])) : [];
    return { columns, values: [], totalRows: 0 };
  }

  return {
    columns: result[0].columns,
    values: result[0].values,
    totalRows,
  };
}

/**
 * Return every row of a table (no pagination) plus a day-bucketed summary.
 * Used by the SQLite Data Viewer's session-detail modal, which shows all
 * sensor readings recorded inside a session, grouped by calendar day.
 */
export interface SensorAverages {
  totalReadings: number;
  avgTemperature: number | null;
  avgHumidity: number | null;
  avgAmmoniaPpm: number | null;
  avgSoundDb: number | null;
  minTemperature: number | null;
  maxTemperature: number | null;
  minHumidity: number | null;
  maxHumidity: number | null;
  minAmmoniaPpm: number | null;
  maxAmmoniaPpm: number | null;
  minSoundDb: number | null;
  maxSoundDb: number | null;
  thi: number | null;
  durationSeconds: number | null;
  frameCount: number | null;
  videoFile: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface SensorChartPoint {
  index: number;
  elapsedSeconds: number;
  timestamp: string | null;
  timeLabel: string;
  temperature: number;
  humidity: number;
  ammoniaPpm: number;
  soundDb: number;
  thi: number;
}

export interface SensorTimeRange {
  startAt: string;
  endAt: string;
}

export interface SensorHourOption extends SensorTimeRange {
  key: string;
  label: string;
  totalReadings: number;
}

export function querySensorHourOptions(db: Database, timeZone: string): SensorHourOption[] {
  if (!getDatabaseTables(db).includes('sensor_logs')) return [];

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
  });
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  });
  const buckets = new Map<string, { startMs: number; count: number }>();
  const result = db.exec('SELECT captured_at FROM sensor_logs WHERE captured_at IS NOT NULL;');

  if (!result.length) return [];

  for (const [value] of result[0].values) {
    const timestamp = Date.parse(String(value));
    if (!Number.isFinite(timestamp)) continue;

    const parts = formatter.formatToParts(new Date(timestamp));
    const fields = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
    const year = Number(fields.year);
    const month = Number(fields.month);
    const day = Number(fields.day);
    const hour = Number(fields.hour);
    const minute = Number(fields.minute);
    const second = Number(fields.second);
    if (![year, month, day, hour, minute, second].every(Number.isFinite)) continue;

    const localTimestamp = Date.UTC(year, month - 1, day, hour, minute, second, timestamp % 1000);
    const offsetMs = localTimestamp - timestamp;
    const startMs = Date.UTC(year, month - 1, day, hour) - offsetMs;
    const localHour = `${fields.year}-${fields.month}-${fields.day}T${fields.hour}`;
    const key = `${localHour}|${offsetMs}`;
    const bucket = buckets.get(key);

    if (bucket) {
      bucket.count += 1;
    } else {
      buckets.set(key, { startMs, count: 1 });
    }
  }

  return Array.from(buckets.entries())
    .map(([key, bucket]) => {
      const start = new Date(bucket.startMs);
      const end = new Date(bucket.startMs + 60 * 60 * 1000);
      return {
        key,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        label: `${dateFormatter.format(start)} · ${timeFormatter.format(start)}–${timeFormatter.format(end)}`,
        totalReadings: bucket.count,
      };
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export function calculateSensorAverages(db: Database, range?: SensorTimeRange): SensorAverages {
  const tables = getDatabaseTables(db);
  const out: SensorAverages = {
    totalReadings: 0,
    avgTemperature: null,
    avgHumidity: null,
    avgAmmoniaPpm: null,
    avgSoundDb: null,
    minTemperature: null,
    maxTemperature: null,
    minHumidity: null,
    maxHumidity: null,
    minAmmoniaPpm: null,
    maxAmmoniaPpm: null,
    minSoundDb: null,
    maxSoundDb: null,
    thi: null,
    durationSeconds: null,
    frameCount: null,
    videoFile: null,
    startedAt: null,
    endedAt: null,
  };

  if (tables.includes('sensor_logs')) {
    try {
      const durationExpression = range
        ? 'MAX(elapsed_seconds) - MIN(elapsed_seconds)'
        : 'MAX(elapsed_seconds)';
      const whereClause = range
        ? 'WHERE julianday(captured_at) >= julianday(?) AND julianday(captured_at) < julianday(?)'
        : '';
      const q = `
        SELECT 
          COUNT(*),
          AVG(temperature),
          AVG(humidity),
          AVG(ammonia_ppm),
          AVG(sound_db),
          MIN(temperature),
          MAX(temperature),
          MIN(humidity),
          MAX(humidity),
          MIN(ammonia_ppm),
          MAX(ammonia_ppm),
          MIN(sound_db),
          MAX(sound_db),
          MIN(captured_at),
          MAX(captured_at),
          ${durationExpression}
        FROM sensor_logs
        ${whereClause};
      `;
      const res = db.exec(q, range ? [range.startAt, range.endAt] : undefined);
      if (res.length && res[0].values.length) {
        const row = res[0].values[0];
        out.totalReadings = Number(row[0]) || 0;
        out.avgTemperature = row[1] !== null ? Number(Number(row[1]).toFixed(1)) : null;
        out.avgHumidity = row[2] !== null ? Number(Number(row[2]).toFixed(1)) : null;
        out.avgAmmoniaPpm = row[3] !== null ? Number(Number(row[3]).toFixed(5)) : null;
        out.avgSoundDb = row[4] !== null ? Number(Number(row[4]).toFixed(1)) : null;
        out.minTemperature = row[5] !== null ? Number(Number(row[5]).toFixed(1)) : null;
        out.maxTemperature = row[6] !== null ? Number(Number(row[6]).toFixed(1)) : null;
        out.minHumidity = row[7] !== null ? Number(Number(row[7]).toFixed(1)) : null;
        out.maxHumidity = row[8] !== null ? Number(Number(row[8]).toFixed(1)) : null;
        out.minAmmoniaPpm = row[9] !== null ? Number(Number(row[9]).toFixed(5)) : null;
        out.maxAmmoniaPpm = row[10] !== null ? Number(Number(row[10]).toFixed(5)) : null;
        out.minSoundDb = row[11] !== null ? Number(Number(row[11]).toFixed(1)) : null;
        out.maxSoundDb = row[12] !== null ? Number(Number(row[12]).toFixed(1)) : null;
        if (row[13]) out.startedAt = String(row[13]);
        if (row[14]) out.endedAt = String(row[14]);
        if (row[15] !== null) out.durationSeconds = Number(row[15]);

        // Calculate Temperature-Humidity Index (THI)
        if (out.avgTemperature !== null && out.avgHumidity !== null) {
          const t = out.avgTemperature;
          const rh = out.avgHumidity;
          const thiVal = t - (0.55 - 0.0055 * rh) * (t - 14.5);
          out.thi = Number(thiVal.toFixed(1));
        }
      }
    } catch {
      // ignore
    }
  }

  if (tables.includes('recording')) {
    try {
      const recRes = db.exec('SELECT video_file, started_at, ended_at, frame_count, duration_seconds FROM recording LIMIT 1;');
      if (recRes.length && recRes[0].values.length) {
        const row = recRes[0].values[0];
        if (row[0]) out.videoFile = String(row[0]);
        if (!out.startedAt && row[1]) out.startedAt = String(row[1]);
        if (!out.endedAt && row[2]) out.endedAt = String(row[2]);
        if (row[3] !== null) out.frameCount = Number(row[3]);
        if (!range && !out.durationSeconds && row[4] !== null) out.durationSeconds = Number(row[4]);
      }
    } catch {
      // ignore
    }
  }

  return out;
}

export function queryDownsampledSensorData(
  db: Database,
  targetPoints: number = 150,
  range?: SensorTimeRange
): SensorChartPoint[] {
  const tables = getDatabaseTables(db);
  if (!tables.includes('sensor_logs')) return [];

  try {
    const whereClause = range
      ? 'WHERE julianday(captured_at) >= julianday(?) AND julianday(captured_at) < julianday(?)'
      : '';
    const params = range ? [range.startAt, range.endAt] : undefined;
    const countRes = db.exec(`SELECT COUNT(*) FROM sensor_logs ${whereClause};`, params);
    const total = countRes.length && countRes[0].values.length ? Number(countRes[0].values[0][0]) : 0;
    if (total === 0) return [];

    const boundsRes = db.exec(`SELECT MIN(rowid), MAX(rowid) FROM sensor_logs ${whereClause};`, params);
    if (!boundsRes.length || !boundsRes[0].values.length) return [];
    const firstRowId = Number(boundsRes[0].values[0][0]);
    const lastRowId = Number(boundsRes[0].values[0][1]);
    const step = Math.max(1, Math.floor(total / targetPoints));
    const q = `
      SELECT elapsed_seconds, captured_at, temperature, humidity, ammonia_ppm, sound_db
      FROM sensor_logs
      ${whereClause ? `${whereClause} AND` : 'WHERE'} (
        rowid % ${step} = 0 OR rowid = ${firstRowId} OR rowid = ${lastRowId}
      )
      ORDER BY rowid ASC
      LIMIT 250;
    `;
    const res = db.exec(q, params);
    if (!res.length || !res[0].values) return [];

    return res[0].values.map((row, idx) => {
      const elapsed = Number(row[0]) || 0;
      const captured = row[1] ? String(row[1]) : null;
      const temp = Number(row[2]) || 0;
      const hum = Number(row[3]) || 0;
      const nh3 = Number(row[4]) || 0;
      const snd = Number(row[5]) || 0;
      const thi = Number((temp - (0.55 - 0.0055 * hum) * (temp - 14.5)).toFixed(1));

      let timeLabel = `${Math.floor(elapsed / 60)}m ${Math.floor(elapsed % 60)}s`;
      if (captured) {
        try {
          const d = new Date(captured);
          if (!isNaN(d.getTime())) {
            timeLabel = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          }
        } catch {
          // fallback to elapsed
        }
      }

      return {
        index: idx,
        elapsedSeconds: Number(elapsed.toFixed(1)),
        timestamp: captured,
        timeLabel,
        temperature: Number(temp.toFixed(1)),
        humidity: Number(hum.toFixed(1)),
        ammoniaPpm: Number(nh3.toFixed(5)),
        soundDb: Number(snd.toFixed(1)),
        thi,
      };
    });
  } catch {
    return [];
  }
}

export function querySensorTableData(
  db: Database,
  range: SensorTimeRange,
  limit: number = 50,
  offset: number = 0,
  search = '',
): QueryResult {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit) || 50));
  const safeOffset = Math.max(0, Math.floor(offset) || 0);
  const columnsResult = db.exec('PRAGMA table_info("sensor_logs");');
  const columns = columnsResult.length
    ? columnsResult[0].values.map((col) => String(col[1]))
    : [];
  const searchClause = search.trim() && columns.length
    ? ` AND (${columns.map((column) => `CAST("${column.replace(/"/g, '""')}" AS TEXT) LIKE ?`).join(' OR ')})`
    : '';
  const searchPattern = `%${search.trim()}%`;
  const whereClause = `WHERE julianday(captured_at) >= julianday(?) AND julianday(captured_at) < julianday(?)${searchClause}`;
  const params = [
    range.startAt,
    range.endAt,
    ...(searchClause ? columns.map(() => searchPattern) : []),
  ];
  const countRes = db.exec(`SELECT COUNT(*) FROM sensor_logs ${whereClause};`, params);
  const totalRows = countRes.length && countRes[0].values.length
    ? Number(countRes[0].values[0][0])
    : 0;
  const result = db.exec(
    `SELECT * FROM sensor_logs ${whereClause} ORDER BY rowid ASC LIMIT ${safeLimit} OFFSET ${safeOffset};`,
    params,
  );

  if (!result.length) {
    const pragmaRes = db.exec('PRAGMA table_info("sensor_logs");');
    const columns = pragmaRes.length ? pragmaRes[0].values.map((col) => String(col[1])) : [];
    return { columns, values: [], totalRows };
  }

  return {
    columns: result[0].columns,
    values: result[0].values,
    totalRows,
  };
}

export function queryTableAllRows(
  db: Database,
  tableName: string,
): QueryResult {
  const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  if (!sanitizedTable) {
    throw new Error('Invalid table name.');
  }

  const query = `SELECT * FROM "${sanitizedTable}";`;
  const result = db.exec(query);
  const countRes = db.exec(`SELECT COUNT(*) FROM "${sanitizedTable}";`);
  const totalRows = countRes.length && countRes[0].values.length ? Number(countRes[0].values[0][0]) : 0;

  if (!result.length) {
    const pragmaRes = db.exec(`PRAGMA table_info("${sanitizedTable}");`);
    const columns = pragmaRes.length ? pragmaRes[0].values.map((col) => String(col[1])) : [];
    return { columns, values: [], totalRows: 0 };
  }

  return {
    columns: result[0].columns,
    values: result[0].values,
    totalRows,
  };
}
