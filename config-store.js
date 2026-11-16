// Shared config persistence for db-mcp.
// Both index.js (MCP server) and web.js (config UI) read/write the same SQLite
// config store. These helpers are pure functions over an open node:sqlite
// DatabaseSync handle; each caller owns the handle's lifetime.

const FILE_TYPES = new Set(["sqlite", "duckdb"]);

export function isFileType(t) {
  return FILE_TYPES.has(t);
}

export function parseConnString(type, url) {
  const it = { type, name: "", host: "", port: "", database: "", user: "", password: "", filePath: "" };
  if (!url) return it;
  if (isFileType(type)) {
    const m = url.match(/^\w+:(.+)$/);
    it.filePath = m ? m[1] : url;
    return it;
  }
  const m = url.match(/^\w+:\/\/(?:([^:@/]+)(?::([^@/]*))?@)?([^:/]+)(?::(\d+))?(?:\/([^?]*))?/);
  if (m) {
    it.user = m[1] || "";
    it.password = m[2] || "";
    it.host = m[3] || "";
    it.port = m[4] || "";
    it.database = m[5] || "";
  }
  return it;
}

export function buildConnString(it) {
  if (isFileType(it.type)) return it.type + ":" + (it.filePath || "");
  let s = it.type + "://";
  if (it.user) {
    s += it.user;
    if (it.password) s += ":" + it.password;
    s += "@";
  }
  s += it.host || "";
  if (it.port) s += ":" + it.port;
  if (it.database) s += "/" + it.database;
  return s;
}

export function ensureConfigSchema(db) {
  db.exec("CREATE TABLE IF NOT EXISTS datasources (type TEXT, name TEXT, host TEXT, port TEXT, database TEXT, username TEXT, password TEXT, file_path TEXT, oracle_client_lib_dir TEXT, default_schema TEXT, description TEXT, enabled INTEGER, PRIMARY KEY(type, name))");
}

// A datasource entry in the config object is `{ url, oracleClientLibDir?, defaultSchema? }`.
// Callers may still pass a bare url string (legacy / connection-string style);
// these helpers normalize both forms.
function entryUrl(e) {
  return e && typeof e === "object" && "url" in e ? e.url : e;
}
function entryLib(e) {
  return e && typeof e === "object" ? e.oracleClientLibDir : undefined;
}
function entrySchema(e) {
  return e && typeof e === "object" ? e.defaultSchema : undefined;
}
function entryDesc(e) {
  return e && typeof e === "object" && "description" in e ? e.description : undefined;
}
function entryEnabled(e) {
  return e && typeof e === "object" && "enabled" in e ? e.enabled : undefined;
}

// Reconstruct the config object from the split-column table.
export function readConfig(db) {
  const rows = db.prepare("SELECT type, name, host, port, database, username, password, file_path, oracle_client_lib_dir, default_schema, description, enabled FROM datasources ORDER BY type, name").all();
  const datasources = {};
  for (const r of rows) {
    const url = buildConnString({ type: r.type, host: r.host, port: r.port, database: r.database, user: r.username, password: r.password, filePath: r.file_path });
    const v = { url };
    if (r.type === "oracle" && r.oracle_client_lib_dir) v.oracleClientLibDir = r.oracle_client_lib_dir;
    if (r.default_schema) v.defaultSchema = r.default_schema;
    if (r.description) v.description = r.description;
    v.enabled = (r.enabled === 0 || r.enabled === "0") ? 0 : 1;
    datasources[r.type] = datasources[r.type] || {};
    datasources[r.type][r.name] = v;
  }
  return { datasources };
}

