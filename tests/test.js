import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { calculateHash, processSingleImage, saveProcessedFile } from '../src/imageProcessor.js';
import { getJsDelivrUrl } from '../src/cdnHelper.js';
import { getConfig } from '../src/config.js';
import { getFormattedDate } from '../src/githubClient.js';
import { startServer } from '../src/server.js';

async function runTests() {
  console.log('🧪 Running automated tests...\n');

  // Test 1: Date format check YYYY-MM-DD
  const dateStr = getFormattedDate();
  assert.match(dateStr, /^\d{4}-\d{2}-\d{2}$/, 'Date string should match YYYY-MM-DD');
  console.log(`✅ [Pass] getFormattedDate() -> ${dateStr}`);

  // Test 2: CDN Helper
  const cdnUrl = getJsDelivrUrl({
    owner: 'testuser',
    repo: 'testrepo',
    branch: 'main',
    filePath: '2026-09-18/abcd.webp'
  });
  assert.equal(
    cdnUrl,
    'https://cdn.jsdelivr.net/gh/testuser/testrepo@main/2026-09-18/abcd.webp',
    'jsDelivr URL generated correctly without base path'
  );
  console.log(`✅ [Pass] getJsDelivrUrl() -> ${cdnUrl}`);

  // Test 3: Sharp WebP conversion and SHA-256 calculation
  const testImgBuffer = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 }
    }
  }).png().toBuffer();

  const processed = await processSingleImage(testImgBuffer, 80, true, 'test.png');
  assert.equal(processed.format, 'webp');
  assert.equal(processed.width, 100);
  assert.equal(processed.height, 100);
  assert.ok(processed.hash.length === 64, 'SHA-256 hash should be 64 hex characters');
  assert.equal(processed.filename, `${processed.hash}.webp`);

  const expectedHash = calculateHash(processed.buffer);
  assert.equal(processed.hash, expectedHash, 'Hash of webp buffer matches calculation');

  console.log(`✅ [Pass] processSingleImage() & SHA-256 Hash -> ${processed.filename} (${processed.processedSize} bytes)`);

  // Test 4: Save processed image to output directory
  const tempOutputDir = path.join(process.cwd(), 'scratch_test_output');
  const savedPath = await saveProcessedFile(processed, tempOutputDir);
  assert.ok(savedPath, 'saveProcessedFile should return saved file path');
  const fileExists = await fs.stat(savedPath).then(s => s.isFile()).catch(() => false);
  assert.equal(fileExists, true, 'File should exist on disk at saved path');
  await fs.rm(tempOutputDir, { recursive: true, force: true });
  console.log(`✅ [Pass] saveProcessedFile() -> Successfully saved compressed file to '${savedPath}'`);

  // Test 4.5: processSingleImage directly with outputDir argument
  const directProcessed = await processSingleImage(testImgBuffer, 80, true, 'test2.png', null, tempOutputDir);
  assert.ok(directProcessed.savedPath, 'directProcessed should have savedPath');
  const directFileExists = await fs.stat(directProcessed.savedPath).then(s => s.isFile()).catch(() => false);
  assert.equal(directFileExists, true, 'Directly saved file should exist on disk');
  await fs.rm(tempOutputDir, { recursive: true, force: true });
  console.log(`✅ [Pass] processSingleImage(..., outputDir) -> Automatically saved compressed file to '${directProcessed.savedPath}'`);

  // Test 5: Config loader test (uploadBasePath and outputDir exist)
  const config = await getConfig();
  assert.ok(typeof config.imageQuality === 'number');
  assert.equal(typeof config.uploadBasePath, 'string');
  assert.equal(typeof config.outputDir, 'string');
  console.log(`✅ [Pass] getConfig() -> uploadBasePath: '${config.uploadBasePath}', outputDir: '${config.outputDir}', quality: ${config.imageQuality}`);

  // Test 6: Express Web Server API Test
  const testPort = 3099;
  const server = startServer(testPort);
  try {
    const res = await fetch(`http://localhost:${testPort}/api/config`);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.config);
    assert.equal(typeof data.config.outputDir, 'string');
    console.log(`✅ [Pass] Express Web Server GET /api/config returned HTTP 200 OK with outputDir`);
  } finally {
    server.close();
  }

  console.log('\n🎉 All unit, module, batch & server tests passed successfully!');
}

runTests().catch((err) => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
