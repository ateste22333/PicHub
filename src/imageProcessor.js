import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

/**
 * Helper to parse custom supported extension string into a Set of lowercased extensions starting with '.'
 * @param {string|Set} extListStr 
 * @returns {Set<string>}
 */
export function parseSupportedExtensions(extListStr) {
  if (extListStr instanceof Set) return extListStr;
  const defaultSet = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.tif', '.avif', '.bmp', '.svg', '.ico']);
  if (!extListStr || typeof extListStr !== 'string') return defaultSet;
  const parts = extListStr.split(/[,|\s]+/);
  const set = new Set();
  for (let p of parts) {
    p = p.trim().toLowerCase();
    if (!p) continue;
    if (!p.startsWith('.')) p = '.' + p;
    set.add(p);
  }
  return set.size > 0 ? set : defaultSet;
}

/**
 * Calculates SHA-256 hash of a Buffer.
 * @param {Buffer} buffer 
 * @returns {string} SHA-256 hash hex string
 */
export function calculateHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Process a single file: convert image to WebP (if enabled & supported format) or upload original uncompressed.
 * 
 * @param {string|Buffer} input - File path or buffer
 * @param {number} quality - WebP compression quality (1-100)
 * @param {boolean} enableCompression - Whether to compress & convert to WebP
 * @param {string} [originalFilename] - Original filename
 * @param {string|Set} [supportedImageExts] - Custom supported image extensions
 * @param {string} [outputDir] - Optional local output directory to save compressed file
 * @returns {Promise<Object>} Processed file detail
 */
export async function processSingleImage(input, quality = 80, enableCompression = true, originalFilename = null, supportedImageExts = null, outputDir = null) {
  let inputBuffer;
  let originalPath = typeof input === 'string' ? input : null;
  let filenameToUse = originalPath || originalFilename || 'file.bin';
  let origExt = path.extname(filenameToUse).toLowerCase() || '.bin';

  if (typeof input === 'string') {
    inputBuffer = await fs.readFile(input);
  } else {
    inputBuffer = input;
  }

  const supportedSet = parseSupportedExtensions(supportedImageExts);
  const isImageFormat = supportedSet.has(origExt);

  let finalBuffer;
  let format;
  let outputFilename;
  let isCompressed = false;

  if (enableCompression && isImageFormat) {
    try {
      finalBuffer = await sharp(inputBuffer)
        .webp({ quality: Math.min(100, Math.max(1, quality)) })
        .toBuffer();
      format = 'webp';
      const hash = calculateHash(finalBuffer);
      outputFilename = `${hash}.webp`;
      isCompressed = true;
    } catch (err) {
      // Fallback to uncompressed if sharp failed (e.g. invalid raster/svg)
      finalBuffer = inputBuffer;
      format = origExt.replace(/^\./, '');
      const hash = calculateHash(finalBuffer);
      outputFilename = `${hash}${origExt}`;
      isCompressed = false;
    }
  } else {
    // Non-image file or format not in supported list or compression disabled:
    // Direct upload original file without compression!
    finalBuffer = inputBuffer;
    format = origExt.replace(/^\./, '');
    const hash = calculateHash(finalBuffer);
    outputFilename = `${hash}${origExt}`;
    isCompressed = false;
  }

  const hash = calculateHash(finalBuffer);
  let metadata = { width: null, height: null };

  if (isImageFormat) {
    try {
      metadata = await sharp(finalBuffer).metadata();
    } catch (err) {
      metadata = { width: null, height: null };
    }
  }

  let savedPath = null;
  if (outputDir) {
    savedPath = await saveProcessedFile({ buffer: finalBuffer, filename: outputFilename }, outputDir);
  }

  return {
    originalPath,
    originalSize: inputBuffer.length,
    processedSize: finalBuffer.length,
    hash,
    filename: outputFilename,
    buffer: finalBuffer,
    width: metadata.width || null,
    height: metadata.height || null,
    format,
    isCompressed,
    isImage: isImageFormat,
    savedPath
  };
}

/**
 * Recursively scans directory for files.
 * 
 * @param {string} dirPath - Local directory path
 * @returns {Promise<string[]>} Array of file absolute paths
 */
export async function scanImageFiles(dirPath) {
  const files = [];

  async function traverse(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') {
          await traverse(fullPath);
        }
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await traverse(path.resolve(dirPath));
  return files;
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
 * Process all files in a local directory or single file.
 * 
 * @param {string} localPath - Directory path or file path
 * @param {number} quality - Quality setting
 * @param {boolean} enableCompression - Enable WebP compression
 * @param {number} [concurrencyLimit=5] - Parallel processing concurrency pool size
 * @param {string|Set} [supportedImageExts] - Custom supported image extensions
 * @param {string} [outputDir] - Optional local output directory to save compressed files
 * @returns {Promise<Object[]>} Array of processed file details
 */
export async function processLocalImages(localPath, quality = 80, enableCompression = true, concurrencyLimit = 5, supportedImageExts = null, outputDir = null) {
  const stat = await fs.stat(localPath);
  const targetFiles = [];

  if (stat.isFile()) {
    targetFiles.push(path.resolve(localPath));
  } else if (stat.isDirectory()) {
    const scanned = await scanImageFiles(localPath);
    targetFiles.push(...scanned);
  } else {
    throw new Error(`[ImageProcessor Error] Invalid path: ${localPath}`);
  }

  const results = [];
  await mapConcurrent(targetFiles, concurrencyLimit, async (filePath) => {
    try {
      const processed = await processSingleImage(filePath, quality, enableCompression, null, supportedImageExts, outputDir);
      results.push(processed);
    } catch (err) {
      console.error(`[ImageProcessor Error] Failed to process ${filePath}: ${err.message}`);
    }
  });

  return results;
}

/**
 * Saves a processed image/file buffer to specified local output folder.
 * 
 * @param {Object} processed - Processed image object with buffer and filename
 * @param {string} outputDir - Target local directory
 * @returns {Promise<string|null>} Path where file was saved, or null if outputDir not specified
 */
export async function saveProcessedFile(processed, outputDir) {
  if (!outputDir || !processed || !processed.buffer || !processed.filename) return null;
  try {
    const targetDir = path.resolve(outputDir);
    await fs.mkdir(targetDir, { recursive: true });
    const savePath = path.join(targetDir, processed.filename);
    await fs.writeFile(savePath, processed.buffer);
    return savePath;
  } catch (err) {
    console.error(`[ImageProcessor Warning] Failed to save processed file to output directory '${outputDir}': ${err.message}`);
    return null;
  }
}

