// Driver registry for db-mcp.
// Each SQL driver implements: createPool(url), execQuery(pool, sql),
// listTables(pool, { schema }), describeTable(pool, { table, schema }), close(pool).
// MongoDB is handled separately (see getMongoDriver).

// ---------- PostgreSQL ----------
const postgres = {
  async createPool(url) {
    const { default: pg } = await import("pg");
    return new pg.Pool({ connectionString: url });
  },
  async execQuery(pool, sql) {
    const result = await pool.query(sql);
    return {
      rows: result.rows,
      fields: (result.fields || []).map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
      rowCount: result.rowCount ?? result.rows.length,
    };
  },
  async listTables(pool, { schema }) {
    const s = (schema || "public").replace(/[^a-zA-Z0-9_]/g, "");
    const r = await pool.query(
      "SELECT table_name AS name, table_schema AS schema FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
      [s],
    );
    return r.rows;
  },
  async describeTable(pool, { table, schema }) {
    const t = table.replace(/[^a-zA-Z0-9_]/g, "");
    const s = (schema || "public").replace(/[^a-zA-Z0-9_]/g, "");
    const r = await pool.query(
      "SELECT column_name, data_type, is_nullable, column_default, character_maximum_length FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
      [s, t],
    );
    return r.rows;
  },
  async close(pool) {
    await pool.end().catch(() => {});
  },
};

// ---------- MySQL ----------
const mysql = {
  async createPool(url) {
    const { default: mysql2 } = await import("mysql2/promise");
    return mysql2.createPool(url);
  },
  async execQuery(pool, sql) {
    const [rows, fields] = await pool.query(sql);
    return {
      rows,
      fields: (fields || []).map((f) => ({ name: f.name })),
      rowCount: rows.length,
    };
  },
  async listTables(pool, { schema }) {
    if (schema) {
      const s = schema.replace(/[^a-zA-Z0-9_]/g, "");
      const [rows] = await pool.query("SHOW TABLES FROM ??", [s]);
      return rows.map((r) => ({ name: Object.values(r)[0], schema: s }));
    }
    const [rows] = await pool.query("SHOW TABLES");
    return rows.map((r) => ({ name: Object.values(r)[0] }));
  },
  async describeTable(pool, { table }) {
    const t = table.replace(/[^a-zA-Z0-9_]/g, "");
    const [rows] = await pool.query("DESCRIBE ??", [t]);
    return rows;
  },
  async close(pool) {
    await pool.end().catch(() => {});
  },
};

