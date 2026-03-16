# 视频人物替换工具

## 一、项目简介

这是一个本地运行的小工具，用于对原视频中的**指定时间片段**做**人物替换/动效合成**。  
流程大致为：前端按时间轴选片段 → 后端合并这些片段 → 调用阿里云百炼生成新视频 → 按片段时长切分 → 替换回原视频对应时间段，生成完整成片。

## 二、运行环境

- 已安装 **Node.js 16+**（推荐官方安装包）
- 已安装 **ffmpeg** 且在系统 `PATH` 中可用
  - Windows 可用 `winget install Gyan.FFmpeg` 或 `choco install ffmpeg`
  - Linux/macOS 可用发行版包管理器安装（如 `apt install ffmpeg`、`brew install ffmpeg`）

## 三、一键启动（推荐）

### 1. Windows（使用 `start.cmd`）

双击项目根目录下的 `start.cmd`，脚本会自动：

1. 检查是否安装 Node.js、ffmpeg；
2. 第一次运行时使用淘宝镜像执行：
   ```bat
   npm config set registry https://registry.npmmirror.com
   npm install
   ```
3. 安装成功后执行：
   ```bat
   node server.js
   ```

之后再次双击 `start.cmd`，如果已存在 `node_modules`，会直接启动服务。

### 2. Linux / macOS（使用 `start.sh`）

在项目根目录终端执行：

```bash
chmod +x start.sh
./start.sh
```

脚本会自动：

1. 检查 Node.js、ffmpeg；
2. 如无 `node_modules`，使用淘宝镜像执行：
   ```bash
   npm config set registry https://registry.npmmirror.com
   npm install
   ```
3. 然后启动：
   ```bash
   node server.js
   ```

## 四、手动启动（可选）

如果不使用脚本，也可以手动运行（首次需要安装依赖）：

```bash
npm install
node server.js
```

然后在浏览器访问：

```text
http://localhost:3000
```

## 五、阿里云百炼配置

1. 打开页面右侧「设置」面板；
2. 填写阿里云百炼的 **API Key** 并保存；
3. 上传人物正面图，等待上传完成；
4. 在时间轴上选择需替换的片段，点击「处理」即可。

