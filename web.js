#!/usr/bin/env node
// Standalone web UI for configuring db-mcp datasources.
// Reads/writes the same config.db as index.js. Reuses drivers.js to TEST connections.
// No external deps: Node built-in http + node:sqlite.
import http from "node:http";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join, isAbsolute, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { getSqlDriver, SQL_TYPES, getMongoDriver, setOracleClientLibDir } from "./drivers.js";
import { ensureConfigSchema, migrateConfig, readConfig, writeConfig } from "./config-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3777;
const HOST = process.env.WEB_HOST || "127.0.0.1";
const CONFIG_DB = process.env.DB_CONFIG_SQLITE || join(__dirname, "config.db");

function withConfigDb(fn) {
  const db = new DatabaseSync(CONFIG_DB);
  try {
    ensureConfigSchema(db);
    migrateConfig(db);
    return fn(db);
  } finally {
    db.close();
  }
}

function getConfig() {
  return withConfigDb((db) => readConfig(db));
}

function setConfig(cfg) {
  withConfigDb((db) => writeConfig(db, cfg));
}

// List immediate subdirectories of `base` (plus available drives at a root),
// for the in-UI directory picker. Safe: only directories are returned and the
// caller navigates by re-requesting; no writes or traversal beyond listing.
// An empty/absent `base` returns the "This PC" drive list.
function listDirs(base) {
  let drives = [];
  for (const L of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const p = `${L}:\\`;
    try { if (statSync(p).isDirectory()) drives.push({ name: p, path: p }); } catch { /* not a drive */ }
  }
  if (!base) {
    return { path: "", parent: null, drives, dirs: [] };
  }
  const target = resolve(base);
  let entries;
  try {
    entries = readdirSync(target, { withFileTypes: true });
  } catch (e) {
    return { path: target, parent: null, drives, dirs: [], error: e.message };
  }
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, path: join(target, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = dirname(target);
  const isRoot = parent === target;
  return { path: target, parent: isRoot ? "" : parent, drives, dirs };
}

async function testConnection({ type, url, oracleClientLibDir }) {
  if (type === "oracle" && oracleClientLibDir) {
    setOracleClientLibDir(isAbsolute(oracleClientLibDir) ? oracleClientLibDir : resolve(__dirname, oracleClientLibDir));
  }
  if (type === "mongodb") {
    const driver = getMongoDriver();
    const client = await driver.createPool(url);
    try {
      await client.db().listCollections().toArray();
      return { ok: true, message: "MongoDB connected" };
    } finally {
      await driver.close(client).catch(() => {});
    }
  }
  const driver = getSqlDriver(type);
  const pool = await driver.createPool(url);
  try {
    const sql = type === "oracle" ? "SELECT 1 FROM DUAL" : "SELECT 1";
    const r = await driver.execQuery(pool, sql);
    return { ok: true, message: `connected (rowCount=${r.rowCount})` };
  } finally {
    await driver.close(pool).catch(() => {});
  }
}

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/config" && req.method === "GET") {
    return sendJson(res, 200, getConfig());
  }

  if (url.pathname === "/api/config" && req.method === "POST") {
    try {
      const body = await readJson(req);
      if (!body || typeof body !== "object" || !body.datasources) {
        return sendJson(res, 400, { error: "config must contain 'datasources'" });
      }
      setConfig(body);
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (url.pathname === "/api/test" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const result = await testConnection(body);
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, 200, { ok: false, error: (e.message || "").split("\n")[0] });
    }
  }

  if (url.pathname === "/api/dirs" && req.method === "POST") {
    try {
      const body = await readJson(req);
      return sendJson(res, 200, listDirs(body.path));
    } catch (e) {
      return sendJson(res, 200, { path: "", parent: null, drives: [], dirs: [], error: e.message });
    }
  }

  // Serve static assets. We allow:
  //  - /node_modules/vue/... and /node_modules/element-plus/... (front-end libs, no CDN)
  //  - everything else under public/ (e.g. a local vendor copy if present)
  if (req.method === "GET" && url.pathname !== "/") {
    const rel = decodeURIComponent(url.pathname);
    let root;
    let sub;
    if (rel.startsWith("/node_modules/vue/")) { root = join(__dirname, "node_modules", "vue"); sub = rel.slice("/node_modules/vue/".length); }
    else if (rel.startsWith("/node_modules/element-plus/")) { root = join(__dirname, "node_modules", "element-plus"); sub = rel.slice("/node_modules/element-plus/".length); }
    else { root = join(__dirname, "public"); sub = rel; }
    const filePath = resolve(join(root, sub));
    const base = resolve(root);
    // Only allow built assets (dist/ and theme-chalk/), never package internals (package.json, src/, ...).
    const allowInside = root === join(__dirname, "public") || sub === "" || sub.startsWith("dist/") || sub.startsWith("theme-chalk/");
    if (allowInside && filePath.startsWith(base) && existsSync(filePath) && statSync(filePath).isFile()) {
      const ext = extname(filePath).toLowerCase();
      const ct = { ".js":"application/javascript", ".css":"text/css", ".html":"text/html; charset=utf-8",
        ".json":"application/json", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".gif":"image/gif", ".webp":"image/webp", ".ico":"image/x-icon", ".woff2":"font/woff2", ".woff":"font/woff", ".ttf":"font/ttf", ".map":"application/json" }[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": ct });
      return res.end(readFileSync(filePath));
    }
  }

  if (url.pathname === "/" && req.method === "GET") {
    try {
      const html = readFileSync(join(__dirname, "public", "admin.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    } catch (e) {
      return sendJson(res, 500, { error: "admin.html not found: " + e.message });
    }
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.error(`db-mcp config UI running at http://${HOST}:${PORT}/  (config: ${CONFIG_DB})`);
});
