import initSqlJs, { Database, SqlValue } from 'sql.js';

let SQLModule: any = null;

async function getSqlModule() {
  if (!SQLModule) {
    SQLModule = await initSqlJs({
      // In serverless / Node environment, locateFile can be default or point to cdn
      locateFile: (file) => `https://sql.js.org/dist/${file}`,
    });
  }
  return SQLModule;
}

export interface QueryResult {
  columns: string[];
  values: SqlValue[][];
  totalRows: number;
}

export async function openDatabaseFromUrl(blobUrl: string): Promise<Database> {
  const SQL = await getSqlModule();
  const response = await fetch(blobUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch database file from ${blobUrl}: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const uInt8Array = new Uint8Array(arrayBuffer);
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
