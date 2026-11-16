# 贡献指南

欢迎提 Issue 和 PR！

## 开发环境

- Node.js 22+（用到内置 `node:sqlite`）
- `npm install`

启动：`npm run mcp`（服务）/ `npm run web`（配置台）。
零基础的话，先跑一遍 `node examples/practice.mjs` 看完整流程。

## 代码结构

| 文件 | 职责 |
|------|------|
| `index.js` | MCP 服务入口：注册工具、校验参数、路由请求、包装返回值 |
| `drivers.js` | 驱动注册表：每种数据库一个"翻译官"，统一实现 5 个方法 |
| `config-store.js` | 配置读写与迁移，持久化到 `config.db` |
| `web.js` / `public/admin.html` | 配置台（Node 内置 http + 本地 Vue/Element-Plus） |

## 加一种新数据库

1. 安装对应 npm 驱动。
2. 在 `drivers.js` 里仿照现有对象实现这 5 个方法：

   ```js
   createPool(url), execQuery(pool, sql),
   listTables(pool, { schema }),
   describeTable(pool, { table, schema }),
   close(pool)
   ```

   `execQuery` 统一返回 `{ rows, fields, rowCount }`。
3. 把对象加进 `SQL_DRIVERS`。`SQL_TYPES` 会自动包含它，`index.js` 的工具校验也随之支持——**无需改主程序**。
4. 如需免配置直连，在 `index.js` 的 `parseConnectionString()` 里加 scheme → type 映射。
5. 更新 README 的数据库表格；有必要的话给 `public/admin.html` 的图标映射加一张图。

## 加一个工具

在 `index.js` 里用 `server.registerTool(name, schema, handler)` 注册：

- 写清楚 `description`（这是给 AI 看的）；
- 用 zod 定义 `inputSchema`；
- 用 `annotations.readOnlyHint` 标明是否有写操作；
- 记得在 README 的工具清单里补一行。

## 提交前检查

- **不要提交任何 `*.db` 文件**（可能含真实凭证）——`.gitignore` 已默认忽略。
- 不要提交 `node_modules/`、`oci/` 下的二进制。
- 新增数据源配置示例时，`description` 是必填的，且只能写占位信息。
- 中文文档保持 UTF-8 编码。

## PR 描述

请说明：改了什么、为什么、怎么验证（最好附一条 `examples/practice.mjs` 的输出或截图）。
