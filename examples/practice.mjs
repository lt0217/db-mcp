#!/usr/bin/env node
/**
 * ============================================================================
 * db-mcp 实战练习脚本（零基础友好）
 * ============================================================================
 * 这个脚本会：
 *   1. 自动启动本项目（index.js）作为一个 MCP 服务
 *   2. 像 AI 客户端一样，通过"对讲机"（stdio）和服务对话
 *   3. 一步步演示：握手 -> 看有哪些工具 -> 真实建表/插入/查询 -> 读配置
 *   4. 把每一步收发的原始 JSON 都打印出来，让你看清"对讲机里到底说了啥"
 *
 * 运行方式（在项目根目录）：
 *   node examples/practice.mjs           # 显示底层协议细节（推荐，教学用）
 *   node examples/practice.mjs --quiet   # 只看每一步的结果，不看协议细节
 *
 * 你不需要安装任何数据库，也不需要配置任何东西——SQLite 是 Node 自带的，
 * 数据会真实写到 examples/demo.db 这个文件里，跑完可以打开看。
 * ============================================================================
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const SHOW_WIRE = !process.argv.includes("--quiet");

// 用一个本地文件当数据库，跑完会在 examples/ 目录下看到 demo.db
const DB_FILE = "examples/demo.db";
const CONN = `sqlite:${DB_FILE}`;

// ---------------------------------------------------------------------------
// 小工具：打印辅助
// ---------------------------------------------------------------------------
const line = () => "─".repeat(64);
function step(n, title) {
  console.log(`\n${line()}\n▶ 第 ${n} 步：${title}\n${line()}`);
}
function explain(text) {
  console.log(`💡 ${text}`);
}
function wire(tag, obj) {
  if (SHOW_WIRE) console.log(`   [对讲机·${tag}] ${JSON.stringify(obj)}`);
}
function showResult(msg) {
  const sc = msg?.result?.structuredContent;
  if (sc !== undefined) {
    console.log("   ✅ 结果：", JSON.stringify(sc));
  } else if (msg?.result) {
    console.log("   ✅ 结果：", JSON.stringify(msg.result).slice(0, 500));
  } else if (msg?.error) {
    console.log("   ❌ 错误：", JSON.stringify(msg.error));
  }
}

// ---------------------------------------------------------------------------
// 1. 启动 MCP 服务子进程（相当于把"翻译中心"开门营业）
// ---------------------------------------------------------------------------
console.log("\n🚀 正在启动 db-mcp 服务（node index.js）…");
const child = spawn(process.execPath, [join(PROJECT_ROOT, "index.js")], {
  cwd: PROJECT_ROOT,
  stdio: ["pipe", "pipe", "pipe"],
});

// 服务的 stderr 是它自己的运行日志（配置来源、警告等），单独打印，和协议消息区分开
child.stderr.on("data", (chunk) => {
  for (const l of chunk.toString().split("\n")) {
    if (l.trim()) console.log(`   [服务日志] ${l.trim()}`);
  }
});

// ---------------------------------------------------------------------------
// 2. 协议基础设施：按行读写 JSON（stdio 上每条消息占一行）
// ---------------------------------------------------------------------------
let buf = "";
let nextId = 1;
const pending = new Map();

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const text = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!text) continue;
    let msg;
    try { msg = JSON.parse(text); } catch { continue; }
    wire("收到", msg);
    const wait = pending.get(msg.id);
    if (wait) { pending.delete(msg.id); wait.resolve(msg); }
  }
});

function sendRaw(obj) {
  wire("发出", obj);
  child.stdin.write(JSON.stringify(obj) + "\n");
}

// 发一个请求并等待对应 id 的回复；8 秒没回就报错，避免卡死
function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`请求 ${method} 超时`));
    }, 8000);
    pending.set(id, {
      resolve: (msg) => { clearTimeout(timer); resolve(msg); },
    });
    sendRaw({ jsonrpc: "2.0", id, method, params });
  });
}

// ---------------------------------------------------------------------------
// 正式练习流程
// ---------------------------------------------------------------------------
try {
  step(0, "握手：和服务器互相认识（initialize）");
  explain("客户端先说'你好，我是谁、我支持什么版本'，服务器回'你好，我是 db-mcp'。这一步不做任何数据库操作。");
  const init = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "practice-script", version: "1.0" },
  });
  showResult(init);
  explain(`服务器版本：${init.result?.serverInfo?.version}，协议：${init.result?.protocolVersion}`);

  // 握手后必须发一个"我已经初始化好了"的通知（没有 id，不需要回复）
  sendRaw({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

  step(1, "看看有哪些工具可用（tools/list）");
  explain("这就是 AI 眼里'这个服务能帮我做什么'的清单。");
  const listed = await request("tools/list", {});
  const tools = (listed.result?.tools || []).map((t) => t.name);
  console.log(`   ✅ 共 ${tools.length} 个工具：${tools.join(", ")}`);

  step(2, "第一次真实操作：建一张学生表（query）");
  explain("注意：我们不配任何账号，直接给一个 sqlite 连接串，走'免配置模式'。数据会落到 examples/demo.db 文件里。");
  const created = await request("tools/call", {
    name: "query",
    arguments: {
      connectionString: CONN,
      sql: "CREATE TABLE IF NOT EXISTS student (id INTEGER, name TEXT, score INTEGER)",
    },
  });
  showResult(created);

  step(3, "插入两行数据（query）");
  explain("先清空旧数据保证每次运行结果一致，再插入两行。注意这是我们唯一会'改动数据'的地方。");
  await request("tools/call", {
    name: "query",
    arguments: { connectionString: CONN, sql: "DELETE FROM student" },
  });
  const inserted = await request("tools/call", {
    name: "query",
    arguments: {
      connectionString: CONN,
      sql: "INSERT INTO student VALUES (1, '小明', 90), (2, '小红', 95)",
    },
  });
  showResult(inserted);

  step(4, "查询数据（query）——看统一返回格式");
  explain("重点观察返回结构：rows（数据行）、fields（列信息）、rowCount（行数）。无论换成 MySQL 还是 Oracle，这个结构都一样。");
  const queried = await request("tools/call", {
    name: "query",
    arguments: { connectionString: CONN, sql: "SELECT * FROM student ORDER BY id" },
  });
  showResult(queried);

  step(5, "列出所有表（list_tables）");
  explain("这是只读工具。SQLite 的翻译官会去查一个叫 sqlite_master 的系统表来回答。");
  const tables = await request("tools/call", {
    name: "list_tables",
    arguments: { connectionString: CONN },
  });
  showResult(tables);

  step(6, "查看表结构（describe_table）");
  explain("看看 student 表有哪些列、什么类型。");
  const desc = await request("tools/call", {
    name: "describe_table",
    arguments: { connectionString: CONN, table: "student" },
  });
  showResult(desc);

  step(7, "读一下登记本：有哪些已配置数据源（list_datasources）");
  explain("这里读的是项目自带的 config.db，看看里面登记了哪些数据库、各自的用途说明。");
  const dss = await request("tools/call", { name: "list_datasources", arguments: {} });
  const ds = dss.result?.structuredContent?.datasources || {};
  const total = Object.values(ds).reduce((n, m) => n + Object.keys(m).length, 0);
  console.log(`   ✅ 已登记 ${total} 个数据源（按类型分组）：${Object.keys(ds).join(", ") || "无"}`);

  step(8, "读完整配置（config_get）");
  explain("和网页后台看到的是同一份配置，证明'配置与代码分离'。");
  const cfg = await request("tools/call", { name: "config_get", arguments: {} });
  showResult({ 提示: "完整配置较长，此处省略", 配置来源: "config.db" });

  console.log(`\n${line()}\n🎉 练习完成！\n${line()}`);
  console.log(`\n   数据已真实写入：${join(PROJECT_ROOT, DB_FILE)}`);
  console.log("   你可以用任意 SQLite 工具打开它，验证 student 表里的数据。");
  console.log("   回顾：你刚才亲手走完了 AI 查数据库的完整流程——握手 → 列工具 → 建表 → 插入 → 查询 → 读结构 → 读配置。");
  console.log("   全程 AI 只说'普通话'（工具名 + 参数），方言翻译由 drivers.js 完成。\n");
} catch (err) {
  console.error("\n❌ 练习出错：", err.message);
  process.exitCode = 1;
} finally {
  child.kill();
  // 给子进程一点时间退出
  setTimeout(() => process.exit(), 200);
}
