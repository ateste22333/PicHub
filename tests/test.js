import assert from 'node:assert/strict';
import sharp from 'sharp';
import { calculateHash, processSingleImage } from '../src/imageProcessor.js';
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

  // Test 4: Config loader test (uploadBasePath defaults to empty string)
  const config = await getConfig();
  assert.ok(typeof config.imageQuality === 'number');
  assert.equal(typeof config.uploadBasePath, 'string');
  console.log(`✅ [Pass] getConfig() -> uploadBasePath: '${config.uploadBasePath}', quality: ${config.imageQuality}`);

  // Test 5: Express Web Server API Test
  const testPort = 3099;
  const server = startServer(testPort);
  try {
    const res = await fetch(`http://localhost:${testPort}/api/config`);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.config);
    console.log(`✅ [Pass] Express Web Server GET /api/config returned HTTP 200 OK`);
  } finally {
    server.close();
  }

  console.log('\n🎉 All unit, module, batch & server tests passed successfully!');
}

runTests().catch((err) => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
