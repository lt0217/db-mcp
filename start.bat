@echo off
rem Usage: start.bat [web | mcp]   (default: web)
cd /d "%~dp0"

rem Locate node.exe
set "NODE_BIN="
where node >nul 2>&1
if not errorlevel 1 (
    set "NODE_BIN=node"
) else (
    if exist "C:\Program Files\nodejs\node.exe"   set "NODE_BIN=C:\Program Files\nodejs\node.exe"
    if exist "%LOCALAPPDATA%\nvm\nodejs\node.exe" set "NODE_BIN=%LOCALAPPDATA%\nvm\nodejs\node.exe"
    if exist "%ProgramFiles%\nodejs\node.exe"     set "NODE_BIN=%ProgramFiles%\nodejs\node.exe"
)

if not defined NODE_BIN (
    echo [ERROR] node not found.
    echo   Install Node.js 22+ and make sure it is on PATH: https://nodejs.org/
    pause
    exit /b 1
)

if /i "%1"=="mcp" (
    echo Starting db-mcp MCP stdio server...
    "%NODE_BIN%" index.js
) else (
    echo Starting db-mcp config UI at http://127.0.0.1:3777/
    echo If the port is busy, close the program using port 3777 first.
    "%NODE_BIN%" web.js
)

echo.
echo [TIP] db-mcp stays running; close this window to stop it.
pause