// ---------- SQLite (Node 22+ built-in node:sqlite) ----------
const sqlite = {
  async createPool(url) {
    const { DatabaseSync } = await import("node:sqlite");
    const file = url.replace(/^sqlite:\/\//, "").replace(/^sqlite:/, "");
    return new DatabaseSync(file);
  },
  async execQuery(pool, sql) {
    const isSelect = /^\s*select/i.test(sql);
    if (isSelect) {
      const rows = pool.prepare(sql).all();
      return {
        rows,
        fields: rows[0] ? Object.keys(rows[0]).map((k) => ({ name: k })) : [],
        rowCount: rows.length,
      };
    }
    const info = pool.prepare(sql).run();
    return { rows: [], fields: [], rowCount: info.changes ?? 0 };
  },
  async listTables(pool) {
    return pool
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
  },
  async describeTable(pool, { table }) {
    const t = table.replace(/[^a-zA-Z0-9_]/g, "");
    const rows = pool.prepare(`PRAGMA table_info("${t}")`).all();
    return rows.map((r) => ({
      column_name: r.name,
      data_type: r.type,
      is_nullable: r.notnull ? "NO" : "YES",
      column_default: r.dflt_value,
      pk: r.pk,
    }));
  },
  async close(pool) {
    pool.close();
  },
};

// ---------- SQL Server (mssql, pure-JS TDS) ----------
const sqlserver = {
  async createPool(url) {
    const mssql = (await import("mssql")).default;
    const pool = new mssql.ConnectionPool(url);
    await pool.connect();
    return pool;
  },
  async execQuery(pool, sql) {
    const result = await pool.request().query(sql);
    const rows = result.recordset || [];
    const fields = result.columns
      ? Object.keys(result.columns).map((k) => ({ name: k }))
      : [];
    return { rows, fields, rowCount: rows.length };
  },
  async listTables(pool, { schema }) {
    const request = pool.request();
    request.input("schema", schema ? schema.replace(/[^a-zA-Z0-9_]/g, "") : null);
    const result = await request.query(
      "SELECT table_name AS name, table_schema AS schema FROM information_schema.tables WHERE table_type='BASE TABLE' AND (@schema IS NULL OR table_schema=@schema) ORDER BY table_name",
    );
    return result.recordset;
  },
  async describeTable(pool, { table, schema }) {
    const request = pool.request();
    request.input("table", table.replace(/[^a-zA-Z0-9_]/g, ""));
    request.input("schema", (schema || "dbo").replace(/[^a-zA-Z0-9_]/g, ""));
    const result = await request.query(
      "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name=@table AND table_schema=@schema ORDER BY ordinal_position",
    );
    return result.recordset;
  },
  async close(pool) {
    await pool.close().catch(() => {});
  },
};

// ---------- ClickHouse (HTTP client) ----------
const clickhouse = {
  async createPool(url) {
    const { createClient } = await import("@clickhouse/client");
    const u = new URL(url);
    return createClient({
      url: `${u.protocol}//${u.host}`,
      username: decodeURIComponent(u.username) || undefined,
      password: decodeURIComponent(u.password) || undefined,
      database: u.pathname.replace(/^\//, "") || undefined,
    });
  },
  async execQuery(pool, sql) {
    if (/^\s*select/i.test(sql)) {
      const rs = await pool.query({ query: sql, format: "JSONEachRow" });
      const rows = await rs.json();
      return {
        rows,
        fields: rows[0] ? Object.keys(rows[0]).map((k) => ({ name: k })) : [],
        rowCount: rows.length,
      };
    }
    await pool.command({ query: sql });
    return { rows: [], fields: [], rowCount: 0 };
  },
  async listTables(pool) {
    const rs = await pool.query({ query: "SHOW TABLES", format: "JSONEachRow" });
    const rows = await rs.json();
    return rows.map((r) => ({ name: r.name }));
  },
  async describeTable(pool, { table }) {
    const t = table.replace(/[^a-zA-Z0-9_]/g, "");
    const rs = await pool.query({ query: `DESCRIBE TABLE ${t}`, format: "JSONEachRow" });
    return rs.json();
  },
  async close(pool) {
    await pool.close().catch(() => {});
  },
};

// ---------- DuckDB ----------
const duckdb = {
  async createPool(url) {
    const mod = await import("duckdb");
    const DuckDB = mod.default || mod;
    const file = url.replace(/^duckdb:\/\//, "").replace(/^duckdb:/, "") || ":memory:";
    const db = new DuckDB.Database(file);
    return db.connect();
  },
  _all(conn, sql) {
    return new Promise((resolve, reject) => {
      conn.all(sql, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
  },
  async execQuery(pool, sql) {
    const rows = await this._all(pool, sql);
    return {
      rows,
      fields: rows[0] ? Object.keys(rows[0]).map((k) => ({ name: k })) : [],
      rowCount: rows.length,
    };
  },
  async listTables(pool) {
    return this._all(
      pool,
      "SELECT table_name AS name, table_schema AS schema FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_name",
    );
  },
  async describeTable(pool, { table }) {
    const t = table.replace(/[^a-zA-Z0-9_]/g, "");
    return this._all(
      pool,
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='${t}' ORDER BY ordinal_position`,
    );
  },
  async close(pool) {
    try {
      pool.close();
    } catch {}
  },
};

// ---------- Oracle (oracledb; Thick mode required for older DBs like 11g/12c) ----------
let oracleLibDir = undefined;
export function setOracleClientLibDir(dir) {
  oracleLibDir = dir;
}
let oracleInitialized = false;
const oracle = {
  _ensureInit(oracledb) {
    if (oracleInitialized) return;
    if (oracleLibDir) oracledb.initOracleClient({ libDir: oracleLibDir });
    oracleInitialized = true;
  },
  async createPool(url) {
    const oracledb = (await import("oracledb")).default;
    oracledb.autoCommit = true;
    this._ensureInit(oracledb);
    let connect;
    if (url.startsWith("oracle://") || url.startsWith("oracles://")) {
      const u = new URL(url);
      const host = `${u.hostname}${u.port ? ":" + u.port : ""}`;
      const db = u.pathname.replace(/^\//, "");
      // oracles:// -> SID (colon); oracle:// -> service name (slash)
      const sep = url.startsWith("oracles://") ? ":" : "/";
      connect = {
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        connectString: host + sep + db,
      };
    } else {
      connect = url; // native connect string: user/password@host:port/service (or :SID)
    }
    return { oracledb, connect };
  },
  async _conn(pool) {
    return pool.oracledb.getConnection(pool.connect);
  },
  async execQuery(pool, sql) {
    const conn = await this._conn(pool);
    try {
      const result = await conn.execute(sql, [], {
        outFormat: pool.oracledb.OUT_FORMAT_OBJECT,
      });
      const rows = result.rows || [];
      const fields = result.metaData
        ? result.metaData.map((m) => ({ name: m.name }))
        : [];
      return { rows, fields, rowCount: rows.length };
    } finally {
      await conn.close();
    }
  },
  async listTables(pool) {
    const conn = await this._conn(pool);
    try {
      const result = await conn.execute(
        "SELECT table_name AS name FROM user_tables ORDER BY table_name",
        [],
        { outFormat: pool.oracledb.OUT_FORMAT_OBJECT },
      );
      return result.rows || [];
    } finally {
      await conn.close();
    }
  },
  async describeTable(pool, { table }) {
    const conn = await this._conn(pool);
    try {
      const result = await conn.execute(
        "SELECT column_name, data_type, nullable, data_default FROM user_tab_columns WHERE UPPER(table_name)=UPPER(:table) ORDER BY column_id",
        [table],
        { outFormat: pool.oracledb.OUT_FORMAT_OBJECT },
      );
      return result.rows || [];
    } finally {
      await conn.close();
    }
  },
  async close() {},
};

// ---------- MongoDB (NoSQL; used by dedicated mongo_* tools) ----------
const mongodb = {
  async createPool(url) {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(url);
    await client.connect();
    return client;
  },
  async close(pool) {
    await pool.close().catch(() => {});
  },
};

const SQL_DRIVERS = {
  postgres,
  mysql,
  sqlite,
  sqlserver,
  clickhouse,
  duckdb,
  oracle,
};

export function getSqlDriver(type) {
  const d = SQL_DRIVERS[type];
  if (!d) throw new Error(`Unsupported database type: ${type}`);
  return d;
}

export const SQL_TYPES = Object.keys(SQL_DRIVERS);
export const getMongoDriver = () => mongodb;
