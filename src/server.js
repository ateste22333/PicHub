import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getConfig, saveConfig, validateConfig } from './config.js';
import { processSingleImage, processLocalImages, mapConcurrent } from './imageProcessor.js';
import { GitHubManager, getFormattedDate } from './githubClient.js';
import { getCdnUrl } from './cdnHelper.js';
import { logger } from './logger.js';
import { taskManager } from './taskManager.js';

/**
 * Save failed upload file buffer to local backup folder ./failed_uploads
 */
async function saveFailedUploadFile(buffer, originalName) {
  try {
    const failedDir = path.join(process.cwd(), 'failed_uploads');
    if (!fs.existsSync(failedDir)) {
      fs.mkdirSync(failedDir, { recursive: true });
    }
    const safeName = `${Date.now()}_${path.basename(originalName)}`;
    const savePath = path.join(failedDir, safeName);
    fs.writeFileSync(savePath, buffer);
    return savePath;
  } catch (saveErr) {
    logger.error(`保存失败文件至本地目录失败: ${saveErr.message}`);
    return null;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

/**
 * API: System Logs
 */
app.get('/api/logs', (req, res) => {
  const level = req.query.level || 'ALL';
  const logs = logger.getLogs(level);
  res.json({ success: true, total: logs.length, logs });
});

app.delete('/api/logs', (req, res) => {
  logger.clearLogs();
  logger.info('系统的日志已被清空');
  res.json({ success: true, message: 'Logs cleared successfully' });
});

/**
 * API: Task Manager Progress
 */
app.get('/api/tasks', (req, res) => {
  const tasks = taskManager.getAllTasks();
  res.json({ success: true, total: tasks.length, tasks });
});

app.get('/api/tasks/:id', (req, res) => {
  const task = taskManager.getTask(req.params.id);
  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }
  res.json({ success: true, task });
});

/**
 * API: Get Current Configuration
 */
app.get('/api/config', async (req, res) => {
  try {
    const config = await getConfig();
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API: Save / Update Configuration
 */
app.post('/api/config', async (req, res) => {
  try {
    const newConfig = req.body;
    const saved = await saveConfig(newConfig);
    logger.info(`系统配置已更新: 压缩=${saved.enableCompression}, 模式=${saved.uploadMode}, 并发线程数=${saved.concurrencyLimit}, CDN=${saved.cdnProvider}`, { config: saved });
    res.json({ success: true, config: saved });
  } catch (err) {
    logger.error(`保存配置失败: ${err.message}`);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * API: Upload files (via browser file upload or local path)
 */
app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    const config = await getConfig();
    validateConfig(config);
    const ghManager = new GitHubManager(config);

    const enableCompression = req.body.enableCompression !== undefined
      ? (req.body.enableCompression === 'true' || req.body.enableCompression === true)
      : config.enableCompression;
    const quality = req.body.quality ? parseInt(req.body.quality, 10) : config.imageQuality;
    const concurrencyLimit = config.concurrencyLimit || 5;

    let targetSubFolder;
    if (req.body.subfolder !== undefined && req.body.subfolder !== '') {
      targetSubFolder = req.body.subfolder;
    } else if (String(config.uploadMode) === '2' || config.uploadMode === 'custom') {
      targetSubFolder = config.customFolderName || 'uploads';
    } else if (String(config.uploadMode) === '3' || config.uploadMode === 'root') {
      targetSubFolder = '';
    } else {
      targetSubFolder = getFormattedDate();
    }

    const localDirectoryPath = req.body.localPath || null;
    const filesToUpload = req.files || [];

    const totalCount = filesToUpload.length > 0
      ? filesToUpload.length
      : (localDirectoryPath ? 1 : 0);

    if (totalCount === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded and no localPath specified.' });
    }

    const task = taskManager.createTask(`图片处理与上传 (${totalCount}项)`, 'upload', totalCount);
    logger.info(`开始处理上传任务 (ID: ${task.id}), 目标子目录: '${targetSubFolder}', 压缩模式: ${enableCompression ? '开启' : '关闭'}, 并发线程数: ${concurrencyLimit}`);

    const maxRounds = 3;
    const results = [];

    if (filesToUpload.length > 0) {
      let currentQueue = filesToUpload.map((f) => ({
        originalBuffer: f.buffer, // Raw uncompressed file buffer
        originalname: f.originalname,
        lastError: null
      }));

      let round = 1;
      while (currentQueue.length > 0 && round <= maxRounds) {
        if (round > 1) {
          logger.warn(`【集中重传】第 ${round - 1} 轮处理完成，存在 ${currentQueue.length} 个未成功项。等待 1.5 秒后开启第 ${round} 轮重传...`);
          await new Promise((r) => setTimeout(r, 1500));
        }

        const failedInRound = [];
        await mapConcurrent(currentQueue, concurrencyLimit, async (item) => {
          try {
            const processed = await processSingleImage(item.originalBuffer, quality, enableCompression, item.originalname, config.supportedImageExts);
            processed.originalName = item.originalname;

            const uploadRes = await ghManager.uploadImage(processed, targetSubFolder);
            const itemRes = {
              originalName: item.originalname,
              filename: processed.filename,
              ...uploadRes,
              processedSize: processed.processedSize,
              width: processed.width,
              height: processed.height
            };

            results.push(itemRes);
            taskManager.updateTaskItem(task.id, itemRes, true);
            logger.success(`[第 ${round} 轮] 文件上传成功: ${uploadRes.repoPath}`, { cdnUrl: uploadRes.cdnUrl });
          } catch (err) {
            item.lastError = err.message;
            failedInRound.push(item);
            logger.warn(`[第 ${round} 轮] 文件上传未成功 (${item.originalname}): ${err.message}`);
          }
        });

        if (failedInRound.length === 0) {
          if (round > 1) {
            logger.success(`【重传成功】第 ${round} 轮集中重传结束，所有暂未成功的图片均已全部上传成功！`);
          }
          break;
        }

        if (round === maxRounds) {
          // Max 3 rounds completed and items still failed! Save raw uncompressed original image
          for (const failedItem of failedInRound) {
            const savedPath = await saveFailedUploadFile(failedItem.originalBuffer, failedItem.originalname);
            taskManager.updateTaskItem(task.id, { error: failedItem.lastError, failedSavedPath: savedPath }, false);
            logger.error(`[终极处理] 文件 (${failedItem.originalname}) 经过 ${maxRounds} 轮集中重传后最终失败，原图已安全保存至本地备份目录: ${savedPath}`);
          }
          break;
        }

        currentQueue = failedInRound;
        round++;
      }
    } else if (localDirectoryPath) {
      const processedList = await processLocalImages(localDirectoryPath, quality, enableCompression, concurrencyLimit, config.supportedImageExts);
      task.total = processedList.length;
      task.progress = processedList.length === 0 ? 100 : 0;

      let currentQueue = processedList.map((item) => {
        const rawBuf = item.buffer || (fs.existsSync(item.originalPath) ? fs.readFileSync(item.originalPath) : null);
        return {
          processed: item,
          originalBuffer: rawBuf,
          filename: item.filename || path.basename(item.originalPath),
          originalPath: item.originalPath,
          lastError: null
        };
      });

      let round = 1;
      while (currentQueue.length > 0 && round <= maxRounds) {
        if (round > 1) {
          logger.warn(`【集中重传】第 ${round - 1} 轮处理完成，存在 ${currentQueue.length} 个未成功项。等待 1.5 秒后开启第 ${round} 轮重传...`);
          await new Promise((r) => setTimeout(r, 1500));
        }

        const failedInRound = [];
        await mapConcurrent(currentQueue, concurrencyLimit, async (item) => {
          try {
            const uploadRes = await ghManager.uploadImage(item.processed, targetSubFolder);
            const itemRes = {
              originalPath: item.originalPath,
              filename: item.filename,
              ...uploadRes,
              processedSize: item.processed.processedSize,
              width: item.processed.width,
              height: item.processed.height
            };

            results.push(itemRes);
            taskManager.updateTaskItem(task.id, itemRes, true);
            logger.success(`[第 ${round} 轮] 本地文件上传成功: ${uploadRes.repoPath}`);
          } catch (err) {
            item.lastError = err.message;
            failedInRound.push(item);
            logger.warn(`[第 ${round} 轮] 本地文件上传未成功 (${item.originalPath}): ${err.message}`);
          }
        });

        if (failedInRound.length === 0) {
          if (round > 1) {
            logger.success(`【重传成功】第 ${round} 轮集中重传结束，所有暂未成功的本地文件均已全部上传成功！`);
          }
          break;
        }

        if (round === maxRounds) {
          for (const failedItem of failedInRound) {
            const savedPath = failedItem.originalBuffer ? await saveFailedUploadFile(failedItem.originalBuffer, failedItem.filename) : null;
            taskManager.updateTaskItem(task.id, { error: failedItem.lastError, failedSavedPath: savedPath }, false);
            logger.error(`[终极处理] 本地文件 (${failedItem.originalPath}) 经过 ${maxRounds} 轮集中重传后最终失败，原图已安全保存至本地备份目录: ${savedPath}`);
          }
          break;
        }

        currentQueue = failedInRound;
        round++;
      }
    }

    res.json({ success: true, taskId: task.id, total: results.length, results });
  } catch (err) {
    logger.error(`上传接口异常: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API: List remote files from GitHub repo folder
 */
app.get('/api/files', async (req, res) => {
  try {
    const config = await getConfig();
    validateConfig(config);
    const ghManager = new GitHubManager(config);

    let folderPath = req.query.folder !== undefined ? req.query.folder : getFormattedDate();
    if (folderPath && !folderPath.includes('/') && config.uploadBasePath) {
      folderPath = path.posix.join(config.uploadBasePath, folderPath);
    }

    const normPath = ghManager.normalizeRepoPath(folderPath || '');

    let data;
    try {
      const response = await ghManager.octokit.rest.repos.getContent({
        owner: config.owner,
        repo: config.repo,
        path: normPath,
        ref: config.branch,
      });
      data = response.data;
    } catch (err) {
      if (err.status === 404) {
        return res.json({ success: true, folder: normPath, files: [], message: 'Folder does not exist yet.' });
      }
      throw err;
    }

    const fileList = Array.isArray(data) ? data : [data];
    const results = fileList.map((item) => {
      const isDir = item.type === 'dir';
      const cdnUrl = isDir
        ? null
        : getCdnUrl({
            owner: config.owner,
            repo: config.repo,
            branch: config.branch,
            filePath: item.path,
            cdnProvider: config.cdnProvider,
            customCdnTemplate: config.customCdnTemplate,
          });

      return {
        name: item.name,
        path: item.path,
        sha: item.sha,
        size: item.size,
        type: item.type,
        isDir,
        downloadUrl: item.download_url,
        cdnUrl,
      };
    });

    res.json({ success: true, folder: normPath, total: results.length, files: results });
  } catch (err) {
    logger.error(`获取文件列表失败: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API: Delete single file
 */
app.post('/api/files/delete', async (req, res) => {
  try {
    const { filePath, commitMessage } = req.body;
    if (!filePath) {
      return res.status(400).json({ success: false, error: 'filePath parameter is required.' });
    }

    const config = await getConfig();
    validateConfig(config);
    const ghManager = new GitHubManager(config);

    const result = await ghManager.deleteFile(filePath, commitMessage);
    logger.warn(`文件已从 GitHub 删除: ${filePath}`);
    res.json({ success: true, result });
  } catch (err) {
    logger.error(`删除文件失败: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API: Delete entire folder recursively
 */
app.post('/api/files/delete-folder', async (req, res) => {
  try {
    const { folderPath } = req.body;
    if (!folderPath) {
      return res.status(400).json({ success: false, error: 'folderPath parameter is required.' });
    }

    const config = await getConfig();
    validateConfig(config);
    const ghManager = new GitHubManager(config);

    const task = taskManager.createTask(`删除远程文件夹 (${folderPath})`, 'batch-delete', 1);
    logger.warn(`开始从 GitHub 递归删除文件夹及其所有内容: '${folderPath}'`);

    const result = await ghManager.deleteFolder(folderPath, (item, ok) => {
      taskManager.updateTaskItem(task.id, item, ok);
    });
    taskManager.updateTaskItem(task.id, result, result.success);

    logger.warn(`文件夹删除完成! 共删除 ${result.deletedCount} 个文件`);
    res.json({ success: result.success, taskId: task.id, result });
  } catch (err) {
    logger.error(`删除文件夹失败: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API: Batch Delete files with Task Progress
 */
app.post('/api/files/batch-delete', async (req, res) => {
  try {
    const { filePaths, commitMessage } = req.body;
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return res.status(400).json({ success: false, error: 'filePaths array is required.' });
    }

    const config = await getConfig();
    validateConfig(config);
    const ghManager = new GitHubManager(config);

    const task = taskManager.createTask(`批量删除文件 (${filePaths.length}项)`, 'batch-delete', filePaths.length);
    logger.info(`开始批量删除 ${filePaths.length} 个文件...`);

    const result = await ghManager.batchDeleteFiles(filePaths, commitMessage, config.concurrencyLimit || 5, (item, ok) => {
      taskManager.updateTaskItem(task.id, item, ok);
    });

    logger.warn(`批量删除完成: 成功 ${result.deletedCount}, 失败 ${result.failedCount}`);
    res.json({ success: result.success, taskId: task.id, result });
  } catch (err) {
    logger.error(`批量删除请求异常: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API: Move / Rename single file
 */
app.post('/api/files/move', async (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      return res.status(400).json({ success: false, error: 'Both oldPath and newPath are required.' });
    }

    const config = await getConfig();
    validateConfig(config);
    const ghManager = new GitHubManager(config);

    const result = await ghManager.renameFile(oldPath, newPath);
    logger.info(`文件移动成功: ${oldPath} -> ${newPath}`);
    res.json({ success: true, result });
  } catch (err) {
    logger.error(`移动文件失败: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API: Batch Move files with Task Progress
 */
app.post('/api/files/batch-move', async (req, res) => {
  try {
    const { filePaths, targetFolder } = req.body;
    if (!Array.isArray(filePaths) || filePaths.length === 0 || targetFolder === undefined) {
      return res.status(400).json({ success: false, error: 'filePaths array and targetFolder string are required.' });
    }

    const config = await getConfig();
    validateConfig(config);
    const ghManager = new GitHubManager(config);

    const task = taskManager.createTask(`批量移动文件 (${filePaths.length}项)`, 'batch-move', filePaths.length);
    logger.info(`开始批量移动 ${filePaths.length} 个文件到 '${targetFolder}' (并发线程数: ${config.concurrencyLimit || 5})...`);

    const result = await ghManager.batchMoveFiles(filePaths, targetFolder, config.concurrencyLimit || 5);
    result.results.forEach((r) => taskManager.updateTaskItem(task.id, r, true));
    result.errors.forEach((e) => taskManager.updateTaskItem(task.id, e, false));

    logger.info(`批量移动完成: 成功 ${result.movedCount}, 失败 ${result.failedCount}`);
    res.json({ success: result.success, taskId: task.id, result });
  } catch (err) {
    logger.error(`批量移动请求异常: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API: Dedicated Archive Module (Full Repo or Subfolder Download)
 */
app.post('/api/archive', async (req, res) => {
  try {
    const { archiveScope, folderPath, outputDir } = req.body;
    const targetDir = outputDir || './downloaded_archive';

    const config = await getConfig();
    validateConfig(config);
    const ghManager = new GitHubManager(config);

    const isFullRepo = archiveScope === 'full';
    const targetPath = isFullRepo ? '' : (folderPath || '');

    const task = taskManager.createTask(
      isFullRepo ? '全仓库打包归档' : `子目录归档 (${targetPath})`,
      'download',
      1
    );

    logger.info(`开始执行归档任务 [${task.name}] -> 本地保存至: '${targetDir}' (并发线程数: ${config.concurrencyLimit || 5})`);
    const result = await ghManager.downloadFolderArchive(targetPath, targetDir, config.concurrencyLimit || 5);

    taskManager.updateTaskItem(task.id, { localDirectory: result.localDirectory, count: result.totalFiles }, true);
    logger.success(`归档任务完成！成功下载 ${result.totalFiles} 个文件到 '${result.localDirectory}'`);

    res.json({ success: true, taskId: task.id, result });
  } catch (err) {
    logger.error(`打包归档失败: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API: Download date folder archive to local path (Legacy compatibility)
 */
app.post('/api/files/download', async (req, res) => {
  try {
    const { folderPath, outputDir } = req.body;
    if (folderPath === undefined || !outputDir) {
      return res.status(400).json({ success: false, error: 'Both folderPath and outputDir are required.' });
    }

    const config = await getConfig();
    validateConfig(config);
    const ghManager = new GitHubManager(config);

    const task = taskManager.createTask(`归档打包下载 (${folderPath || '根目录'})`, 'download', 1);
    logger.info(`开始打包下载远程目录 '${folderPath || '根目录'}' 到本地 '${outputDir}' (并发线程: ${config.concurrencyLimit || 5})...`);

    const result = await ghManager.downloadFolderArchive(
      folderPath,
      outputDir,
      config.concurrencyLimit || 5,
      (item, ok) => taskManager.updateTaskItem(task.id, item, ok)
    );

    taskManager.updateTaskItem(task.id, result, result.success);

    if (result.success) {
      logger.success(`归档下载完成！成功下载 ${result.downloadedCount} 个文件到本地 '${result.localDirectory}'`);
    } else {
      logger.warn(`归档下载部分完成: 成功 ${result.downloadedCount}, 失败 ${result.failedCount}`);
    }

    res.json({ success: result.success, taskId: task.id, result });
  } catch (err) {
    logger.error(`下载归档失败: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API: Repository Management - List Repositories
 */
app.get('/api/repos', async (req, res) => {
  try {
    const config = await getConfig();
    if (!config.githubToken) {
      return res.status(400).json({ success: false, error: 'GitHub Access Token is missing in settings.' });
    }
    const ghManager = new GitHubManager(config);
    const repos = await ghManager.listRepositories();
    res.json({
      success: true,
      total: repos.length,
      repos,
      activeOwner: config.owner,
      activeRepo: config.repo,
      activeBranch: config.branch
    });
  } catch (err) {
    logger.error(`获取 GitHub 仓库列表失败: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API: Repository Management - Create Repository
 */
app.post('/api/repos', async (req, res) => {
  try {
    const { name, description, isPrivate } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: 'Repository name is required.' });
    }
    const config = await getConfig();
    if (!config.githubToken) {
      return res.status(400).json({ success: false, error: 'GitHub Access Token is missing in settings.' });
    }
    const ghManager = new GitHubManager(config);
    const result = await ghManager.createRepository({ name, description, isPrivate });
    logger.success(`新建 GitHub 仓库成功: ${result.fullName} (${result.visibility})`);
    res.json({ success: true, repository: result });
  } catch (err) {
    logger.error(`新建仓库失败: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API: Repository Management - Update Repository
 */
app.patch('/api/repos/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const updates = req.body;
    const config = await getConfig();
    if (!config.githubToken) {
      return res.status(400).json({ success: false, error: 'GitHub Access Token is missing in settings.' });
    }
    const ghManager = new GitHubManager(config);
    const result = await ghManager.updateRepository(owner, repo, updates);
    logger.info(`更新 GitHub 仓库配置成功: ${owner}/${repo}`);
    res.json({ success: true, repository: result });
  } catch (err) {
    logger.error(`更新仓库失败: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API: Repository Management - Delete Repository
 */
app.delete('/api/repos/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const config = await getConfig();
    if (!config.githubToken) {
      return res.status(400).json({ success: false, error: 'GitHub Access Token is missing in settings.' });
    }
    const ghManager = new GitHubManager(config);
    const result = await ghManager.deleteRepository(owner, repo);
    logger.warn(`GitHub 仓库已被删除: ${owner}/${repo}`);
    res.json({ success: true, result });
  } catch (err) {
    logger.error(`删除仓库失败: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API: Repository Management - Select Active Hosting Repository
 */
app.post('/api/repos/select', async (req, res) => {
  try {
    const { owner, repo, branch } = req.body;
    if (!owner || !repo) {
      return res.status(400).json({ success: false, error: 'owner and repo parameters are required.' });
    }
    const config = await getConfig();
    config.owner = owner;
    config.repo = repo;
    if (branch) config.branch = branch;
    const saved = await saveConfig(config);
    logger.info(`已成功将图床工作仓库切换为: ${owner}/${repo} (默认分支: ${saved.branch})`);
    res.json({ success: true, config: saved });
  } catch (err) {
    logger.error(`切换生效仓库失败: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

export function startServer(port = PORT) {
  return app.listen(port, () => {
    logger.info(`======================================================`);
    logger.info(`🚀 Image Automation & GitHub Hosting Server is Running!`);
    logger.info(`🌐 Web UI Dashboard: http://localhost:${port}`);
    logger.info(`======================================================`);
  });
}

if (process.argv[1]) {
  const mainPath = path.resolve(process.argv[1]).toLowerCase();
  const currentPath = fileURLToPath(import.meta.url).toLowerCase();
  if (mainPath === currentPath || mainPath.endsWith('server.js')) {
    startServer();
  }
}