// Persist the whole config: one split-column row per datasource. Oracle rows
// additionally carry their own oracle_client_lib_dir; any row may carry a
// default_schema used by list_tables / describe_table.
export function writeConfig(db, cfg) {
  // Preserve existing descriptions for entries that don't specify one, so that
  // edits via web.js (which doesn't surface the field) don't wipe them.
  let prevDesc = {};
  let prevEnabled = {};
  try {
    const rows = db.prepare("SELECT type, name, description, enabled FROM datasources").all();
    for (const r of rows) {
      prevDesc[`${r.type}/${r.name}`] = r.description;
      prevEnabled[`${r.type}/${r.name}`] = r.enabled;
    }
  } catch { /* columns may not exist yet on a pre-migration DB */ }
  db.exec("BEGIN TRANSACTION");
  try {
    db.exec("DELETE FROM datasources");
    const ins = db.prepare("INSERT OR REPLACE INTO datasources (type, name, host, port, database, username, password, file_path, oracle_client_lib_dir, default_schema, description, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const type of Object.keys(cfg.datasources || {})) {
      for (const name of Object.keys(cfg.datasources[type] || {})) {
        const raw = cfg.datasources[type][name];
        if (!raw) continue;
        const url = entryUrl(raw);
        if (!url) continue;
        const f = parseConnString(type, url);
        const lib = type === "oracle" ? (entryLib(raw) || null) : null;
        const schema = entrySchema(raw) || null;
        const desc = entryDesc(raw) ?? prevDesc[`${type}/${name}`] ?? null;
        // description is mandatory: it tells the agent which DB to query.
        // Reject the whole save rather than persisting a source with no hint.
        if (!desc || !String(desc).trim()) {
          throw new Error(`数据源 ${type}/${name} 缺少必填的 description（用途描述）。请先填写描述再保存。`);
        }
        const enabledRaw = entryEnabled(raw);
        let enabled;
        if (enabledRaw === 0 || enabledRaw === false) enabled = 0;
        else if (enabledRaw === 1 || enabledRaw === true) enabled = 1;
        else enabled = prevEnabled[`${type}/${name}`] ?? 1;
        ins.run(type, name, f.host || null, f.port || null, f.database || null, f.user || null, f.password || null, f.filePath || null, lib, schema, desc, enabled);
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// Migrate into the split-column datasources table from either:
//  - the legacy single-row config ('config' key in mcp_config), or
//  - the previous url-column datasources table.
// The legacy global oracleClientLibDir is folded into each Oracle row.
// mcp_config is dropped entirely (its only remaining use was that setting).
export function migrateConfig(db) {
  // mcp_config is being retired; tolerate its absence on already-migrated DBs.
  let oldRow = null;
  try {
    oldRow = db.prepare("SELECT value FROM mcp_config WHERE key='config'").get();
  } catch { /* mcp_config does not exist yet / anymore */ }
  let legacy = null;
  if (oldRow && oldRow.value) {
    try {
      const c = JSON.parse(oldRow.value);
      if (c && c.datasources) legacy = c;
    } catch {
      /* ignore */
    }
  }
  const cols = db.prepare("PRAGMA table_info(datasources)").all().map((r) => r.name);
  let prev = null;
  if (cols.length && cols.includes("url")) {
    prev = {};
    for (const r of db.prepare("SELECT type, name, url FROM datasources").all()) {
      prev[r.type] = prev[r.type] || {};
      prev[r.type][r.name] = r.url;
    }
  }
  const legacyLib = legacy && legacy.oracleClientLibDir;
  if (legacy || prev) {
    const dsRaw = (legacy && legacy.datasources) || prev || {};
    const cfg = { datasources: {} };
    for (const t of Object.keys(dsRaw)) {
      cfg.datasources[t] = {};
      for (const n of Object.keys(dsRaw[t] || {})) {
        const v = { url: dsRaw[t][n] };
        if (t === "oracle" && legacyLib) v.oracleClientLibDir = legacyLib;
        cfg.datasources[t][n] = v;
      }
    }
    db.exec("DROP TABLE IF EXISTS datasources");
    db.exec("CREATE TABLE datasources (type TEXT, name TEXT, host TEXT, port TEXT, database TEXT, username TEXT, password TEXT, file_path TEXT, oracle_client_lib_dir TEXT, default_schema TEXT, PRIMARY KEY(type, name))");
    writeConfig(db, cfg);
    if (oldRow) db.prepare("DELETE FROM mcp_config WHERE key='config'").run();
  }
  // Make sure the per-row oracle_client_lib_dir / default_schema columns exist
  // on an already-migrated config.db that predates them.
  const cols2 = db.prepare("PRAGMA table_info(datasources)").all().map((r) => r.name);
  if (cols2.length && !cols2.includes("oracle_client_lib_dir")) {
    db.exec("ALTER TABLE datasources ADD COLUMN oracle_client_lib_dir TEXT");
  }
  if (cols2.length && !cols2.includes("default_schema")) {
    db.exec("ALTER TABLE datasources ADD COLUMN default_schema TEXT");
  }
  if (cols2.length && !cols2.includes("description")) {
    db.exec("ALTER TABLE datasources ADD COLUMN description TEXT");
  }
  if (cols2.length && !cols2.includes("enabled")) {
    db.exec("ALTER TABLE datasources ADD COLUMN enabled INTEGER");
  }
  // Fold the legacy global oracleClientLibDir (if any) into every Oracle row,
  // so the existing behaviour is preserved once mcp_config is dropped.
  let legacyGlobalLib = null;
  try {
    const o = db.prepare("SELECT value FROM mcp_config WHERE key='oracleClientLibDir'").get();
    if (o) legacyGlobalLib = o.value;
  } catch { /* mcp_config may already be gone */ }
  if (legacyGlobalLib) {
    db.prepare("UPDATE datasources SET oracle_client_lib_dir=? WHERE type='oracle' AND (oracle_client_lib_dir IS NULL OR oracle_client_lib_dir='')").run(legacyGlobalLib);
  }
  // Remove the now-unused mcp_config table.
  db.exec("DROP TABLE IF EXISTS mcp_config");
}
