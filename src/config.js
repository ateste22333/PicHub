import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Loads configuration from config.json or environment variables.
 * Priority: custom config.json > .env / process.env > defaults
 * 
 * @param {string} [customPath] - Optional path to config.json
 * @returns {Promise<Object>} Configuration object
 */
export async function getConfig(customPath = null) {
  let fileConfig = {};

  const jsonPathsToTry = customPath
    ? [path.resolve(customPath)]
    : [
        path.resolve(process.cwd(), 'config.json'),
        path.resolve(process.cwd(), 'config.local.json')
      ];

  for (const configPath of jsonPathsToTry) {
    try {
      const data = await fs.readFile(configPath, 'utf8');
      fileConfig = JSON.parse(data);
      break;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[Config Warning] Failed to parse config file at ${configPath}: ${err.message}`);
      }
    }
  }

  const config = {
    githubToken: fileConfig.githubToken || process.env.GITHUB_TOKEN || '',
    owner: fileConfig.owner || process.env.GITHUB_OWNER || '',
    repo: fileConfig.repo || process.env.GITHUB_REPO || '',
    branch: fileConfig.branch || process.env.GITHUB_BRANCH || 'main',
    uploadBasePath: fileConfig.uploadBasePath ?? process.env.UPLOAD_BASE_PATH ?? '',
    imageQuality: parseInt(fileConfig.imageQuality || process.env.IMAGE_QUALITY || '80', 10),
    enableCompression: fileConfig.enableCompression ?? (process.env.ENABLE_COMPRESSION !== 'false'),
    uploadMode: fileConfig.uploadMode || process.env.UPLOAD_MODE || '1', // Mode 1, Mode 2, Mode 3 or 'date', 'custom', 'root'
    customFolderName: fileConfig.customFolderName || process.env.CUSTOM_FOLDER_NAME || 'uploads',
    concurrencyLimit: Math.min(20, Math.max(1, parseInt(fileConfig.concurrencyLimit || process.env.CONCURRENCY_LIMIT || '5', 10))),
    cdnProvider: fileConfig.cdnProvider || process.env.CDN_PROVIDER || 'jsDelivr',
    customCdnTemplate: fileConfig.customCdnTemplate || process.env.CUSTOM_CDN_TEMPLATE || '',
    supportedImageExts: fileConfig.supportedImageExts || process.env.SUPPORTED_IMAGE_EXTS || 'jpg, jpeg, png, webp, gif, tiff, bmp, svg, avif, ico',
    outputDir: fileConfig.outputDir ?? process.env.OUTPUT_DIR ?? '',
  };

  return config;
}

/**
 * Saves updated configuration to config.json file.
 * @param {Object} newConfig 
 * @param {string} [customPath] 
 */
export async function saveConfig(newConfig, customPath = null) {
  const targetPath = customPath ? path.resolve(customPath) : path.resolve(process.cwd(), 'config.json');

  const merged = {
    githubToken: newConfig.githubToken ?? process.env.GITHUB_TOKEN ?? '',
    owner: newConfig.owner ?? process.env.GITHUB_OWNER ?? '',
    repo: newConfig.repo ?? process.env.GITHUB_REPO ?? '',
    branch: newConfig.branch ?? process.env.GITHUB_BRANCH ?? 'main',
    uploadBasePath: newConfig.uploadBasePath ?? process.env.UPLOAD_BASE_PATH ?? '',
    imageQuality: parseInt(newConfig.imageQuality ?? process.env.IMAGE_QUALITY ?? '80', 10),
    enableCompression: Boolean(newConfig.enableCompression ?? true),
    uploadMode: String(newConfig.uploadMode || '1'),
    customFolderName: newConfig.customFolderName || 'uploads',
    concurrencyLimit: Math.min(20, Math.max(1, parseInt(newConfig.concurrencyLimit ?? '5', 10))),
    cdnProvider: newConfig.cdnProvider || 'jsDelivr',
    customCdnTemplate: newConfig.customCdnTemplate || '',
    supportedImageExts: newConfig.supportedImageExts || 'jpg, jpeg, png, webp, gif, tiff, bmp, svg, avif, ico',
    uploadEngine: newConfig.uploadEngine || 'git',
    outputDir: newConfig.outputDir || '',
  };

  await fs.writeFile(targetPath, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

/**
 * Validates that required GitHub configuration parameters are present.
 * @param {Object} config 
 */
export function validateConfig(config) {
  const missing = [];
  if (!config.githubToken) missing.push('GitHub Token (githubToken / GITHUB_TOKEN)');
  if (!config.owner) missing.push('GitHub Owner (owner / GITHUB_OWNER)');
  if (!config.repo) missing.push('GitHub Repo (repo / GITHUB_REPO)');

  if (missing.length > 0) {
    throw new Error(
      `[Config Error] Missing required configuration fields:\n  - ${missing.join('\n  - ')}\n` +
      `Please set them in config.json or via Web UI settings.`
    );
  }
}
