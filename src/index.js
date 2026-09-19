#!/usr/bin/env node

import path from 'node:path';
import { Command } from 'commander';
import { getConfig, validateConfig } from './config.js';
import { processLocalImages, saveProcessedFile } from './imageProcessor.js';
import { GitHubManager } from './githubClient.js';
import { startServer } from './server.js';

const program = new Command();

program
  .name('img-gh')
  .description('Node.js Image Automation Processing & GitHub Hosting Tool with Web UI & jsDelivr CDN')
  .version('1.1.0');

/**
 * Command: server
 * Launch Express Web UI server
 */
program
  .command('server')
  .description('Start the Web UI server for browser interaction')
  .option('-p, --port <number>', 'Port to run server on', '3000')
  .action((options) => {
    const port = parseInt(options.port, 10);
    startServer(port);
  });

/**
 * Command: upload
 * Process local images and upload to GitHub
 */
program
  .command('upload <localPath>')
  .description('Process local image(s), convert to WebP with SHA-256 hash name, and upload to GitHub')
  .option('-q, --quality <number>', 'WebP compression quality (1-100)')
  .option('-s, --subfolder <folder>', 'Override date subfolder name (default: YYYY-MM-DD)')
  .option('-o, --output <dir>', 'Specify local directory to save compressed/processed images')
  .option('-c, --config <path>', 'Custom configuration file path (config.json)')
  .action(async (localPath, options) => {
    try {
      console.log('🚀 Loading configuration...');
      const config = await getConfig(options.config);
      validateConfig(config);

      const quality = options.quality ? parseInt(options.quality, 10) : config.imageQuality;
      const outputDir = options.output || config.outputDir;

      console.log(`🖼️  Processing local images at '${localPath}' (WebP Quality: ${quality})...`);

      const processedImages = await processLocalImages(localPath, quality, config.enableCompression, config.concurrencyLimit, config.supportedImageExts);
      if (processedImages.length === 0) {
        console.log('⚠️  No valid images found to process.');
        return;
      }

      if (outputDir) {
        console.log(`💾 Saving processed image(s) to local output directory '${outputDir}'...`);
        for (const item of processedImages) {
          const savedPath = await saveProcessedFile(item, outputDir);
          if (savedPath) {
            console.log(`  💾 Saved: ${savedPath}`);
          }
        }
      }

      console.log(`✅ Processed ${processedImages.length} image(s). Connecting to GitHub repo '${config.owner}/${config.repo}'...`);
      const ghManager = new GitHubManager(config);

      const results = [];
      for (let i = 0; i < processedImages.length; i++) {
        const item = processedImages[i];
        console.log(`\n[${i + 1}/${processedImages.length}] Uploading ${item.filename} (${(item.processedSize / 1024).toFixed(2)} KB)...`);

        const result = await ghManager.uploadImage(item, options.subfolder);
        results.push(result);

        console.log(`  🎉 ${result.action.toUpperCase()} -> Repo Path: ${result.repoPath}`);
        console.log(`  🔗 jsDelivr CDN: ${result.cdnUrl}`);
      }

      console.log('\n======================================================');
      console.log(`✨ Upload Task Completed! Total: ${results.length} file(s).`);
      console.log('======================================================\n');
      console.log('CDN URLs List:');
      results.forEach((r) => console.log(r.cdnUrl));

    } catch (err) {
      console.error(`\n❌ [Error] ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Command: delete
 */
program
  .command('delete <repoPath>')
  .description('Delete a specified file from GitHub repository')
  .option('-m, --message <commitMessage>', 'Custom commit message')
  .option('-c, --config <path>', 'Custom configuration file path')
  .action(async (repoPath, options) => {
    try {
      console.log('🚀 Loading configuration...');
      const config = await getConfig(options.config);
      validateConfig(config);

      console.log(`🗑️  Deleting remote file '${repoPath}' from '${config.owner}/${config.repo}'...`);
      const ghManager = new GitHubManager(config);

      const result = await ghManager.deleteFile(repoPath, options.message);
      console.log(`\n✅ ${result.message}`);
      console.log(`   Commit SHA: ${result.commitSha}`);
    } catch (err) {
      console.error(`\n❌ [Error] ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Command: move / rename
 */
program
  .command('move <oldPath> <newPath>')
  .alias('rename')
  .description('Rename or move an existing file in GitHub repository')
  .option('-c, --config <path>', 'Custom configuration file path')
  .action(async (oldPath, newPath, options) => {
    try {
      console.log('🚀 Loading configuration...');
      const config = await getConfig(options.config);
      validateConfig(config);

      console.log(`🚚 Moving file from '${oldPath}' to '${newPath}'...`);
      const ghManager = new GitHubManager(config);

      const result = await ghManager.renameFile(oldPath, newPath);
      console.log(`\n✅ Successfully moved file!`);
      console.log(`   Old Path: ${result.oldPath}`);
      console.log(`   New Path: ${result.newPath}`);
      console.log(`   🔗 New jsDelivr CDN: ${result.cdnUrl}`);
    } catch (err) {
      console.error(`\n❌ [Error] ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Command: download
 */
program
  .command('download <folderPath> <outputDir>')
  .description('Download and archive all files from a GitHub repository folder (e.g. date folder) to local directory')
  .option('-c, --config <path>', 'Custom configuration file path')
  .action(async (folderPath, outputDir, options) => {
    try {
      console.log('🚀 Loading configuration...');
      const config = await getConfig(options.config);
      validateConfig(config);

      console.log(`📥 Downloading remote folder '${folderPath}' to local directory '${outputDir}'...`);
      const ghManager = new GitHubManager(config);

      const result = await ghManager.downloadFolderArchive(folderPath, outputDir);
      console.log(`\n✅ Download Completed! Saved ${result.totalFiles} file(s) to '${result.localDirectory}'.`);
      result.files.forEach((f) => {
        console.log(`   - ${f.repoPath} -> ${f.localPath} (${(f.size / 1024).toFixed(2)} KB)`);
      });
    } catch (err) {
      console.error(`\n❌ [Error] ${err.message}`);
      process.exit(1);
    }
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  // Default to running server if no CLI subcommand passed
  startServer();
}
