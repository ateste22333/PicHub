import fs from 'node:fs/promises';
import path from 'node:path';
import { Octokit } from '@octokit/rest';
import { getCdnUrl } from './cdnHelper.js';

/**
 * Creates and initializes Octokit instance.
 * @param {string} token 
 * @returns {Octokit}
 */
export function createOctokitClient(token) {
  if (!token) {
    throw new Error('[GitHub Error] GitHub Access Token is required.');
  }
  return new Octokit({
    auth: token,
    request: {
      timeout: 30000, // 30s timeout for network resilience in domestic environments
    }
  });
}

/**
 * Gets formatted today date string in YYYY-MM-DD format.
 * @returns {string} e.g. "2026-09-18"
 */
export function getFormattedDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Concurrency helper function: execute async function over array items in parallel with a concurrency limit.
 * @param {Array} items 
 * @param {number} concurrency 
 * @param {Function} asyncFn 
 * @returns {Promise<Array>}
 */
export async function mapConcurrent(items, concurrency, asyncFn) {
  const limit = Math.max(1, concurrency || 5);
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await asyncFn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * GitHub Repository Manager Class
 */
export class GitHubManager {
  constructor(config) {
    this.octokit = createOctokitClient(config.githubToken);
    this.githubToken = config.githubToken;
    this.owner = config.owner;
    this.repo = config.repo;
    this.branch = config.branch || 'main';
    this.uploadBasePath = (config.uploadBasePath || '').trim();
    this.cdnProvider = config.cdnProvider || 'jsDelivr';
    this.customCdnTemplate = config.customCdnTemplate || '';
  }

  /**
   * Normalize path for GitHub API (POSIX format, no leading slash)
   */
  normalizeRepoPath(repoPath) {
    return repoPath.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  /**
   * Upload image buffer or processed image object to GitHub repo categorized by date folder.
   * 
   * Path format: <uploadBasePath>/<YYYY-MM-DD>/<filename> or <YYYY-MM-DD>/<filename>
   * 
   * @param {Object} item - { buffer, filename, hash, ... }
   * @param {string} [customSubFolder] - Optional subfolder override (defaults to YYYY-MM-DD)
   * @returns {Promise<Object>} Result details including cdnUrl and repoPath
   */
  async uploadImage(item, customSubFolder = null) {
    const subFolder = customSubFolder !== null && customSubFolder !== undefined ? customSubFolder : getFormattedDate();
    
    let rawPath = subFolder ? path.join(subFolder, item.filename) : item.filename;
    if (this.uploadBasePath) {
      rawPath = path.join(this.uploadBasePath, rawPath);
    }

    const repoPath = this.normalizeRepoPath(rawPath);
    const contentBase64 = item.buffer.toString('base64');

    let response;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      let existingSha = null;

      // Check if file already exists & get current SHA
      try {
        const { data } = await this.octokit.rest.repos.getContent({
          owner: this.owner,
          repo: this.repo,
          path: repoPath,
          ref: this.branch,
        });

        if (!Array.isArray(data) && data.sha) {
          existingSha = data.sha;
        }
      } catch (err) {
        if (err.status !== 404) {
          if (attempts >= maxAttempts) {
            throw new Error(`[GitHub API Error] Failed to check file existence: ${err.message}`);
          }
        }
      }

      const message = existingSha
        ? `update: upload image ${item.filename}`
        : `upload: add image ${item.filename} [date archive]`;

      try {
        const uploadParams = {
          owner: this.owner,
          repo: this.repo,
          path: repoPath,
          message,
          content: contentBase64,
          branch: this.branch,
        };

        if (existingSha) {
          uploadParams.sha = existingSha;
        }

        response = await this.octokit.rest.repos.createOrUpdateFileContents(uploadParams);
        break; // Upload succeeded!
      } catch (err) {
        const isConflict = err.status === 409 || (err.message && (err.message.includes('is at') || err.message.includes('expected') || err.message.includes('does not match')));
        if (isConflict && attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, 500 * attempts));
          continue;
        }
        throw new Error(`[GitHub Upload Error] Failed to upload ${repoPath}: ${err.message}`);
      }
    }

    const cdnUrl = getCdnUrl({
      owner: this.owner,
      repo: this.repo,
      branch: this.branch,
      filePath: repoPath,
      cdnProvider: this.cdnProvider,
      customCdnTemplate: this.customCdnTemplate
    });

    return {
      success: true,
      action: attempts > 1 ? 'updated (retried)' : 'created',
      filename: item.filename,
      repoPath,
      sha: response?.data?.content?.sha,
      cdnUrl,
      downloadUrl: response?.data?.content?.download_url,
      size: item.buffer.length
    };
  }



  /**
   * Delete a file from GitHub repository by file path.
   * 
   * @param {string} filePath - Path to file in repo
   * @param {string} [commitMessage] - Custom commit message
   * @returns {Promise<Object>} Deletion result
   */
  async deleteFile(filePath, commitMessage = null) {
    const normalizedPath = this.normalizeRepoPath(filePath);

    let sha;
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: normalizedPath,
        ref: this.branch,
      });

      if (Array.isArray(data)) {
        throw new Error(`[GitHub Error] Path '${normalizedPath}' is a directory, not a file.`);
      }

      sha = data.sha;
    } catch (err) {
      if (err.status === 404) {
        throw new Error(`[GitHub Error] File not found: '${normalizedPath}'`);
      }
      throw err;
    }

    const message = commitMessage || `delete: remove file ${normalizedPath}`;
    try {
      const { data } = await this.octokit.rest.repos.deleteFile({
        owner: this.owner,
        repo: this.repo,
        path: normalizedPath,
        message,
        sha,
        branch: this.branch,
      });

      return {
        success: true,
        repoPath: normalizedPath,
        commitSha: data.commit.sha,
        message: `File '${normalizedPath}' successfully deleted.`
      };
    } catch (err) {
      throw new Error(`[GitHub Delete Error] Failed to delete file '${normalizedPath}': ${err.message}`);
    }
  }

  /**
   * Delete multiple files atomically in a single Git commit using Git Trees API.
   * 
   * @param {string[]} filePaths - Array of repo file paths to delete
   * @param {string} [commitMessage] - Custom commit message
   * @returns {Promise<Object>} Result summary
   */
  async atomicDeletePaths(filePaths, commitMessage = null) {
    if (!filePaths || filePaths.length === 0) {
      return { success: true, deletedCount: 0 };
    }

    const normPaths = filePaths.map(p => this.normalizeRepoPath(p));
    const message = commitMessage || `delete: remove ${normPaths.length} file(s)`;

    // 1. Get branch ref to find current HEAD commit
    const refRes = await this.octokit.rest.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${this.branch}`,
    });
    const latestCommitSha = refRes.data.object.sha;

    // 2. Get current commit details to obtain tree SHA
    const commitRes = await this.octokit.rest.git.getCommit({
      owner: this.owner,
      repo: this.repo,
      commit_sha: latestCommitSha,
    });
    const baseTreeSha = commitRes.data.tree.sha;

    // 3. Create tree object marking specified paths for deletion (sha: null removes file in git tree)
    const treeItems = normPaths.map(p => ({
      path: p,
      mode: '100644',
      type: 'blob',
      sha: null,
    }));

    const newTreeRes = await this.octokit.rest.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: baseTreeSha,
      tree: treeItems,
    });

    // 4. Create commit
    const newCommitRes = await this.octokit.rest.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message,
      tree: newTreeRes.data.sha,
      parents: [latestCommitSha],
    });

    // 5. Update branch reference
    await this.octokit.rest.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${this.branch}`,
      sha: newCommitRes.data.sha,
    });

    return {
      success: true,
      commitSha: newCommitRes.data.sha,
      deletedCount: normPaths.length,
      filePaths: normPaths,
    };
  }

  /**
   * Batch Delete multiple files from GitHub repository in parallel or atomically.
   * 
   * @param {string[]} filePaths 
   * @param {string} [commitMessage] 
   * @param {number} [concurrencyLimit=5]
   * @param {Function} [onProgress]
   * @returns {Promise<Object>} Batch delete results
   */
  async batchDeleteFiles(filePaths, commitMessage = null, concurrencyLimit = 5, onProgress = null) {
    const normPaths = filePaths.map(p => this.normalizeRepoPath(p));
    
    // Try atomic single-commit deletion first
    try {
      const atomicRes = await this.atomicDeletePaths(normPaths, commitMessage);
      const results = normPaths.map(p => ({ success: true, repoPath: p, message: `File '${p}' deleted.` }));
      if (onProgress) {
        results.forEach(r => onProgress(r, true));
      }
      return {
        success: true,
        total: normPaths.length,
        deletedCount: normPaths.length,
        failedCount: 0,
        results,
        errors: []
      };
    } catch (atomicErr) {
      console.warn(`[GitHub Delete Warning] Atomic delete failed (${atomicErr.message}), falling back to sequential delete...`);
      const results = [];
      const errors = [];

      // Sequential deletion with delay to avoid rate limit & 409 conflict
      for (const filePath of normPaths) {
        try {
          const res = await this.deleteFile(filePath, commitMessage);
          results.push(res);
          if (onProgress) onProgress(res, true);
          await new Promise(r => setTimeout(r, 600));
        } catch (err) {
          const errObj = { filePath, error: err.message };
          errors.push(errObj);
          if (onProgress) onProgress(errObj, false);
        }
      }

      return {
        success: errors.length === 0,
        total: normPaths.length,
        deletedCount: results.length,
        failedCount: errors.length,
        results,
        errors
      };
    }
  }

  /**
   * Delete an entire folder and all its contents recursively.
   * Uses 1-commit Git Trees API (pure HTTP REST) for instant deletion.
   * 
   * @param {string} folderPath 
   * @param {Function} [onProgress]
   * @returns {Promise<Object>} Folder deletion results
   */
  async deleteFolder(folderPath, onProgress = null) {
    let normFolderPath = this.normalizeRepoPath(folderPath);

    // 1. High-speed single API call to scan file tree via getTree
    let allFilePaths = [];
    try {
      const treeRes = await this.octokit.rest.git.getTree({
        owner: this.owner,
        repo: this.repo,
        tree_sha: this.branch,
        recursive: '1'
      });

      if (treeRes.data && Array.isArray(treeRes.data.tree)) {
        let prefix = normFolderPath.endsWith('/') ? normFolderPath : `${normFolderPath}/`;
        let matchFiles = treeRes.data.tree
          .filter(item => item.type === 'blob' && (item.path === normFolderPath || item.path.startsWith(prefix)))
          .map(item => item.path);

        if (matchFiles.length === 0 && this.uploadBasePath && !normFolderPath.startsWith(this.uploadBasePath)) {
          const altFolderPath = this.normalizeRepoPath(path.join(this.uploadBasePath, normFolderPath));
          prefix = altFolderPath.endsWith('/') ? altFolderPath : `${altFolderPath}/`;
          matchFiles = treeRes.data.tree
            .filter(item => item.type === 'blob' && (item.path === altFolderPath || item.path.startsWith(prefix)))
            .map(item => item.path);
          if (matchFiles.length > 0) normFolderPath = altFolderPath;
        }
        allFilePaths = matchFiles;
      }
    } catch (treeErr) {
      // Fallback: collect via getContent recursive if getTree fails
    }

    if (allFilePaths.length === 0) {
      return {
        success: true,
        folderPath: normFolderPath,
        totalFiles: 0,
        deletedCount: 0,
        message: `Folder '${normFolderPath}' was empty or had no files.`
      };
    }

    // 2. Delete all files in 1 single Git Commit via HTTP REST (Git Trees API)
    try {
      const atomicRes = await this.atomicDeletePaths(allFilePaths, `delete folder: remove directory ${normFolderPath}`);
      return {
        success: true,
        folderPath: normFolderPath,
        totalFiles: allFilePaths.length,
        deletedCount: atomicRes.deletedCount,
        commitSha: atomicRes.commitSha,
        action: 'deleted (git-trees-api)',
        message: `Folder '${normFolderPath}' (${allFilePaths.length} files) deleted in 1 atomic commit.`
      };
    } catch (atomicErr) {
      console.warn(`[Git Trees API Delete Warning] Single-commit delete failed (${atomicErr.message}), falling back to parallel batch delete...`);
    }

    // 3. Fallback: Parallel Batch Delete
    const batchResult = await this.batchDeleteFiles(
      allFilePaths,
      `delete folder: remove directory ${normFolderPath}`,
      5,
      onProgress
    );
    return {
      success: batchResult.success,
      folderPath: normFolderPath,
      totalFiles: allFilePaths.length,
      deletedCount: batchResult.deletedCount,
      failedCount: batchResult.failedCount,
      details: batchResult
    };
  }

  /**
   * Rename or move a file in GitHub repository.
   * 
   * @param {string} oldPath - Existing file path
   * @param {string} newPath - Target file path
   * @returns {Promise<Object>} Rename/Move result
   */
  async renameFile(oldPath, newPath) {
    const normOldPath = this.normalizeRepoPath(oldPath);
    const normNewPath = this.normalizeRepoPath(newPath);

    if (normOldPath === normNewPath) {
      throw new Error('[GitHub Error] Source path and destination path are identical.');
    }

    let sourceData;
    try {
      const response = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: normOldPath,
        ref: this.branch,
      });
      sourceData = response.data;

      if (Array.isArray(sourceData)) {
        throw new Error(`[GitHub Error] '${normOldPath}' is a directory. Folder moving should be performed per file.`);
      }
    } catch (err) {
      if (err.status === 404) {
        throw new Error(`[GitHub Error] Source file not found: '${normOldPath}'`);
      }
      throw err;
    }

    let contentBase64 = sourceData.content ? sourceData.content.replace(/\n/g, '') : null;
    if (!contentBase64 && sourceData.download_url) {
      const res = await fetch(sourceData.download_url);
      const arrayBuffer = await res.arrayBuffer();
      contentBase64 = Buffer.from(arrayBuffer).toString('base64');
    }

    if (!contentBase64) {
      throw new Error(`[GitHub Error] Could not retrieve content for file '${normOldPath}'.`);
    }

    try {
      await this.octokit.rest.repos.createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path: normNewPath,
        message: `move: move ${normOldPath} to ${normNewPath}`,
        content: contentBase64,
        branch: this.branch,
      });
    } catch (err) {
      throw new Error(`[GitHub Move Error] Failed to write new file at '${normNewPath}': ${err.message}`);
    }

    try {
      await this.octokit.rest.repos.deleteFile({
        owner: this.owner,
        repo: this.repo,
        path: normOldPath,
        message: `move cleanup: remove ${normOldPath}`,
        sha: sourceData.sha,
        branch: this.branch,
      });
    } catch (err) {
      console.warn(`[GitHub Move Warning] File created at '${normNewPath}', but failed to delete old file '${normOldPath}': ${err.message}`);
    }

    const cdnUrl = getCdnUrl({
      owner: this.owner,
      repo: this.repo,
      branch: this.branch,
      filePath: normNewPath,
      cdnProvider: this.cdnProvider,
      customCdnTemplate: this.customCdnTemplate
    });

    return {
      success: true,
      oldPath: normOldPath,
      newPath: normNewPath,
      cdnUrl
    };
  }

  /**
   * Batch Move multiple files to a target destination folder in parallel.
   * 
   * @param {string[]} filePaths - Array of source file paths
   * @param {string} targetFolder - Destination directory
   * @param {number} [concurrencyLimit=5]
   * @returns {Promise<Object>} Batch move results
   */
  async batchMoveFiles(filePaths, targetFolder, concurrencyLimit = 5) {
    const results = [];
    const errors = [];
    const normTargetFolder = this.normalizeRepoPath(targetFolder);

    await mapConcurrent(filePaths, concurrencyLimit, async (oldPath) => {
      try {
        const filename = path.posix.basename(oldPath);
        const newPath = normTargetFolder ? `${normTargetFolder}/${filename}` : filename;
        const res = await this.renameFile(oldPath, newPath);
        results.push(res);
      } catch (err) {
        errors.push({ oldPath, error: err.message });
      }
    });

    return {
      success: errors.length === 0,
      total: filePaths.length,
      movedCount: results.length,
      failedCount: errors.length,
      results,
      errors
    };
  }

  /**
   * Downloads all files from a specified folder in the repository to local directory.
   * Phase 1: Collect all file metadata recursively
   * Phase 2: Batch download file buffers via Octokit API (getContent / getBlob) & write to disk
   * 
   * @param {string} folderPath 
   * @param {string} outputDir 
   * @param {number} [concurrencyLimit=5]
   * @param {Function} [onProgress]
   * @returns {Promise<Object>} Archive result details
   */
  async downloadFolderArchive(folderPath, outputDir, concurrencyLimit = 5, onProgress = null) {
    let normFolderPath = this.normalizeRepoPath(folderPath || '');

    if (normFolderPath && !normFolderPath.includes('/') && this.uploadBasePath) {
      const altPath = this.normalizeRepoPath(path.join(this.uploadBasePath, normFolderPath));
      try {
        await this.octokit.rest.repos.getContent({ owner: this.owner, repo: this.repo, path: altPath, ref: this.branch });
        normFolderPath = altPath;
      } catch (e) {
        // keep original path if altPath fails
      }
    }

    // Phase 1: Collect all file entries recursively (with retry)
    const fileEntries = [];

    const collectEntries = async (currentPath, retryCount = 0) => {
      let contents;
      try {
        const { data } = await this.octokit.rest.repos.getContent({
          owner: this.owner,
          repo: this.repo,
          path: currentPath,
          ref: this.branch,
        });
        contents = Array.isArray(data) ? data : [data];
      } catch (err) {
        if (err.status === 404) {
          throw new Error(`[GitHub Error] Remote folder not found: '${currentPath}'`);
        }
        if (retryCount < 3 && (err.status === 500 || err.message?.includes('Timeout') || err.message?.includes('fetch failed'))) {
          console.warn(`[Archive Warning] Directory fetch retry (${retryCount + 1}/3) for '${currentPath}'...`);
          await new Promise((r) => setTimeout(r, 1200 * (retryCount + 1)));
          return collectEntries(currentPath, retryCount + 1);
        }
        throw err;
      }

      for (const item of contents) {
        if (item.type === 'dir') {
          await collectEntries(item.path);
        } else if (item.type === 'file') {
          let relPath = item.path;
          if (normFolderPath && relPath.startsWith(normFolderPath)) {
            relPath = relPath.substring(normFolderPath.length).replace(/^\/+/, '');
          }
          fileEntries.push({
            repoPath: item.path,
            relPath: relPath || item.name,
            sha: item.sha,
            size: item.size,
            downloadUrl: item.download_url,
            contentBase64: item.content ? item.content.replace(/\n/g, '') : null
          });
        }
      }
    };

    await collectEntries(normFolderPath);

    if (fileEntries.length === 0) {
      return {
        success: true,
        remoteFolder: normFolderPath,
        localDirectory: path.resolve(outputDir),
        totalFiles: 0,
        downloadedCount: 0,
        failedCount: 0,
        files: [],
        message: `Folder '${normFolderPath || 'root'}' is empty or has no files.`
      };
    }

    const targetLocalDir = path.resolve(outputDir);
    await fs.mkdir(targetLocalDir, { recursive: true });

    const downloadedFiles = [];
    const errors = [];

    // Phase 2: Batch download & save files using multi-channel fallback pool
    await mapConcurrent(fileEntries, concurrencyLimit, async (entry) => {
      const localTarget = path.join(targetLocalDir, entry.relPath);
      await fs.mkdir(path.dirname(localTarget), { recursive: true });

      try {
        let fileBuffer = null;

        // Channel 1: High-speed CDN acceleration download (jsDelivr / ChinaJsDelivr - domestic ultra fast!)
        const cdnUrl = getCdnUrl({
          owner: this.owner,
          repo: this.repo,
          branch: this.branch,
          filePath: entry.repoPath,
          cdnProvider: this.cdnProvider,
          customCdnTemplate: this.customCdnTemplate
        });

        if (cdnUrl) {
          try {
            const res = await fetch(cdnUrl, { signal: AbortSignal.timeout(15000) });
            if (res.ok) {
              const arrayBuffer = await res.arrayBuffer();
              fileBuffer = Buffer.from(arrayBuffer);
            }
          } catch (cdnErr) {
            // CDN fetch failed, silently fallback to Blobs / getContent
          }
        }

        // Channel 2: Base64 content from getContent response
        if (!fileBuffer && entry.contentBase64) {
          fileBuffer = Buffer.from(entry.contentBase64, 'base64');
        }

        // Channel 3: Fetch via Octokit Git Blob API (authenticated API endpoint)
        if (!fileBuffer && entry.sha) {
          try {
            const blobRes = await this.octokit.rest.git.getBlob({
              owner: this.owner,
              repo: this.repo,
              file_sha: entry.sha
            });
            if (blobRes.data && blobRes.data.content) {
              fileBuffer = Buffer.from(blobRes.data.content, blobRes.data.encoding || 'base64');
            }
          } catch (blobErr) {
            console.warn(`[Archive Warning] Git Blob API fallback for ${entry.repoPath}: ${blobErr.message}`);
          }
        }

        // Channel 4: Direct raw download_url fallback
        if (!fileBuffer && entry.downloadUrl) {
          const res = await fetch(entry.downloadUrl, { signal: AbortSignal.timeout(20000) });
          if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
          const arrayBuffer = await res.arrayBuffer();
          fileBuffer = Buffer.from(arrayBuffer);
        }

        if (!fileBuffer) {
          throw new Error(`Failed to retrieve file content for '${entry.repoPath}'`);
        }

        await fs.writeFile(localTarget, fileBuffer);
        const itemInfo = {
          repoPath: entry.repoPath,
          localPath: localTarget,
          size: fileBuffer.length
        };
        downloadedFiles.push(itemInfo);
        if (onProgress) onProgress(itemInfo, true);
      } catch (err) {
        const errObj = { repoPath: entry.repoPath, error: err.message };
        errors.push(errObj);
        if (onProgress) onProgress(errObj, false);
      }
    });

    return {
      success: errors.length === 0,
      remoteFolder: normFolderPath,
      localDirectory: targetLocalDir,
      totalFiles: fileEntries.length,
      downloadedCount: downloadedFiles.length,
      failedCount: errors.length,
      files: downloadedFiles,
      errors
    };
  }

  /* ==========================================================================
     Repository Management API Methods
     ========================================================================== */

  /**
   * List all repositories for authenticated user.
   */
  async listRepositories(options = {}) {
    const { data } = await this.octokit.rest.repos.listForAuthenticatedUser({
      affiliation: 'owner,collaborator,organization_member',
      sort: 'updated',
      direction: 'desc',
      per_page: 100,
      ...options
    });
    return data.map(repo => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      owner: repo.owner.login,
      isPrivate: repo.private,
      visibility: repo.visibility || (repo.private ? 'private' : 'public'),
      description: repo.description || '',
      defaultBranch: repo.default_branch || 'main',
      htmlUrl: repo.html_url,
      updatedAt: repo.updated_at,
      stars: repo.stargazers_count || 0,
      size: repo.size || 0
    }));
  }

  /**
   * Create a new repository for authenticated user.
   */
  async createRepository({ name, description = '', isPrivate = false }) {
    if (!name) throw new Error('[GitHub Error] Repository name is required.');
    const { data } = await this.octokit.rest.repos.createForAuthenticatedUser({
      name: name.trim(),
      description: description.trim(),
      private: Boolean(isPrivate),
      auto_init: true
    });
    return {
      success: true,
      id: data.id,
      name: data.name,
      fullName: data.full_name,
      owner: data.owner.login,
      isPrivate: data.private,
      visibility: data.visibility || (data.private ? 'private' : 'public'),
      htmlUrl: data.html_url
    };
  }

  /**
   * Update repository visibility, description, or name.
   */
  async updateRepository(owner, repo, updates = {}) {
    const { data } = await this.octokit.rest.repos.update({
      owner,
      repo,
      ...updates
    });
    return {
      success: true,
      name: data.name,
      fullName: data.full_name,
      owner: data.owner.login,
      isPrivate: data.private,
      visibility: data.visibility || (data.private ? 'private' : 'public'),
      description: data.description || ''
    };
  }

  /**
   * Delete a repository by owner and name.
   */
  async deleteRepository(owner, repo) {
    await this.octokit.rest.repos.delete({
      owner,
      repo
    });
    return { success: true, message: `Repository ${owner}/${repo} successfully deleted.` };
  }
}
