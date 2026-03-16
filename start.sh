#!/usr/bin/env bash

echo "==============================="
echo " 视频人物替换工具 - 一键启动脚本"
echo "==============================="
echo

# 1. 检查 Node.js
echo "检查 Node.js..."
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，请先安装 Node.js 后再运行本脚本。"
  exit 1
fi

# 2. 检查 ffmpeg
echo
echo "检查 ffmpeg..."
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "未检测到 ffmpeg，请先安装 ffmpeg 并确保在 PATH 中可用。"
  echo "例如：Ubuntu 可用 apt 安装：sudo apt install ffmpeg"
  exit 1
fi

# 3. 安装依赖（使用淘宝镜像）
echo
echo "检查依赖..."
if [ ! -d "node_modules" ]; then
  echo "未发现 node_modules，正在使用淘宝镜像安装依赖..."
  npm config set registry https://registry.npmmirror.com
  if [ $? -ne 0 ]; then
    echo "设置 npm 镜像失败，请检查 npm 配置。"
    exit 1
  fi

  npm install
  if [ $? -ne 0 ]; then
    echo "npm install 失败，请检查网络或 npm 配置。"
    exit 1
  fi
else
  echo "已存在 node_modules，跳过 npm install。"
fi

# 4. 启动服务
echo
echo "启动服务：node src/server.js"
echo
node src/server.js

