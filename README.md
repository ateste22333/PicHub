# Node.js 图片自动化处理与 GitHub 托管脚本 (jsDelivr CDN 加速)

基于 Node.js (ESM)、`sharp` 和 `@octokit/rest` 开发的高性能图片自动化处理与 GitHub 托管工具。支持图片自动 WebP 压缩、SHA-256 Hash 重命名去重、当天日期归档存储、jsDelivr CDN 链接自动生成，以及 GitHub 仓库文件的删除、重命名/移动和按日期文件夹批量下载归档功能。

---

## 🌟 核心特性

1. **灵活的配置管理**：
   - 支持通过 `config.json` 或 `.env` 环境变量配置文件自定义 GitHub Token、用户名、仓库名、分支、存储根路径、图片压缩质量等。
2. **高效的本地图片处理**：
   - 使用 `sharp` 库将本地图片自动压缩并转换为 **WebP** 格式。
   - 使用文件内容的 **SHA-256 Hash 值** 命名输出文件（如 `a1b2c3....webp`），避免同名冲突并自动实现图片去重。
3. **GitHub 上传与 CDN 加速**：
   - 上传时自动以**当天日期**（`YYYY-MM-DD` 格式）作为一级子目录进行归档存储。
   - 自动计算并输出 **jsDelivr CDN** 加速访问链接。
4. **完善的远程仓库管理**：
   - **删除文件**：支持按仓库路径直接删除远程文件。
   - **重命名/移动文件**：支持对远程文件进行重命名或跨目录移动。
   - **文件夹打包下载归档**：支持将 GitHub 仓库中指定日期文件夹（或任意子目录）的所有图片打包下载保存到本地。
5. **现代 ES Modules 语法与健壮异常处理**：
   - 基于 Node.js ESM 规范与 `async/await` 异步流，提供完善的网络错误、文件冲突与 API 权限校验处理。

---

## 📁 项目结构

```
.
├── package.json          # 项目依赖与脚本配置 (ESM "type": "module")
├── .env.example          # 环境变量配置模板
├── config.json.example   # JSON 格式配置模板
├── src/
│   ├── config.js         # 配置加载与校验模块
│   ├── imageProcessor.js # 图片压缩、WebP 转换与 SHA-256 哈希计算模块
│   ├── githubClient.js   # Octokit GitHub REST API 交互模块 (上传/删除/移动/下载)
│   ├── cdnHelper.js      # jsDelivr CDN 访问链接生成器
│   └── index.js          # CLI 命令行入口文件
└── README.md             # 使用说明文档
```

---

## ⚙️ 安装与配置说明

### 1. 安装依赖

确保已安装 **Node.js 18+** 环境：

```bash
npm install
```

### 2. 配置说明

支持两种配置方式（任选其一即可）：

#### 方式 A：使用 `config.json`（推荐）

复制模板文件并填写参数：

```bash
cp config.json.example config.json
```

在 `config.json` 中配置：

```json
{
  "githubToken": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "owner": "your_github_username",
  "repo": "your_repository_name",
  "branch": "main",
  "uploadBasePath": "images",
  "imageQuality": 80
}
```

#### 方式 B：使用 `.env` 环境变量

复制模板文件：

```bash
cp .env.example .env
```

在 `.env` 中配置：

```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=your_github_username
GITHUB_REPO=your_repository_name
GITHUB_BRANCH=main
UPLOAD_BASE_PATH=images
IMAGE_QUALITY=80
```

> **注意**：GitHub Token 需要具备对目标仓库的写权限（Personal Access Token: `repo` 作用域或 Fine-grained Token 的 `Contents: Read and write` 权限）。

---

## 🚀 命令行使用指南

### 1. 本地图片处理与上传 (`upload`)

遍历指定本地图片目录（或单个图片文件），压缩为 WebP 格式，并以 SHA-256 Hash 命名后上传至 GitHub 当天日期文件夹：

```bash
# 上传指定目录中的所有图片
node src/index.js upload ./my-photos

# 上传单个图片文件
node src/index.js upload ./test.png

# 自定义 WebP 压缩质量 (例: 90)
node src/index.js upload ./my-photos -q 90

# 指定自定义子目录 (覆盖默认的 YYYY-MM-DD 目录)
node src/index.js upload ./my-photos -s 2026-09-18
```

**输出示例**：

```
🚀 Loading configuration...
🖼️  Processing local images at './my-photos' (WebP Quality: 80)...
✅ Processed 2 image(s). Connecting to GitHub repo 'user/repo'...

[1/2] Uploading a1b2c3d4e5f6....webp (45.20 KB)...
  🎉 CREATED -> Repo Path: images/2026-09-18/a1b2c3d4e5f6....webp
  🔗 jsDelivr CDN: https://cdn.jsdelivr.net/gh/user/repo@main/images/2026-09-18/a1b2c3d4e5f6....webp

======================================================
✨ Upload Task Completed! Total: 1 file(s).
======================================================
```

---

### 2. 删除远程仓库文件 (`delete`)

按 GitHub 仓库中的文件路径删除指定文件：

```bash
node src/index.js delete images/2026-09-18/a1b2c3d4e5f6....webp

# 自定义 commit 消息
node src/index.js delete images/2026-09-18/a1b2c3d4e5f6....webp -m "Remove obsolete image"
```

---

### 3. 重命名或移动远程文件 (`move` / `rename`)

对 GitHub 仓库中的已存在文件进行重命名或跨目录移动：

```bash
node src/index.js move images/2026-09-18/old_name.webp images/2026-09-18/new_name.webp
```

---

### 4. 下载指定日期文件夹归档 (`download`)

将 GitHub 仓库中某个日期子目录（或任意文件夹）下的所有文件下载并归档到本地：

```bash
# 下载指定日期文件夹中的所有图片到本地 ./downloaded_images
node src/index.js download 2026-09-18 ./downloaded_images

# 或指定完整仓库路径
node src/index.js download images/2026-09-18 ./downloaded_images
```

---

## 🛠️ API / 模块化集成示例

如果你想在其他 Node.js 项目中作为模块引入调用：

```javascript
import { getConfig } from './src/config.js';
import { processSingleImage } from './src/imageProcessor.js';
import { GitHubManager } from './src/githubClient.js';

const config = await getConfig();
const ghManager = new GitHubManager(config);

// 1. 处理单个本地图片 Buffer
const processed = await processSingleImage('./example.png', 85);

// 2. 上传到 GitHub (自动归档到当天日期)
const result = await ghManager.uploadImage(processed);
console.log('CDN Link:', result.cdnUrl);
```

---

## 🛡️ 健壮性与安全设计

- **容错处理**：自动捕获并反馈网络故障、401 Token 失效、404 文件不存在、409 冲突等 API 错误。
- **文件与路径安全**：自动处理跨平台 Windows (`\`) 与 POSIX (`/`) 路径差异。
- **配置优先级**：自动处理配置覆盖优先级（自定义路径 > `config.json` > `.env` / 环境变量）。
