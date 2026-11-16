# 从零看懂 db-mcp：一个"让 AI 能查任何数据库"的教学案例

> 这是一份**面向零基础**的源码教学案例。
> 你不需要会编程、不需要懂数据库、也不需要装过任何开发环境。
> 读完这份文档，你应该能回答四个问题：
>
> 1. 这个项目**是什么**、**为什么存在**？
> 2. 它由哪几个部分组成，各自干什么？
> 3. 当 AI 说"帮我查一下数据"时，程序内部**一步一步发生了什么**？
> 4. 如果我想改它，应该从哪里下手？
>
> 全文用同一个比喻贯穿：**把这想象成一家"联合国翻译中心"**。

---

## 目录

- [第 0 站：怎么读这份文档](#第-0-站怎么读这份文档)
- [第 1 站：先认识几个"黑话"](#第-1-站先认识几个黑话)
- [第 2 站：一句话说清它是干嘛的](#第-2-站一句话说清它是干嘛的)
- [第 3 站：为什么需要它](#第-3-站为什么需要它)
- [第 4 站：整体地图](#第-4-站整体地图)
- [第 5 站：文件清单速览](#第-5-站文件清单速览)
- [第 6 站：逐个文件拆解](#第-6-站逐个文件拆解)
- [第 7 站：跟着一个请求走完全程](#第-7-站跟着一个请求走完全程)
- [第 8 站：关键设计思想](#第-8-站关键设计思想)
- [第 9 站：实战工作坊（亲手跑起来）](#第-9-站实战工作坊亲手跑起来)
- [第 10 站：常见报错与排查](#第-10-站常见报错与排查)
- [第 11 站：速查表](#第-11-站速查表)
- [结语](#结语)

---

## 第 0 站：怎么读这份文档

- 如果你**完全没基础**：从第 1 站按顺序读，每一站都建立在前一站之上。
- 如果你**只想了解全貌**：读第 2、4、5 站就够了。
- 如果你**想改代码**：重点读第 6、8、9 站。

文中所有代码块都配了"**人话翻译**"，看不懂代码没关系，先读人话翻译。

---

## 第 1 站：先认识几个"黑话"

编程领域有很多行话。别怕，它们本质上都是很简单的东西，只是名字唬人。下面用大白话 + 生活比喻解释。

| 黑话 | 大白话 | 生活比喻 |
|------|--------|----------|
| **数据库（Database）** | 一个存放数据的"电子文件柜"，能快速存、取、查大量数据 | 一个巨大的、分了很多抽屉的档案柜 |
| **SQL** | 跟大多数数据库"说话"的标准语言，比如"查出所有用户" | 一种**大部分档案管理员都听得懂的通用问话方式** |
| **表（Table）** | 数据库里装数据的格子阵列，一行是一条记录，一列是一个字段 | 档案柜里的**一张表格**，每行是一个人 |
| **API** | 程序与程序之间约定的"说话规矩" | 两个部门之间固定的**办事流程和单据格式** |
| **MCP** | 一个标准协议，让 AI（大模型）能安全地调用外部工具/数据 | 一套**"AI 与世界对接"的统一插头标准** |
| **MCP 客户端** | 发起请求的那一方，通常是 AI 软件（比如 OpenCode、Claude） | **来办事的顾客**（它只会提需求） |
| **MCP 服务器** | 响应请求、真正干活的程序（**就是本项目**） | **办事窗口**，接单并把事办成 |
| **工具（Tool）** | 服务器对外提供的一项具体能力，比如"查表""列文件" | 窗口提供的**一个服务项目**（查询、存款、取款） |
| **JSON** | 一种轻量级的数据书写格式，长得像 `{ "名字": "值" }` | 一张**格式统一的登记单**，人和机器都看得懂 |
| **连接串（Connection String）** | 一串文字，告诉程序"连哪个数据库、用什么账号、在哪台机器" | 一张**写清了地址+账号+门牌号的地址条** |

### 1.1 重点说说 MCP 是什么

想象你是 AI，很聪明，但你被关在一个房间里，**看不到外面的世界**：查不了数据库、读不了文件、上不了网。

MCP 就是给你装上的一组"**标准化插座**"。外面的人只要按这个标准做好"电器"（工具），你插上就能用。

- 本项目（db-mcp）就是做了一个"**万能数据库插座板**"：
  - 上面有很多插孔（工具）：查数据、列清单、看表结构……
  - 插上以后，AI 就能操作各种数据库。

### 1.2 这个插座板用的"电线"是什么：stdio

项目里出现了 `StdioServerTransport` 这个词，意思是：

> **stdio = 标准输入输出**，简单说就是通过"键盘输入 / 屏幕输出"这种最朴素的方式传消息。

你可以理解成：AI 程序和本程序像两个用**对讲机**聊天的人，一个说一句（一行 JSON），另一个回一句。这种方式简单、稳定、不需要网络端口。

---

## 第 2 站：一句话说清它是干嘛的

> **db-mcp 是一个"翻译官团队"，让 AI 用同一套简单指令，就能操作 8 种完全不同类型的数据库。**

这 8 种数据库是：
- 7 种"SQL 数据库"：`PostgreSQL`、`MySQL`、`SQLite`、`SQL Server`、`ClickHouse`、`DuckDB`、`Oracle`
- 1 种"NoSQL 数据库"：`MongoDB`

### 翻译官比喻

世界上有 8 个数据库，它们**各说各的方言**：

- Oracle 说"Oracle 语"，查询要写 `SELECT 1 FROM DUAL`；
- SQLite 说"SQLite 语"，查表要问 `sqlite_master`；
- MongoDB 根本不用 SQL，它用一种叫"文档"的东西……

AI 不可能学会 8 种方言。于是 db-mcp 做了两件事：

1. **统一对外接口**：AI 只需要说一种"普通话"（MCP 工具调用），比如"帮我执行这条 SQL"。
2. **内部翻译**：项目里有一个"翻译官团队"（`drivers.js`），每个翻译官精通一种数据库方言，把"普通话"翻译给对应的数据库听，再把结果翻译回来给 AI。

---

## 第 3 站：为什么需要它

### 没有它的时候

- AI 不认识你的数据库，你只能自己手动打开数据库软件、写 SQL、导数据，再复制粘贴给 AI。
- 每换一种数据库，就要重新学一套连接方法。

### 有了它以后

- AI 直接在对话里说"查一下用户表有多少行"，程序自动连库、执行、把结果返回给 AI。
- 换数据库？只要改一行配置，AI 的用法完全不变。

### 它额外解决的几个现实问题

| 问题 | 它怎么解决 |
|------|-----------|
| 数据库账号密码不能直接写在代码里 | 单独放一个"登记本"（`config.db`），代码和账号分离 |
| 有十几个数据库，AI 怎么知道该查哪个 | 每个数据库都强制写一段"用途说明"（`description`），AI 先看说明再决定 |
| 有的数据库连不上，别让整个程序卡死 | 加"超时保护"，5 秒连不上就报告"不可达" |
| 有些查询是只读的，不能随便删数据 | 给每个工具贴"只读/可写"标签，让 AI 知道风险 |
| Oracle 老版本连接特别麻烦 | 专门支持"客户端目录"配置（后文详解） |

---

## 第 4 站：整体地图

先看一张全景图，把整个项目想象成一家**翻译中心**：

```
        ┌──────────────────────────────┐
        │   AI 软件（MCP 客户端）        │   例：OpenCode / Claude
        │  "帮我查一下用户表"           │   —— 来办事的顾客，只会提需求
        └──────────────┬───────────────┘
                       │  ① 用 MCP 协议（JSON-RPC / 对讲机）
                       │     通过 stdio（标准输入输出）传一句话
                       ▼
        ┌──────────────────────────────┐
        │   index.js  ← 总服务台        │   ★ 项目的主程序（入口）
        │  - 接待请求、核对参数          │
        │  - 分发给对应工具              │
        │  - 决定连哪个数据库            │
        └───────┬──────────────┬────────┘
                │              │
     ② 查登记本  │              │ ③ 找翻译官
                ▼              ▼
   ┌────────────────────┐  ┌──────────────────────────┐
   │ config-store.js    │  │ drivers.js               │
   │ 登记本管理员        │  │ 翻译官团队（8 个翻译官）   │
   │ 读写 config.db      │  │ 每种数据库一个            │
   └─────────┬──────────┘  └────────────┬─────────────┘
             │                          │
             ▼                          │ ④ 用对方听得懂的方言交流
   ┌────────────────────┐                │
   │ config.db (SQLite) │                │
   │ 存着：哪个库、地址、 │                │
   │ 账号、用途说明       │                │
   └────────────────────┘                │
                                         ▼
                    ┌────────────────────────────────────────┐
                    │  各种数据库（分散在不同机器/文件里）       │
                    │  PostgreSQL │ MySQL │ SQLite │ Oracle   │
                    │  SQL Server │ ClickHouse │ DuckDB │ MongoDB │
                    └────────────────────────────────────────┘

   另一个入口（可选）：
   ┌────────────────────┐
   │ web.js + admin.html│  可视化后台：用浏览器点点点改配置，
   │ 配置网页（127.0.0.1:3777）│ 底层读写的还是同一个 config.db
   └────────────────────┘
```

### 一句话记住这张图

> **AI 说话 → 总服务台（index.js）接单 → 查登记本（config-store）知道连谁 → 找翻译官（drivers）翻译 → 数据库干活 → 原路返回。**

---

## 第 5 站：文件清单速览

把项目当成一家餐厅，每个文件都有自己的岗位：

| 文件 | 岗位 | 餐厅比喻 | 一句话职责 |
|------|------|----------|-----------|
| `package.json` | 采购清单 | **菜单/进货单** | 记录项目依赖了哪些外部库和 npm 脚本 |
| `index.js` | 主程序（入口） | **前台 + 调度经理** | 启动 MCP 服务、注册工具、接收并分发请求 |
| `drivers.js` | 驱动注册表 | **后台翻译官团队** | 每种数据库一个"翻译官"，统一接口 |
| `config-store.js` | 配置读写库 | **档案管理员** | 把配置存进 SQLite、读出来、做数据迁移 |
| `web.js` | 网页后台服务 | **经理办公室（可视化）** | 提供网页界面改配置、测试连接 |
| `public/admin.html` | 网页后台页面 | **办公室里的操作台** | 浏览器里看到的那个管理页面 |
| `config.db` | 配置文件（SQLite） | **登记本** | 真正存放数据库地址和账号的地方 |
| `AGENTS.md` | 开发说明 | **员工手册** | 给 AI/开发者看的维护和排错说明 |
| `start.bat` / `start.ps1` | 启动脚本 | **开门营业的开关** | 一键启动服务 |
| `oci/` | Oracle 客户端文件 | **Oracle 专用翻译设备** | 连接老版本 Oracle 必须带的工具包 |

---

## 第 6 站：逐个文件拆解

### 6.1 `package.json` —— 点菜单

这是每个 Node.js 项目的"身份证 + 采购清单"。零基础只要看懂三块：

```json
{
  "name": "db-mcp",                 // 项目名字
  "type": "module",                 // 用现代模块化写法（import/export）
  "scripts": {                      // 可以用 npm 运行的快捷命令
    "mcp": "node index.js",         //   npm run mcp  → 启动 MCP 服务
    "web": "node web.js"            //   npm run web  → 启动配置网页
  },
  "dependencies": {                 // 依赖的"外部零件"
    "@modelcontextprotocol/sdk": "...", // MCP 官方工具包（Core）
    "pg": "...", "mysql2": "...",       // 各类数据库的" drivers / 驱动"
    "oracledb": "...", "mongodb": "...",
    "zod": "...",                       // 参数校验工具（检查输入对不对）
    "vue": "...", "element-plus": "..." // 网页后台的界面库
  }
}
```

**人话翻译**：这个文件告诉电脑——"这个项目叫什么、运行时需要哪些零件、有哪些快捷启动命令"。`npm install` 就是按这张清单把零件买回来（装到 `node_modules` 文件夹）。

---

### 6.2 `index.js` —— 总服务台（最重要）

这是整个项目的**主程序**，也是 Zero 基础读者最该花时间理解的文件。我们分几段看。

#### (A) 启动时先决定"去哪查登记本"

```js
function resolveConfigSource() {
  const arg = process.argv[2];
  if (arg && /\.json$/i.test(arg)) return { kind: "json", path: arg };
  if (arg && /\.(db|sqlite|sqlite3)$/i.test(arg)) return { kind: "sqlite", path: arg };
  return { kind: "sqlite", path: process.env.DB_CONFIG_SQLITE || join(__dirname, "config.db") };
}
```

**人话翻译**：程序一开机先问自己："账号密码这些配置放哪？"

- 如果启动时传了一个 `.db` 文件 → 用那个 SQLite 文件；
- 如果传了一个 `.json` 文件 → 用老式的 JSON 文件（兼容旧版本）；
- 都没传 → 默认用项目目录下的 `config.db`。

> 这就是为什么每个项目可以有一份**独立的** `config.db`：通过环境变量 `DB_CONFIG_SQLITE` 指向不同文件，避免多个项目的同名数据库配置互相覆盖。

#### (B) 创建一个"服务台"并"插上插座"

```js
const server = new McpServer({ name: "db-mcp", version: "0.2.0" });
// ...最后一行：
await server.connect(new StdioServerTransport());
```

**人话翻译**：

- `new McpServer(...)`：盖一个"服务台"（MCP 服务器实例）。
- `server.connect(new StdioServerTransport())`：把这个服务台接到"对讲机"上，开始营业，等待 AI 说话。

#### (C) 核心动作：注册"工具"

AI 能用的每一项能力，都要先在这里"登记"。看最关键的工具 `query`（执行 SQL）：

```js
server.registerTool(
  "query",                          // 工具的名字
  {                                 // 第二参数：工具说明书
    title: "Execute SQL query",
    description: "...",             // 给 AI 看的功能描述
    inputSchema: {                  // 参数规则（用 zod 定义）
      type: dbTypeSchema.optional(),        // 数据库类型，可选
      datasource: z.string().optional(),    // 数据源名字，可选
      connectionString: z.string().optional(), // 直连字符串，可选
      sql: z.string(),                      // SQL 语句，必填
    },
    annotations: { readOnlyHint: false, openWorldHint: true }, // 风险标签
  },
  async ({ type, datasource, connectionString, sql }) => {      // 第三参数：真正干活的函数
    // 1. 参数检查
    // 2. 找到对应的数据库连接池
    // 3. 调用翻译官执行 SQL
    // 4. 把结果包装返回
  },
);
```

**一个工具 = 三样东西**：

| 部分 | 作用 | 比喻 |
|------|------|------|
| 工具名 `query` | 唯一标识 | 服务项目的编号 |
| 说明书（描述 + 参数规则 + 标签） | 告诉 AI "这个工具干嘛、要填什么、安不安全" | 窗口挂的**办事指南** |
| 处理函数 | 真正执行的代码 | 窗口背后的**办事员** |

**关于参数校验（zod）**：`z.string()` 表示"这里必须是一段文字"，`optional()` 表示"可以不填"。AI 传来的参数如果不符合规则，会被拦下来，避免乱七八糟的输入搞坏程序。

**关于风险标签（annotations）**：

- `readOnlyHint: true` = "这个工具只查不改，安全"；
- `readOnlyHint: false` = "这个工具可能会改数据，小心"；
- `openWorldHint: true` = "会连到外部网络"。

AI 看到这些标签，就能判断操作风险。

#### (D) 项目里到底注册了多少工具？

一共 **13 个**，分两组：

**通用/配置类（7 个）：**

| 工具名 | 作用 | 只读？ |
|--------|------|--------|
| `query` | 执行任意 SQL（增删改查都行） | 否 ⚠️ |
| `list_tables` | 列出数据库里所有表 | 是 |
| `describe_table` | 看某张表有哪些列 | 是 |
| `list_datasources` | 列出所有已配置的数据库 | 是 |
| `config_get` | 查看当前配置 | 是 |
| `config_set` | 修改配置（覆盖写入） | 否 ⚠️ |
| `test_datasources` | 测试每个数据库能不能连上 | 是 |

**MongoDB 专用（6 个）：** 因为 MongoDB 不用 SQL，所以单独做了一套：

`mongo_list_collections`（列集合）、`mongo_find`（查文档）、`mongo_aggregate`（聚合统计）、`mongo_insert`（插入）、`mongo_update`（更新）、`mongo_delete`（删除）。

#### (E) 两种"找到数据库"的方式

总服务台接到请求后，要先搞清楚"连哪个库"。代码提供了**两条路**：

```js
async function resolvePool({ type, datasource, connectionString }) {
  if (connectionString) {
    // 路线①：直接给一整串连接串，程序从前缀猜出数据库类型
    const { type: t, url } = parseConnectionString(connectionString);
    // ...
  }
  // 路线②：给 type + 数据源名字，去 config.db 登记本里查地址
  const pool = await getPool(type, datasource);
  return { pool, type };
}
```

**人话翻译**：

- **路线①"免配置模式"**：你直接甩给它一整串地址，比如 `postgres://user:pass@db.example.com:5432/mydb`。程序看开头的 `postgres://` 就知道"哦这是 PostgreSQL"，立刻去连。**不用事先登记**。
  - 各种前缀的对应关系：`postgres://`→PostgreSQL，`mysql://`→MySQL，`sqlite:xxx.db`→SQLite，`oracle://`/`oracles://`→Oracle，`mongodb://`→MongoDB，`http(s)://`→ClickHouse……（`clickhouse://` 会被自动转换成 `http://`）

- **路线②"登记本模式"**：你只说"我要连 postgres 类型下叫 master 的那个库"，程序就去 `config.db` 里查 `master` 对应的地址、账号。**适合经常用、需要统一管理的库**。

#### (F) 连接池：为什么要"懒加载"

```js
const pools = {};  // 缓存所有已经建好的连接
async function getPool(type, datasource) {
  const key = `${type}:${datasource}`;
  if (!pools[key]) {                 // 只有第一次才真正创建
    const url = dsUrl(type, datasource);
    // ... 创建连接池 ...
    pools[key] = await driver.createPool(url);
  }
  return pools[key];                 // 以后都复用
}
```

**连接池比喻**：每次查数据库都要"打电话拨号"，如果每次都重新拨号会很慢。于是建立一个"**长期值班的专线**"，第一次用的时候才接通（懒加载 = 用时才建），之后大家都复用这条线，速度快很多。

`pools` 这个字典就是"所有已接通专线的登记册"，key 是 `类型:数据源名`。

#### (G) 程序结束时要"挂断所有电话"

```js
function closeAll() {
  for (const key of Object.keys(pools)) {
    const d = poolDriver[key];
    if (d && d.close) d.close(pools[key]).catch?.(() => {});
  }
  if (configDb) configDb.close();
}
process.on("exit", closeAll);
process.on("SIGINT", () => { closeAll(); process.exit(0); });
```

**人话翻译**：程序退出时（正常退出、或用户按 Ctrl+C），把所有数据库连接和登记本都妥善关闭，避免留下"没挂断的电话"。

---

### 6.3 `drivers.js` —— 翻译官团队

这是第二个最重要的文件。它解决了核心难题：**8 种数据库方言不一样，怎么给 AI 一个统一的接口？**

答案是：给每个数据库做一个"翻译官"（一个对象），所有翻译官都遵守**同一份工作规范**，提供 5 个固定方法：

```js
// 文件开头注释里写明的"规范"：
// 每个 SQL 驱动必须实现：
//   createPool(url)                     —— 连接数据库，建立专线
//   execQuery(pool, sql)               —— 执行一条 SQL
//   listTables(pool, {schema})         —— 列出所有表
//   describeTable(pool, {table,schema})—— 看表结构
//   close(pool)                        —— 关闭连接
```

**规范比喻**：不管哪个国家的翻译官，都必须会做这 5 件事（接电话、翻译问句、翻译清单、翻译表结构、挂电话）。这样总服务台（index.js）就不用关心对方是哪国人，只要喊"翻译官，执行这 5 件事之一"即可。

#### (A) 一个翻译官长什么样（以 PostgreSQL 为例）

```js
const postgres = {
  async createPool(url) {
    const { default: pg } = await import("pg");       // 搬出 PostgreSQL 专用工具
    return new pg.Pool({ connectionString: url });    // 建一个连接池
  },
  async execQuery(pool, sql) {
    const result = await pool.query(sql);             // 用它的方式执行 SQL
    return { rows: result.rows, fields: ..., rowCount: result.rowCount };
  },
  async listTables(pool, { schema }) {
    // PostgreSQL 查"有哪些表"要问 information_schema 这个系统表
    const r = await pool.query(
      "SELECT table_name AS name ... FROM information_schema.tables WHERE table_schema = $1",
      [s],
    );
    return r.rows;
  },
  // describeTable / close ...
};
```

**人话翻译**：这位翻译官精通 PostgreSQL 方言。比如"列出所有表"，在 PostgreSQL 里要查询一个叫 `information_schema.tables` 的系统目录，它就负责写这句正确的"方言"。

#### (B) 不同翻译官的方言差异（这正是本项目的价值）

| 数据库 | "列出所有表"的方言 | 特殊之处 |
|--------|-------------------|----------|
| PostgreSQL | 查 `information_schema.tables` | 用 `$1` 占位符传参数 |
| MySQL | `SHOW TABLES` | 用 `??` 占位符 |
| SQLite | 查 `sqlite_master` 系统表 | 用 Node 22 内置的 `node:sqlite`，**不用额外驱动** |
| SQL Server | 查 `information_schema.tables` | 用 `@schema` 命名参数 |
| ClickHouse | `SHOW TABLES` | 走 **HTTP 接口**，不是传统数据库连接 |
| DuckDB | 查 `information_schema.tables` | 本地文件/内存数据库，回调式 API |
| Oracle | 查 `user_tables` | 必须 **Thick 模式 + Instant Client**（下文详解） |

> 注意看：每种数据库的写法都不一样。如果没有这层"翻译官"，AI 就得针对每种数据库写不同的指令——这正是本项目帮我们屏蔽掉的复杂度。

#### (C) 注册表模式：加一种数据库有多简单

```js
const SQL_DRIVERS = {
  postgres, mysql, sqlite, sqlserver, clickhouse, duckdb, oracle,
};

export function getSqlDriver(type) {
  const d = SQL_DRIVERS[type];
  if (!d) throw new Error(`Unsupported database type: ${type}`);
  return d;
}

export const SQL_TYPES = Object.keys(SQL_DRIVERS);  // 自动得到支持的类型列表
```

**人话翻译**：所有翻译官登记在一张名单 `SQL_DRIVERS` 上。总服务台说"给我 PostgreSQL 翻译官"，就从名单里取。好处是：

- `SQL_TYPES`（支持哪些数据库）是**自动**从名单里算出来的，不用手写。
- 以后想加第 9 种数据库？只要写一个新翻译官对象，往 `SQL_DRIVERS` 里加一行——**index.js 里基于 `SQL_TYPES` 的校验会自动支持它，几乎不用改主程序**。这就是"注册表模式"的威力。

#### (D) 为什么 Oracle 这么特殊？

代码里 Oracle 翻译官有一大段"初始化客户端目录"的逻辑：

```js
let oracleLibDir = undefined;
export function setOracleClientLibDir(dir) { oracleLibDir = dir; }

_ensureInit(oracledb) {
  if (oracleInitialized) return;
  if (oracleLibDir) oracledb.initOracleClient({ libDir: oracleLibDir }); //  Thick 模式
  oracleInitialized = true;
}
```

**人话翻译**：老版本的 Oracle（11g、12c）有个怪脾气——用普通的"轻量模式（Thin）"连不上，必须加载 Oracle 官方提供的**本地客户端程序（Instant Client）**才能连。项目在 `oci/` 目录下自带了两个版本（`11.2.0.4` 和 `12.2.0.1`），配置里给某个 Oracle 数据源指定用哪个目录，程序在连它之前就先把这套"专用设备"装上。

另外，Oracle 的连接串还区分：
- `oracle://.../服务名`（service name，12c+ 常用）
- `oracles://.../SID`（SID，11g 常用，用冒号分隔）

---

### 6.4 `config-store.js` —— 登记本管理员

这个文件负责把配置信息**存进 SQLite 数据库**（`config.db`）并读出来。

#### (A) 为什么把配置存在一个 SQLite 里，而不是直接写个 JSON 文件？

早期版本确实用 JSON 文件。后来改成 SQLite，主要因为：

- 结构化、可按字段查询和迁移；
- 每个项目一份独立的 `.db` 文件，互不干扰；
- 网页后台和 MCP 服务可以安全地读写同一份配置。

`config.db` 里只有一张表 `datasources`，列包括：类型、名字、主机、端口、数据库名、账号、密码、文件路径、Oracle 客户端目录、默认 schema、用途说明、是否启用。

#### (B) 一个关键设计：每个数据源必须写"用途说明"

```js
export function writeConfig(db, cfg) {
  // ...
  const desc = entryDesc(raw) ?? prevDesc[`${type}/${name}`] ?? null;
  // description 必填：它告诉 AI 该查哪个库
  if (!desc || !String(desc).trim()) {
    throw new Error(`数据源 ${type}/${name} 缺少必填的 description（用途描述）。请先填写描述再保存。`);
  }
  // ...
}
```

**人话翻译**：登记本要求每一条记录都必须写清楚"这个库是干嘛的"。因为 AI 面对十几个库时会先读这些说明，才能判断"用户问的是订单，我该查订单库而不是用户库"。所以**没写说明就不让保存**——这是给人看的提示，不是给机器看的。

#### (C) 连接串的"拆解"与"拼装"

配置对象里存的是完整连接串（如 `postgres://user:pass@host:5432/db`），但表格里是拆开的列。`parseConnString` / `buildConnString` 就是做这个转换的：

```
postgres://user:pass@host:5432/mydb
  拆解 ↓
  type=postgres, user=user, password=pass, host=host, port=5432, database=mydb
  拼装 ↓
  （还原回原连接串）
```

**为什么拆开存？** 方便网页后台分开编辑"主机""端口""账号"等字段，也方便以后单独改某一项。

#### (D) `migrateConfig`：数据迁移

```js
export function migrateConfig(db) { /* ... */ }
```

**人话翻译**：这是个"房屋翻新"函数。项目历史上改过几次配置存储格式（从旧表、旧 JSON 迁到现在的分列结构）。这个函数每次启动都检查一遍：

- 如果发现旧格式的数据，就自动转换成新格式；
- 如果缺了某些列（比如新加的 `description`、`enabled`），就自动补上；
- 最后删掉废弃的旧表。

这样老用户升级后不用手动搬家，程序自己就把数据整理好了。

---

### 6.5 `web.js` + `public/admin.html` —— 可视化后台

这两个文件提供了一个**可选**的网页管理界面（本机浏览器访问 `http://127.0.0.1:3777/`）。

`web.js` 用 Node 自带的 `http` 模块起了一个小网站，提供几个"接口"：

| 网页地址 | 作用 |
|----------|------|
| `GET /api/config` | 读取当前配置 |
| `POST /api/config` | 保存新配置 |
| `POST /api/test` | 测试某个数据库能否连上 |
| `POST /api/dirs` | 浏览服务器文件夹（给 Oracle 客户端目录用） |
| `GET /` | 打开管理页面 `admin.html` |

**关键点**：网页后台读写的也是**同一个 `config.db`**，和 MCP 服务共享配置。所以你在网页上改完配置，MCP 服务下次连接就能用上（注意：已建立的连接不会重建，见"踩坑"部分）。

网页前端用了 `vue` 和 `element-plus`，但**没有用 CDN**——代码里专门做了限制，只允许加载本地 `node_modules` 里的构建产物。好处是**完全离线可用、不依赖外网**。

---

## 第 7 站：跟着一个请求走完全程

让我们讲一个完整的故事。假设你在 AI 对话框里说：

> "帮我看看 master 这个库里有多少张表。"

AI 决定调用 `list_tables` 工具，于是发生下面这 12 步：

```
① AI 通过 stdio（对讲机）发来一行 JSON：
   { "tool": "list_tables", "arguments": { "type": "postgres", "datasource": "master" } }

② index.js 的 McpServer 收到消息，找到登记过的 list_tables 工具。

③ zod 按 inputSchema 检查参数：
   type 是合法的数据库类型吗？datasource 是文字吗？→ 检查通过。

④ 处理函数开始执行。先校验：
   没给 connectionString，那 type 和 datasource 必须都有 → 有了，继续。

⑤ 调用 resolvePool({ type: "postgres", datasource: "master" })。

⑥ 因为没给连接串，走"登记本模式"，调用 getPool("postgres", "master")。
   拼接 key = "postgres:master"。

⑦ 查缓存 pools["postgres:master"] —— 第一次没有，于是：
   a. dsUrl() 去 config 里取出 master 的连接串；
   b. 不是 oracle，跳过客户端目录设置；
   c. getSqlDriver("postgres") 从注册表里取出 PostgreSQL 翻译官；
   d. 调用翻译官的 createPool(url) 建立连接池，存入缓存。

⑧ resolveSchema() 决定用哪个 schema：
   这里没指定，配置里也没写 defaultSchema，
   PostgreSQL 默认用 "public"。

⑨ 调用 PostgreSQL 翻译官的 listTables(pool, { schema: "public" })。

⑩ 翻译官用 PostgreSQL 方言执行：
   SELECT table_name ... FROM information_schema.tables WHERE table_schema = 'public'

⑪ 数据库返回结果，翻译官整理成统一格式 [{ name, schema }, ...]。

⑫ index.js 把结果包装成 MCP 规定的格式（content + structuredContent），
   通过 stdio 发回给 AI。AI 拿到结果，用人话回答你："这个库里有 23 张表。"

   全程结束。连接池留在缓存里，下次再用直接复用。
```

### 这个故事说明了什么

- **AI 全程只说"普通话"**（一个工具名 + 几个参数），完全不知道底层是 PostgreSQL、要查 `information_schema`。
- **总服务台负责流程**：校验、路由、包装。
- **翻译官负责方言**：把统一请求变成数据库的正确语法。
- **登记本负责记忆**：地址、账号都从配置来，不写死在代码里。

---

## 第 8 站：关键设计思想

读源码时，理解"为什么这么写"比"写了什么"更重要。这里提炼 7 个设计思想。

### 8.1 接口统一 + 注册表模式
所有数据库驱动遵守同一套 5 方法规范，集中登记在 `SQL_DRIVERS`。新增数据库几乎不用改主程序。**这是整个项目最核心的设计。**

### 8.2 懒加载（Lazy Loading）
连接池、翻译官都是"第一次用到才创建"，之后缓存复用。既省资源又快。

### 8.3 配置与代码分离
账号密码、地址全放在 `config.db`，代码里没有硬编码。安全、灵活、可独立管理。

### 8.4 免配置模式与登记本模式并存
既能"随手给个连接串就查"（临时、方便），也能"登记好长期使用"（统一、可管理）。`connectionString` 优先级最高。

### 8.5 强制 description
把"给人看的说明"变成"必填字段"，帮助 AI 做决策。这是**为 AI 用户体验服务**的设计。

### 8.6 风险标签 + 超时保护
`readOnlyHint` 让 AI 知道哪些操作危险；`test_datasources` 里每个探测都包了 5 秒超时（"统计一下"那句 `summary` 会告诉你几个能连、几个不能），避免一个连不上的库把整个程序拖死。

### 8.7 向后兼容与自迁移
`migrateConfig` 每次启动自动整理旧数据；配置既支持新的对象格式 `{ url, description }`，也兼容旧的纯字符串格式。**升级不折腾用户。**

---

## 第 9 站：实战工作坊（亲手跑起来）

> 前面 8 站是"看懂"，这一站是"**做出来**"。
> 案例如果不能亲手验证，就只是故事。这里有一条命令就能跑的真实验。

### 9.1 一条命令，立刻开跑

前提只有一个：**Node.js 22 或更高版本**（本项目用到了 Node 22 内置的 `node:sqlite`）。
在项目根目录（能看到 `index.js` 的那一层）打开终端：

```bash
node -v                              # 先确认版本：应显示 v22.x 或更高
node examples/practice.mjs           # 推荐：连底层协议一起看（教学价值最高）
node examples/practice.mjs --quiet   # 或：只看每一步的结果，不看原始 JSON
```

配套的 `examples/practice.mjs` 会**自动启动本项目**，然后假装自己是 AI 客户端，通过 stdio（对讲机）跟服务对话。你不需要装任何数据库、不需要配置文件、不需要 MCP 客户端软件。
（脚本用法详见 [`examples/README.md`](../examples/README.md)）

### 9.2 你会真实看到什么

服务启动后，脚本会一步步打印，每步都有"💡 人话解释"。关键片段如下（**这是真实运行结果，不是编的**）：

```
▶ 第 1 步：看看有哪些工具可用（tools/list）
💡 这就是 AI 眼里'这个服务能帮我做什么'的清单。
   ✅ 共 13 个工具：query, list_tables, describe_table, list_datasources, ...

▶ 第 4 步：查询数据（query）——看统一返回格式
   ✅ 结果： {"rows":[{"id":1,"name":"小明","score":90},{"id":2,"name":"小红","score":95}],
             "fields":[{"name":"id"},{"name":"name"},{"name":"score"}],"rowCount":2}

▶ 第 5 步：列出所有表（list_tables）
   ✅ 结果： {"tables":[{"name":"student"}]}

▶ 第 7 步：读一下登记本：有哪些已配置数据源（list_datasources）
   ✅ 已登记 10 个数据源（按类型分组）：mysql, oracle, postgres, sqlite
```

**重点观察第 4 步的返回结构**：`rows`（数据行）、`fields`（列信息）、`rowCount`（行数）。这就是 6.3 节讲的"统一接口"——换成 MySQL、Oracle，这个结构**一模一样**。

> 默认模式下，每步还会打印 `[对讲机·发出]` / `[对讲机·收到]` 的原始 JSON。
> 那一行行 JSON，就是第 1 站说的"对讲机里的话"、第 7 站故事里的 ①②⑫——你现在能亲眼看到它们了。

### 9.3 每一步在验证文档的哪个概念

| 练习步骤 | 你亲手验证的概念 | 对应章节 |
|----------|-----------------|----------|
| 第 0 步 握手 | MCP 是什么、stdio 对讲机 | 第 1 站 / 6.2(B) |
| 第 1 步 列工具 | 13 个工具、工具注册机制 | 6.2(C)(D) |
| 第 2~4 步 建表/插入/查询 | 免配置模式、统一返回格式、翻译官 | 6.2(E) / 6.3 / 第 7 站 |
| 第 5 步 列所有表 | 只读工具、SQLite 方言 | 6.3(A)(B) |
| 第 6 步 看表结构 | `describe_table` 工具 | 6.2(D) |
| 第 7 步 列数据源 | `description` 必填、登记本 | 6.4(A) |
| 第 8 步 读配置 | 配置与代码分离 | 6.4 / 6.5 |

### 9.4 数据是真的落地了

运行后会在 `examples/` 下生成 `demo.db`，里面真有那张 `student` 表和小明、小红两行数据。用任意 SQLite 工具打开它执行 `SELECT * FROM student` 就能看到——**这不是打印出来的假象，是真实写进文件的数据**。

### 9.5 进阶挑战（在能跑的基础上继续）

**挑战 1：改 SQL 自己玩**
打开 `examples/practice.mjs`，找到第 2~4 步的 `sql`：
- 把 `student` 换成你自己的表名和字段；
- 在第 4 步查询里加 `WHERE score > 90`，看返回怎么变；
- 把 `--quiet` 去掉，对比两种模式，理解协议细节。

**挑战 2：感受"配置分离"**
1. 脚本第 7、8 步读的是项目自带的 `config.db`。用任意 SQLite 工具打开它，`SELECT * FROM datasources`，能看到配置被拆成很多列——这就是 6.4 节的"登记本"。
2. 想想为什么 `config_set` 要求写 `description`：AI 面对十几个库，靠这段说明判断该查哪个。

**挑战 3（较高难度）：加一种新数据库**
按清单操作，体会"注册表模式"的扩展成本有多低：
1. 确认 `node_modules` 里有对应驱动（没有就 `npm install 驱动名`）；
2. 在 `drivers.js` 里仿照 `postgres` 写一个新对象，实现那 5 个方法；
3. 把它加进 `SQL_DRIVERS` 字典；
4. `SQL_TYPES` 会自动包含它，`index.js` 的 `query` 校验也自动支持——**无需改主程序**；
5. 重启 MCP 服务（配置和驱动都在启动时加载）。

---

## 第 10 站：常见报错与排查

| 现象 | 可能原因 | 怎么办 |
|------|----------|--------|
| 启动时报 `ExperimentalWarning: SQLite` | Node 22 的 SQLite 还是实验特性 | **无害**，忽略即可 |
| 连 Oracle 报 `NJS-138` | 没加载 Instant Client（Thick 模式） | 给该数据源配 `oracleClientLibDir`，指向 `oci/` 下的目录 |
| `test_datasources` 显示 unreachable | 数据库没启动 / 地址账号错 / 网络不通 | 看返回的 `error` 字段第一行，通常是连接超时或认证失败 |
| 改了配置但查询还用旧的 | 连接池是懒加载且缓存的，已有连接不会重建 | **重启 MCP 服务**后再试 |
| 保存配置被拒，提示缺少 description | 必填校验触发 | 给该数据源补上用途说明文字 |
| `Cannot infer database type from scheme` | 连接串前缀不认识 | 用标准前缀，如 `postgres://`、`oracle://`、`mongodb://` |
| MongoDB 的查询没反应 | MongoDB 不用 `query` 工具 | 改用 `mongo_find` 等 6 个专用工具 |
| 网页后台打不开 | 没启动 `npm run web`，或端口被占用 | 运行 `npm run web`，或设 `PORT` 换端口 |

> 排错心法：**先看报错信息的第一行**（代码里很多地方故意只保留第一行，就是为了方便定位），再对照上面的表和前文对应章节。

---

## 第 11 站：速查表

### 11.1 13 个工具一览

| 工具 | 类别 | 一句话 | 只读 |
|------|------|--------|------|
| `query` | SQL | 执行任意 SQL | ❌ |
| `list_tables` | SQL | 列出所有表 | ✅ |
| `describe_table` | SQL | 查看表结构 | ✅ |
| `list_datasources` | 配置 | 列出所有数据源 | ✅ |
| `config_get` | 配置 | 读取当前配置 | ✅ |
| `config_set` | 配置 | 覆盖写入配置 | ❌ |
| `test_datasources` | 配置 | 测试连接连通性 | ✅ |
| `mongo_list_collections` | MongoDB | 列出集合 | ✅ |
| `mongo_find` | MongoDB | 查询文档 | ✅ |
| `mongo_aggregate` | MongoDB | 聚合统计 | ✅ |
| `mongo_insert` | MongoDB | 插入文档 | ❌ |
| `mongo_update` | MongoDB | 更新文档 | ❌ |
| `mongo_delete` | MongoDB | 删除文档 | ❌ |

### 11.2 连接串前缀速查

| 前缀 | 数据库 | 备注 |
|------|--------|------|
| `postgres://` / `postgresql://` | PostgreSQL | |
| `mysql://` | MySQL | |
| `sqlite:文件路径` | SQLite | 如 `sqlite:./local.db` |
| `sqlserver://` / `mssql://` | SQL Server | |
| `clickhouse://` / `http://` / `https://` | ClickHouse | `clickhouse://` 自动转 `http://` |
| `duckdb:文件路径` | DuckDB | |
| `oracle://` | Oracle（服务名） | 12c+ |
| `oracles://` | Oracle（SID） | 11g |
| `mongodb://` / `mongodb+srv://` | MongoDB | 用专用工具 |

### 11.3 术语表（再复习一遍）

- **MCP**：让 AI 调用外部工具的标准协议。
- **MCP 服务器**：本项目，负责干活。
- **MCP 客户端**：AI 软件，负责提需求。
- **工具（Tool）**：服务器提供的一项能力。
- **stdio**：用标准输入输出当"对讲机"传消息。
- **驱动（Driver）**：针对某种数据库的专用"翻译官"。
- **连接池**：复用的数据库连接"专线"。
- **懒加载**：用到时才创建。
- **注册表模式**：把各种实现集中登记，按需取用，方便扩展。
- **Thick 模式 / Instant Client**：老版本 Oracle 必须加载的本地客户端。
- **schema**：数据库里的"命名空间/分组"，PostgreSQL 默认是 `public`。

---

## 结语

现在回头看，"让 AI 能查任何数据库"这件看似复杂的事，拆开后其实就三层：

1. **一层标准接口**（MCP 工具）——让 AI 会说普通话；
2. **一层翻译团队**（drivers）——把普通话翻译成 8 种数据库方言；
3. **一层配置管理**（config-store + config.db）——记住连谁、怎么连、用途是什么。

再加上"懒加载的连接池、超时保护、风险标签、自迁移"这些工程上的打磨，就构成了一个**既好用又健壮**的中间件。

希望这份案例让你明白：**所谓"高深的技术"，拆开了不过是一个个解决具体问题的小设计。** 祝你读得开心，改得顺手！

---

> 📌 想深入某一部分？推荐对照源码阅读：
> - 主流程 → `index.js`
> - 翻译官 → `drivers.js`
> - 配置存储 → `config-store.js`
> - 网页后台 → `web.js` / `public/admin.html`
> - 维护与排错 → `AGENTS.md`
