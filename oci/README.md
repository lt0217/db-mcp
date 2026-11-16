# Oracle Instant Client

这个目录用来放 Oracle Instant Client（仅 Oracle 11g/12c 的 Thick 模式需要）。

## 为什么仓库里没有这些文件

1. **授权**：Oracle Instant Client 是 Oracle 的专有软件，不允许随第三方开源项目重新分发。
2. **体积**：`oraociei12.dll` 约 195MB、`oraociei11.dll` 约 142MB，**超过 GitHub 单文件 100MB 上限**，根本传不上去。

所以请**自行下载**，放到本目录对应版本的子文件夹里。仓库的 `.gitignore` 已忽略这些二进制文件，不会被误提交。

## 我到底需不需要它？

| Oracle 版本 | 是否需要 | 说明 |
|-------------|----------|------|
| 19c 及以上 | ❌ 不需要 | 默认 Thin 模式即可，配置里**不要**写 `oracleClientLibDir` |
| 12c / 11g | ✅ 需要 | 必须 Thick 模式，且要配置 `oracleClientLibDir` |

## 怎么装（Windows）

1. 打开 Oracle 官网下载页：<https://www.oracle.com/database/technologies/instant-client/downloads.html>
2. 接受许可协议，下载对应版本、对应位数的 **Instant Client Package - Basic**（约几十 MB 的 zip）。
   - 连 11g 用 `11.2.0.4`，连 12c 用 `12.2.0.1`（位数要和你的 Node.js 一致，通常是 64 位）。
3. 解压后的目录结构应类似（以 11.2.0.4 为例）：

   ```
   oci/
   └── 11.2.0.4/
       ├── oci.dll
       ├── oraociei11.dll
       ├── orannzsbb11.dll
       └── ...
   ```

   关键判断标准：**该目录下能找到 `oci.dll`**。

4. 在数据源配置里指定这个目录（相对路径按 `config.db` 所在目录解析，也可用绝对路径）：

   ```json
   {
     "oracle": {
       "legacy": {
         "url": "oracles://user:password@host:1521/SID",
         "oracleClientLibDir": "oci/11.2.0.4",
         "description": "历史库：只读查询"
       }
     }
   }
   ```

5. 如果改了配置，**重启 MCP 服务**才会生效（连接池与 Oracle 客户端在启动时/首次连接时加载）。

## 连接串写法

- `oracle://user:pass@host:1521/SERVICE_NAME` —— 服务名，12c+ 常用
- `oracles://user:pass@host:1521/SID` —— SID，11g 常用（注意是 `oracles`，多个 s）

## 常见报错

| 报错 | 原因 |
|------|------|
| `NJS-138` | 没加载 Instant Client：检查 `oracleClientLibDir` 是否指向含 `oci.dll` 的目录、位数是否匹配 |
| 连接超时 | 主机不可达 / 防火墙 / 监听没起；可用 `test_datasources` 工具快速探测 |
