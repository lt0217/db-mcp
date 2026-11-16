# db-mcp

[中文](./README.md) | English

> An MCP server that lets an AI operate **8 databases** through one set of simple tools.
> Ships with a visual config UI, zero-config connection strings, an AI-friendly datasource registry, and a **beginner-friendly source-code walkthrough with a runnable practice script**.

```
AI (MCP client) ──stdio/JSON-RPC──▶ db-mcp ──▶ 8 databases
                                      ├── config.db (datasource registry)
                                      └── web config UI (127.0.0.1:3777)
```

## Features

- **8 databases**: PostgreSQL, MySQL, SQLite, SQL Server, ClickHouse, DuckDB, Oracle, MongoDB
- **13 tools**: `query` / `list_tables` / `describe_table` / `list_datasources` / `config_get` / `config_set` / `test_datasources` + 6 `mongo_*` tools
- **Uniform results**: every query returns `{ rows, fields, rowCount }`
- **Two ways to resolve a database**: zero-config connection strings (type inferred from the scheme) + registered datasources (type/name)
- **AI-friendly registry**: every datasource requires a `description` so the AI knows which one to query
- **Legacy Oracle support**: Thick mode + configurable Instant Client directory for 11g/12c
- **Fully offline config UI**: local Vue/Element-Plus, no CDN
- **Robust**: lazy connection pools, 5s connectivity probes, read-only/write risk hints, automatic config migration
- **Learning materials**: [beginner walkthrough](./docs/从零看懂-db-mcp.md) (Chinese) + [one-command practice script](./examples/practice.mjs)

## Quick start

Requirements: **Node.js 22+** (`node:sqlite` is built in) and `npm install`.

```bash
npm run mcp    # MCP stdio server
npm run web    # config UI at http://127.0.0.1:3777/
```

On Windows, `start.bat` / `start.ps1` are provided.

First run creates an empty `config.db`. Add datasources via the web UI, via the `config_set` tool, or copy `config.example.json` and start with `node index.js config.example.json`.

> ⚠️ Never commit your real `config.db` — it contains addresses and credentials. `.gitignore` excludes it by default.

### Connection string schemes

| Prefix | Database |
|--------|----------|
| `postgres://` / `postgresql://` | PostgreSQL |
| `mysql://` | MySQL |
| `sqlite:path` | SQLite |
| `sqlserver://` / `mssql://` | SQL Server |
| `clickhouse://` / `http(s)://` | ClickHouse |
| `duckdb:path` | DuckDB |
| `oracle://` | Oracle service name (12c+) |
| `oracles://` | Oracle SID (11g) |
| `mongodb://` / `mongodb+srv://` | MongoDB |

### MCP client config (OpenCode example)

```json
{
  "mcp": {
    "db": {
      "type": "local",
      "command": ["node", "D:/path/to/db-mcp/index.js"],
      "enabled": true
    }
  }
}
```

Use `DB_CONFIG_SQLITE` to point each project at its own `config.db`.

## Oracle notes

- **19c+**: default Thin mode works, do not set `oracleClientLibDir`.
- **11g / 12c**: Thick mode requires Instant Client. Download the **Basic Package** from [Oracle](https://www.oracle.com/database/technologies/instant-client/downloads.html), extract it under `oci/`, and set `oracleClientLibDir`. See [`oci/README.md`](./oci/README.md).

> Oracle binaries are intentionally **not** included (licensing + GitHub's 100 MB file limit).

## Learn & practice

- 📖 [Zero-to-hero walkthrough](./docs/从零看懂-db-mcp.md) (Chinese)
- 🧪 [Practice script](./examples/practice.mjs): starts the server, simulates an AI client, and prints the raw JSON-RPC traffic.

```bash
node examples/practice.mjs
node examples/practice.mjs --quiet
```

## License

[MIT](./LICENSE)
