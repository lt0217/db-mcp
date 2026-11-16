# 启动脚本：start.ps1 [web|mcp]  （默认 web）
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if ($args[0] -eq 'mcp') {
    Write-Host "Starting db-mcp (MCP stdio server)..."
    node index.js
} else {
    Write-Host "Starting db-mcp config UI at http://127.0.0.1:3777/ ..."
    node web.js
}
