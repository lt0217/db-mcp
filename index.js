#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { dirname, join } from "path";
import { isAbsolute, resolve } from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";
import { getSqlDriver, SQL_TYPES, getMongoDriver, setOracleClientLibDir } from "./drivers.js";
import { ensureConfigSchema, migrateConfig, readConfig, writeConfig } from "./config-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config source: SQLite DB (preferred) or legacy JSON file ---
function resolveConfigSource() {
  const arg = process.argv[2];
  if (arg && /\.json$/i.test(arg)) return { kind: "json", path: arg };
  if (arg && /\.(db|sqlite|sqlite3)$/i.test(arg)) return { kind: "sqlite", path: arg };
  if (process.env.DB_CONFIG && /\.json$/i.test(process.env.DB_CONFIG))
    return { kind: "json", path: process.env.DB_CONFIG };
  return { kind: "sqlite", path: process.env.DB_CONFIG_SQLITE || join(__dirname, "config.db") };
}

const configSource = resolveConfigSource();
let configDb = null; // node:sqlite handle, only for the sqlite source

function loadJsonConfig(path) {
  if (!existsSync(path)) {
    const examplePath = join(__dirname, ".env.example.json");
    if (existsSync(examplePath)) {
      copyFileSync(examplePath, path);
      console.error(`Created ${path} from template. Edit it with your database credentials.`);
    } else {
      console.error(`Missing ${path}.`);
      process.exit(1);
    }
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

function loadSqliteConfig(path) {
  configDb = new DatabaseSync(path);
  ensureConfigSchema(configDb);
  migrateConfig(configDb);
  let cfg = readConfig(configDb);
  if (Object.keys(cfg.datasources).length === 0) {
    // Migrate from legacy .env.json if present
    const envPath = join(__dirname, ".env.json");
    if (existsSync(envPath)) {
      cfg = JSON.parse(readFileSync(envPath, "utf-8"));
      writeConfig(configDb, cfg);
      console.error(`Migrated config from ${envPath} into SQLite (${path})`);
      return cfg;
    }
    console.error(`No config found; created empty config in SQLite (${path}). Use config_set to populate.`);
  }
  return cfg;
}

let config = configSource.kind === "json" ? loadJsonConfig(configSource.path) : loadSqliteConfig(configSource.path);
console.error(`Config source: ${configSource.kind} (${configSource.path})`);

// Each Oracle datasource carries its own Instant Client directory
// (oracle_client_lib_dir). We point the Oracle driver at it right before
// opening that specific pool (Thick mode), instead of a single global value.
function dsUrl(type, name) {
  const e = config.datasources[type]?.[name];
  return e && typeof e === "object" && "url" in e ? e.url : e;
}
function oracleLibDirFor(type, name) {
  if (type !== "oracle") return undefined;
  const e = config.datasources[type]?.[name];
  return e && typeof e === "object" ? e.oracleClientLibDir : undefined;
}

// Lazy-load pools
const pools = {};
const poolDriver = {};
async function getPool(type, datasource) {
  const key = `${type}:${datasource}`;
  if (!pools[key]) {
    const url = dsUrl(type, datasource);
    if (!url) throw new Error(`Unknown datasource: ${type}/${datasource}`);
    if (type === "oracle") {
      const lib = oracleLibDirFor(type, datasource);
      if (lib) {
        const dir = isAbsolute(lib) ? lib : resolve(__dirname, lib);
        setOracleClientLibDir(dir);
      }
    }
    const driver = type === "mongodb" ? getMongoDriver() : getSqlDriver(type);
    pools[key] = await driver.createPool(url);
    poolDriver[key] = driver;
  }
  return pools[key];
}

function resolveSchema(type, datasource, schema) {
  if (schema) return schema;
  const e = config.datasources[type]?.[datasource];
  const ds = e && typeof e === "object" ? e.defaultSchema : undefined;
  if (ds) return ds;
  if (type === "postgres") return "public";
  return undefined;
}

function errOut(err) {
  return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
}

function parseArg(v, fallback) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

// --- Connection-string mode (universal / no-config) ---
// Infer DB type from a connection string scheme; normalize clickhouse:// -> http(s)://
function parseConnectionString(cs) {
  let url = cs;
  if (url.startsWith("clickhouse://")) url = "http://" + url.slice("clickhouse://".length);
  else if (url.startsWith("clickhouses://")) url = "https://" + url.slice("clickhouses://".length);
  const scheme = url.split("://")[0].split(":")[0].toLowerCase();
  const map = {
    postgres: "postgres", postgresql: "postgres",
    mysql: "mysql", mysql2: "mysql",
    sqlite: "sqlite",
    sqlserver: "sqlserver", mssql: "sqlserver",
    clickhouse: "clickhouse",
    duckdb: "duckdb",
    oracle: "oracle", oracles: "oracle",
    mongodb: "mongodb", "mongodb+srv": "mongodb",
    http: "clickhouse", https: "clickhouse",
  };
  const type = map[scheme];
  if (!type) {
    throw new Error(`Cannot infer database type from connection string scheme "${scheme}". Use e.g. postgres://, oracle://, mongodb://`);
  }
  return { type, url };
}

// Resolve a pool from either config (type+datasource) or a direct connection string.
async function resolvePool({ type, datasource, connectionString }) {
  if (connectionString) {
    const { type: t, url } = parseConnectionString(connectionString);
    const key = `cs:${connectionString}`;
    if (!pools[key]) {
      const driver = t === "mongodb" ? getMongoDriver() : getSqlDriver(t);
      pools[key] = await driver.createPool(url);
      poolDriver[key] = driver;
    }
    return { pool: pools[key], type: t };
  }
  const pool = await getPool(type, datasource);
  return { pool, type };
}

async function resolveMongo({ datasource, connectionString }) {
  if (connectionString) return (await resolvePool({ connectionString })).pool;
  return getPool("mongodb", datasource);
}

// -- MCP server --
const server = new McpServer({ name: "db-mcp", version: "0.2.0" });

const dbTypeSchema = z.enum(SQL_TYPES);

// Execute arbitrary SQL on a SQL datasource
server.registerTool(
  "query",
  {
    title: "Execute SQL query",
    description:
      "Execute an arbitrary SQL query on the specified SQL datasource (postgres/mysql/sqlite/sqlserver/clickhouse/duckdb/oracle). Supports SELECT, CREATE TABLE, INSERT, ALTER, DROP, etc.",
    inputSchema: {
      type: dbTypeSchema.optional().describe("Database type (postgres/mysql/sqlite/sqlserver/clickhouse/duckdb/oracle). Required unless connectionString is given."),
      datasource: z.string().optional().describe("Datasource name from config. Required unless connectionString is given."),
      connectionString: z.string().optional().describe("Full connection string, e.g. postgres://user:pass@host:5432/db or oracle://user:pass@host:1521/ORCL. When given, type/datasource are ignored and the driver is inferred from the scheme."),
      sql: z.string().describe("SQL query to execute"),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  async ({ type, datasource, connectionString, sql }) => {
    try {
      if (!connectionString && (!type || !datasource))
        return errOut(new Error("Provide either 'connectionString' or both 'type' and 'datasource'"));
      const { pool, type: t } = await resolvePool({ type, datasource, connectionString });
      const result = await getSqlDriver(t).execQuery(pool, sql);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (err) {
      return errOut(err);
    }
  },
);

// List tables
server.registerTool(
  "list_tables",
  {
    title: "List tables",
    description: "List all tables/collections in a database or schema",
    inputSchema: {
      type: dbTypeSchema.optional().describe("Database type. Required unless connectionString is given."),
      datasource: z.string().optional().describe("Datasource name from config. Required unless connectionString is given."),
      connectionString: z.string().optional().describe("Full connection string; infers driver from scheme and ignores type/datasource."),
      schema: z.string().optional().describe("Schema name (postgres/sqlserver); optional"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ type, datasource, connectionString, schema }) => {
    try {
      if (!connectionString && (!type || !datasource))
        return errOut(new Error("Provide either 'connectionString' or both 'type' and 'datasource'"));
      const { pool, type: t } = await resolvePool({ type, datasource, connectionString });
      const resolved = resolveSchema(t, datasource, schema);
      const rows = await getSqlDriver(t).listTables(pool, { schema: resolved });
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
        structuredContent: { tables: rows },
      };
    } catch (err) {
      return errOut(err);
    }
  },
);

// Describe table
server.registerTool(
  "describe_table",
  {
    title: "Describe table",
    description: "Get column information for a table",
    inputSchema: {
      type: dbTypeSchema.optional().describe("Database type. Required unless connectionString is given."),
      datasource: z.string().optional().describe("Datasource name from config. Required unless connectionString is given."),
      connectionString: z.string().optional().describe("Full connection string; infers driver from scheme and ignores type/datasource."),
      table: z.string().describe("Table name"),
      schema: z.string().optional().describe("Schema name (postgres/sqlserver); optional"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ type, datasource, connectionString, table, schema }) => {
    try {
      if (!connectionString && (!type || !datasource))
        return errOut(new Error("Provide either 'connectionString' or both 'type' and 'datasource'"));
      const { pool, type: t } = await resolvePool({ type, datasource, connectionString });
      const resolved = resolveSchema(t, datasource, schema);
      const rows = await getSqlDriver(t).describeTable(pool, { table, schema: resolved });
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
        structuredContent: { columns: rows },
      };
    } catch (err) {
      return errOut(err);
    }
  },
);

// List configured datasources
server.registerTool(
  "list_datasources",
  {
    title: "List datasources",
    description: "List all configured database datasources",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    const ds = {};
    for (const t of Object.keys(config.datasources)) {
      ds[t] = {};
      for (const n of Object.keys(config.datasources[t])) {
        const e = config.datasources[t][n];
        const url = dsUrl(t, n);
        const desc = e && typeof e === "object" ? e.description : undefined;
        const en = e && typeof e === "object" ? e.enabled : undefined;
        ds[t][n] = { url, description: desc || "", enabled: (en === 0 ? 0 : 1) };
      }
    }
    return {
      content: [{ type: "text", text: JSON.stringify(ds, null, 2) }],
      structuredContent: { datasources: ds },
    };
  },
);

// Read current config (from SQLite or JSON source)
server.registerTool(
  "config_get",
  {
    title: "Get MCP config",
    description: "Return the current datasource configuration as stored (SQLite-backed).",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    return {
      content: [{ type: "text", text: JSON.stringify(config, null, 2) }],
      structuredContent: { config },
    };
  },
);

// Write/replace config (persisted into SQLite, or JSON file for legacy source)
server.registerTool(
  "config_set",
  {
    title: "Set MCP config",
    description:
      "Replace the stored configuration with the given JSON object. datasources is { type: { name: url } } or { type: { name: { url, oracleClientLibDir?, defaultSchema? } } } (oracleClientLibDir / defaultSchema are per-datasource). Persisted in SQLite; takes effect for new connections.",
    inputSchema: {
      config: z.any().describe("Config object, e.g. { datasources: { postgres: { master: { url: 'postgresql://...', defaultSchema: 'public' } } }, oracle: { default: { url: 'oracle://...', oracleClientLibDir: 'C:\\\\instantclient' } } }"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ config: newCfg }) => {
    const cfg = typeof newCfg === "string" ? JSON.parse(newCfg) : newCfg;
    if (!cfg || typeof cfg !== "object" || !cfg.datasources) {
      return errOut(new Error("config must be an object containing a 'datasources' field"));
    }
    // Backward compat: a top-level oracleClientLibDir applies to every Oracle
    // source that doesn't already specify its own per-datasource directory.
    if (cfg.oracleClientLibDir) {
      for (const n of Object.keys(cfg.datasources.oracle || {})) {
        let e = cfg.datasources.oracle[n];
        if (typeof e === "string") e = cfg.datasources.oracle[n] = { url: e };
        if (e && !e.oracleClientLibDir) e.oracleClientLibDir = cfg.oracleClientLibDir;
      }
      delete cfg.oracleClientLibDir;
    }
    try {
      if (configSource.kind === "sqlite" && configDb) {
        writeConfig(configDb, cfg);
      } else if (configSource.kind === "json") {
        writeFileSync(configSource.path, JSON.stringify(cfg, null, 2));
      }
      config = cfg;
      return {
        content: [{ type: "text", text: "Config updated.\n" + JSON.stringify(cfg, null, 2) }],
        structuredContent: { config: cfg },
      };
    } catch (err) {
      return errOut(err);
    }
  },
);

// Probe connectivity of every (or a filtered) configured datasource.
// Mirrors web.js testConnection; each probe is wrapped in a timeout so an
// unreachable host can't hang the tool.
const PROBE_TIMEOUT = 5000;
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

server.registerTool(
  "test_datasources",
  {
    title: "Test datasource connectivity",
    description:
      "Probe every configured datasource (or a filtered type/name) and report whether it is reachable, with its description and latency. Use this to find out which datasources are currently usable without guessing.",
    inputSchema: {
      type: dbTypeSchema.optional().describe("Optional: only test datasources of this type."),
      datasource: z.string().optional().describe("Optional: only test this named datasource (within the given type)."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ type, datasource }) => {
    const results = [];
    const types = type ? [type] : Object.keys(config.datasources);
    for (const t of types) {
      const dsMap = config.datasources[t];
      if (!dsMap) continue;
      const names = datasource ? [datasource] : Object.keys(dsMap);
      for (const n of names) {
        const e = dsMap[n];
        if (!e) continue;
        const url = dsUrl(t, n);
        const description = e && typeof e === "object" ? e.description : undefined;
        const entry = { type: t, name: n, description: description || "", url };
        try {
          const probeSql = t === "oracle" ? "SELECT 1 FROM DUAL" : "SELECT 1";
          const start = Date.now();
          if (t === "mongodb") {
            const driver = getMongoDriver();
            const client = await withTimeout(driver.createPool(url), PROBE_TIMEOUT);
            try { await withTimeout(client.db().listCollections().toArray(), PROBE_TIMEOUT); }
            finally { await driver.close(client).catch(() => {}); }
          } else {
            const driver = getSqlDriver(t);
            const lib = t === "oracle" ? (e && typeof e === "object" ? e.oracleClientLibDir : undefined) : undefined;
            if (lib) setOracleClientLibDir(isAbsolute(lib) ? lib : resolve(__dirname, lib));
            const pool = await withTimeout(driver.createPool(url), PROBE_TIMEOUT);
            try { await withTimeout(driver.execQuery(pool, probeSql), PROBE_TIMEOUT); }
            finally { await driver.close(pool).catch(() => {}); }
          }
          entry.reachable = true;
          entry.latencyMs = Date.now() - start;
        } catch (err) {
          entry.reachable = false;
          entry.error = (err && err.message ? err.message : String(err)).split("\n")[0];
        }
        results.push(entry);
      }
    }
    const reachable = results.filter((r) => r.reachable).length;
    const summary = `Tested ${results.length} datasource(s): ${reachable} reachable, ${results.length - reachable} unreachable.`;
    return {
      content: [{ type: "text", text: summary + "\n" + JSON.stringify(results, null, 2) }],
      structuredContent: { summary, results },
    };
  },
);

// ---------- MongoDB tools ----------
const mongoDs = z.string().optional().describe("MongoDB datasource name (from config). Required unless connectionString is given.");
const mongoCs = z.string().optional().describe("Full MongoDB connection string, e.g. mongodb://user:pass@host:27017/db. When given, datasource is ignored.");

server.registerTool(
  "mongo_list_collections",
  {
    title: "List MongoDB collections",
    description: "List all collections in a MongoDB datasource",
    inputSchema: { datasource: mongoDs, connectionString: mongoCs },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ datasource, connectionString }) => {
    try {
      if (!connectionString && !datasource)
        return errOut(new Error("Provide either 'connectionString' or 'datasource'"));
      const client = await resolveMongo({ datasource, connectionString });
      const cols = await client.db().listCollections().toArray();
      const rows = cols.map((c) => ({ name: c.name, type: c.type }));
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
        structuredContent: { collections: rows },
      };
    } catch (err) {
      return errOut(err);
    }
  },
);

server.registerTool(
  "mongo_find",
  {
    title: "MongoDB find",
    description: "Query documents in a MongoDB collection",
    inputSchema: {
      datasource: mongoDs,
      connectionString: mongoCs,
      collection: z.string().describe("Collection name"),
      filter: z.any().optional().describe("Query filter (JSON object or string)"),
      projection: z.any().optional().describe("Projection (JSON object or string)"),
      sort: z.any().optional().describe("Sort spec (JSON object or string)"),
      limit: z.number().int().optional().describe("Max documents"),
      skip: z.number().int().optional().describe("Documents to skip"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ datasource, connectionString, collection, filter, projection, sort, limit, skip }) => {
    try {
      if (!connectionString && !datasource)
        return errOut(new Error("Provide either 'connectionString' or 'datasource'"));
      const client = await resolveMongo({ datasource, connectionString });
      let q = client.db().collection(collection).find(parseArg(filter, {}));
      if (projection) q = q.project(parseArg(projection, {}));
      if (sort) q = q.sort(parseArg(sort, {}));
      if (skip) q = q.skip(skip);
      if (limit) q = q.limit(limit);
      const rows = await q.toArray();
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
        structuredContent: { documents: rows },
      };
    } catch (err) {
      return errOut(err);
    }
  },
);

server.registerTool(
  "mongo_aggregate",
  {
    title: "MongoDB aggregate",
    description: "Run an aggregation pipeline on a MongoDB collection",
    inputSchema: {
      datasource: mongoDs,
      connectionString: mongoCs,
      collection: z.string().describe("Collection name"),
      pipeline: z.any().describe("Aggregation pipeline (JSON array or string)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ datasource, connectionString, collection, pipeline }) => {
    try {
      if (!connectionString && !datasource)
        return errOut(new Error("Provide either 'connectionString' or 'datasource'"));
      const client = await resolveMongo({ datasource, connectionString });
      const rows = await client
        .db()
        .collection(collection)
        .aggregate(parseArg(pipeline, []))
        .toArray();
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
        structuredContent: { documents: rows },
      };
    } catch (err) {
      return errOut(err);
    }
  },
);

server.registerTool(
  "mongo_insert",
  {
    title: "MongoDB insert",
    description: "Insert one or many documents into a MongoDB collection",
    inputSchema: {
      datasource: mongoDs,
      connectionString: mongoCs,
      collection: z.string().describe("Collection name"),
      documents: z.any().describe("Document or array of documents (JSON or string)"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ datasource, connectionString, collection, documents }) => {
    try {
      if (!connectionString && !datasource)
        return errOut(new Error("Provide either 'connectionString' or 'datasource'"));
      const client = await resolveMongo({ datasource, connectionString });
      const docs = parseArg(documents, []);
      const arr = Array.isArray(docs) ? docs : [docs];
      const r = await client.db().collection(collection).insertMany(arr);
      return {
        content: [{ type: "text", text: JSON.stringify({ insertedCount: r.insertedCount }, null, 2) }],
        structuredContent: { insertedCount: r.insertedCount },
      };
    } catch (err) {
      return errOut(err);
    }
  },
);

server.registerTool(
  "mongo_update",
  {
    title: "MongoDB update",
    description: "Update documents in a MongoDB collection",
    inputSchema: {
      datasource: mongoDs,
      connectionString: mongoCs,
      collection: z.string().describe("Collection name"),
      filter: z.any().describe("Query filter (JSON or string)"),
      update: z.any().describe("Update document/operators (JSON or string)"),
      upsert: z.boolean().optional().describe("Insert if not matched"),
      multi: z.boolean().optional().describe("Update all matches (default false)"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ datasource, connectionString, collection, filter, update, upsert, multi }) => {
    try {
      if (!connectionString && !datasource)
        return errOut(new Error("Provide either 'connectionString' or 'datasource'"));
      const client = await resolveMongo({ datasource, connectionString });
      const coll = client.db().collection(collection);
      const res = multi
        ? await coll.updateMany(parseArg(filter, {}), parseArg(update, {}), { upsert: !!upsert })
        : await coll.updateOne(parseArg(filter, {}), parseArg(update, {}), { upsert: !!upsert });
      const out = { matchedCount: res.matchedCount, modifiedCount: res.modifiedCount, upsertedCount: res.upsertedCount };
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        structuredContent: out,
      };
    } catch (err) {
      return errOut(err);
    }
  },
);

server.registerTool(
  "mongo_delete",
  {
    title: "MongoDB delete",
    description: "Delete documents from a MongoDB collection",
    inputSchema: {
      datasource: mongoDs,
      connectionString: mongoCs,
      collection: z.string().describe("Collection name"),
      filter: z.any().describe("Query filter (JSON or string)"),
      multi: z.boolean().optional().describe("Delete all matches (default false)"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async ({ datasource, connectionString, collection, filter, multi }) => {
    try {
      if (!connectionString && !datasource)
        return errOut(new Error("Provide either 'connectionString' or 'datasource'"));
      const client = await resolveMongo({ datasource, connectionString });
      const coll = client.db().collection(collection);
      const res = multi
        ? await coll.deleteMany(parseArg(filter, {}))
        : await coll.deleteOne(parseArg(filter, {}));
      const out = { deletedCount: res.deletedCount };
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        structuredContent: out,
      };
    } catch (err) {
      return errOut(err);
    }
  },
);

function closeAll() {
  for (const key of Object.keys(pools)) {
    try {
      const p = pools[key];
      const d = poolDriver[key];
      if (d && d.close) d.close(p).catch?.(() => {});
    } catch {}
    delete pools[key];
  }
  if (configDb) {
    try { configDb.close(); } catch {}
  }
}

process.on("exit", closeAll);
process.on("SIGINT", () => { closeAll(); process.exit(0); });
process.on("SIGTERM", () => { closeAll(); process.exit(0); });

await server.connect(new StdioServerTransport());
