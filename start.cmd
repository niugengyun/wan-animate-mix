@echo off
chcp 65001 >nul

echo ===============================
echo  视频人物替换工具 - 一键启动脚本
echo ===============================
echo.

REM 1. 检查 Node.js
echo 检查 Node.js...
node -v >nul 2>&1
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装 Node.js（https://nodejs.org）后再运行本脚本。
  pause
  exit /b 1
)

REM 2. 检查 ffmpeg
echo.
echo 检查 ffmpeg...
ffmpeg -version >nul 2>&1
if errorlevel 1 (
  echo 未检测到 ffmpeg，请先安装 ffmpeg 且确保 ffmpeg 在环境变量 PATH 中可用。
  echo 可前往 https://ffmpeg.org 或使用 winget / choco 安装。
  pause
  exit /b 1
) else (
  echo 已检测到 ffmpeg。
)

REM 3. 安装依赖（使用淘宝镜像）
echo.
echo 检查依赖...
if not exist node_modules (
  echo 未发现 node_modules，正在使用淘宝镜像安装依赖...
  npm config set registry https://registry.npmmirror.com
  if errorlevel 1 (
    echo 设置 npm 镜像失败，请检查 npm 配置。
    pause
    exit /b 1
  )
  npm install
  if errorlevel 1 (
    echo npm install 失败，请检查网络或 npm 配置。
    pause
    exit /b 1
  )
) else (
  echo 已存在 node_modules，跳过 npm install。
)

REM 4. 启动服务
echo.
echo 启动服务：node src/server.js
echo.
node src/server.js

echo.
echo 服务器已退出。
pause

