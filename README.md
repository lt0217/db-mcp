# db-mcp

[English](./README.en.md) | 中文

> 一个让 AI 用同一套简单指令，操作 **8 种数据库**的 MCP 服务器。
> 带可视化配置台、免配置连接串、AI 友好的"数据源登记本"，以及一份**零基础教学案例 + 可运行实践脚本**。

```
AI（MCP 客户端）──stdio/JSON-RPC──▶ db-mcp ──▶ 8 种数据库
                                      │
                                      ├── config.db（数据源登记本）
                                      └── web 配置台（127.0.0.1:3777）
```

## 特性

- **8 种数据库**：PostgreSQL、MySQL、SQLite、SQL Server、ClickHouse、DuckDB、Oracle、MongoDB
- **13 个工具**：`query` / `list_tables` / `describe_table` / `list_datasources` / `config_get` / `config_set` / `test_datasources` + 6 个 `mongo_*`
- **统一的返回结构**：无论什么数据库，查询都返回 `{ rows, fields, rowCount }`
- **两种定位方式**：免配置连接串（靠前缀自动推断类型）＋ 已登记数据源（type/name）
- **AI 友好的登记本**：每个数据源强制写 `description`，让 AI 知道"该查哪个库"
- **Oracle 老版本支持**：11g/12c 的 Thick 模式 + 可配置的 Instant Client 目录
- **全离线可视化配置台**：本地 Vue/Element-Plus，不依赖任何 CDN
- **健壮性**：连接池懒加载、5 秒超时探测、只读/可写风险标签、配置自动迁移
- **教学交付**：[零基础源码案例](./docs/从零看懂-db-mcp.md) + [一键实践脚本](./examples/practice.mjs)

## 快速开始

### 前置条件

- **Node.js 22+**（SQLite 驱动用到了 Node 22 内置的 `node:sqlite`）
- `npm install`

### 启动

```bash
npm run mcp    # 启动 MCP stdio 服务（给 AI 客户端用）
npm run web    # 启动配置台 http://127.0.0.1:3777/
```

Windows 用户也可以双击 `start.bat`（默认开配置台，`start.bat mcp` 开服务）或运行 `start.ps1`。

### 第一次配置

默认使用项目目录下的 `config.db`。首次运行时它是一张空表，用下面任一方式填入你的数据库：

1. **网页配置台**：`npm run web` → 浏览器打开 `http://127.0.0.1:3777/` → 添加数据源（每一项都必须填"用途说明"）
2. **MCP 工具**：让 AI 调用 `config_set`
3. **示例文件**：复制 `config.example.json` 改好后，用 `node index.js config.example.json` 启动

> ⚠️ **不要把你真实的 `config.db` 提交到 git**——它含数据库地址和账号密码。仓库的 `.gitignore` 已默认忽略。

### 连接串速查

| 前缀 | 数据库 |
|------|--------|
| `postgres://` / `postgresql://` | PostgreSQL |
| `mysql://` | MySQL |
| `sqlite:文件路径` | SQLite（如 `sqlite:./local.db`） |
| `sqlserver://` / `mssql://` | SQL Server |
| `clickhouse://` / `http(s)://` | ClickHouse |
| `duckdb:文件路径` | DuckDB（默认内存） |
| `oracle://` | Oracle 服务名（12c+） |
| `oracles://` | Oracle SID（11g） |
| `mongodb://` / `mongodb+srv://` | MongoDB（用 `mongo_*` 工具） |

### 接入 AI 客户端

项目通过 **stdio** 通信。以 OpenCode 为例，在 `.opencode/opencode.json` 中：

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

Claude Desktop / Cline 等客户端用 `mcpServers` 字段，写法类似（`"command": "node", "args": [...]`）。

> 每个项目可以通过环境变量 `DB_CONFIG_SQLITE` 指向**独立的** `config.db`，避免同名数据源互相覆盖。

## Oracle 说明

- **Oracle 19c+**：默认 Thin 模式即可，无需额外文件，也不要配置 `oracleClientLibDir`。
- **Oracle 11g / 12c**：必须用 Thick 模式 + 本机 Instant Client。请从 [Oracle 官网](https://www.oracle.com/database/technologies/instant-client/downloads.html) 自行下载 **Basic Package**，解压到 `oci/` 下对应的版本目录，并在数据源里配置 `oracleClientLibDir`。详见 [`oci/README.md`](./oci/README.md)。

> 仓库**不包含** Oracle 客户端二进制文件：它们受 Oracle 许可约束，且单文件超过 GitHub 100MB 限制。

## 工具清单

| 工具 | 说明 | 只读 |
|------|------|------|
| `query` | 执行任意 SQL | ❌ |
| `list_tables` | 列出所有表 | ✅ |
| `describe_table` | 查看表结构 | ✅ |
| `list_datasources` | 列出已配置数据源 | ✅ |
| `config_get` / `config_set` | 读 / 写配置 | ✅ / ❌ |
| `test_datasources` | 测试连通性（5 秒超时） | ✅ |
| `mongo_list_collections` / `mongo_find` / `mongo_aggregate` | MongoDB 查询类 | ✅ |
| `mongo_insert` / `mongo_update` / `mongo_delete` | MongoDB 写入类 | ❌ |

## 教学与动手实践

这是本项目区别于同类工具的一点：它不只是能用的软件，还是**可学习的案例**。

- 📖 [从零看懂 db-mcp](./docs/从零看懂-db-mcp.md)：面向零基础的源码教学案例（架构、逐文件拆解、一次请求的完整旅程、设计思想、排错、速查表）
- 🧪 [实践脚本](./examples/practice.mjs)：一条命令自动启动服务并模拟 AI 对话，把底层收发的 JSON 协议全部打印出来

```bash
node examples/practice.mjs           # 看协议细节（推荐）
node examples/practice.mjs --quiet   # 只看结果
```

详见 [`examples/README.md`](./examples/README.md)。

## 项目结构

```
index.js          主程序：启动 MCP 服务、注册工具、路由请求
drivers.js        驱动注册表：每种数据库一个"翻译官"
config-store.js   配置持久化：读写 config.db、数据迁移
web.js            配置台后端（Node 内置 http，无框架）
public/admin.html 配置台前端（本地 Vue/Element-Plus）
config.example.json  示例配置（占位，无真实凭证）
oci/              放 Instant Client 的目录（二进制不入库）
docs/             教学案例
examples/         可运行实践脚本
```

## 安全提示

- 仓库默认不跟踪任何 `*.db` 文件；请只提交代码和示例。
- `description` 是必填字段，因为它直接参与 AI 的选库决策，请写清楚用途。
- 写操作工具（`query` / `config_set` / `mongo_insert` 等）带 `readOnlyHint: false`，请在客户端侧按需限制 AI 权限。
- 生产环境建议使用只读账号，并通过 `enabled: 0` 禁用暂时不用的数据源。

## License

[MIT](./LICENSE)
