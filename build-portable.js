import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

async function buildPortablePackage() {
  const rootDir = process.cwd();
  const distDir = path.join(rootDir, 'dist_release');

  console.log('📦 开始构建便携版绿色免安装包...');

  // 1. 清理并新建 dist_release 目录
  if (fsSync.existsSync(distDir)) {
    await fs.rm(distDir, { recursive: true, force: true });
  }
  await fs.mkdir(distDir, { recursive: true });

  // 2. 拷贝便携版 node.exe
  const currentNodeExe = process.execPath;
  console.log(`📋 拷贝 Node.js 运行时 (${currentNodeExe} -> dist_release/node.exe)...`);
  await fs.copyFile(currentNodeExe, path.join(distDir, 'node.exe'));

  // 3. 拷贝核心代码与依赖目录 (src, public, node_modules)
  const dirsToCopy = ['src', 'public', 'node_modules'];
  for (const dir of dirsToCopy) {
    const srcPath = path.join(rootDir, dir);
    const destPath = path.join(distDir, dir);
    if (fsSync.existsSync(srcPath)) {
      console.log(`📁 拷贝目录: ${dir}...`);
      try {
        await fs.cp(srcPath, destPath, { recursive: true, force: true });
        console.log(`  ✅ 目录 ${dir} 拷贝完成`);
      } catch (copyErr) {
        console.error(`  ❌ 拷贝目录 ${dir} 失败: ${copyErr.message}`);
      }
    }
  }

  // 4. 拷贝配置文件与说明文档 (自动脱敏隐私 Token)
  const filesToCopy = ['config.json.example', 'package.json', 'README.md'];
  for (const file of filesToCopy) {
    const srcPath = path.join(rootDir, file);
    const destPath = path.join(distDir, file);
    if (fsSync.existsSync(srcPath)) {
      console.log(`📄 拷贝文件: ${file}...`);
      await fs.copyFile(srcPath, destPath);
    }
  }

  // 保证打包出来的 config.json 是安全的初始干净配置 (清除私有 Token)
  const cleanConfigPath = path.join(distDir, 'config.json');
  const exampleConfigPath = path.join(rootDir, 'config.json.example');
  if (fsSync.existsSync(exampleConfigPath)) {
    console.log('🔒 自动脱敏并生成干净的 config.json (隐私保护)...');
    const exampleRaw = await fs.readFile(exampleConfigPath, 'utf8');
    const exampleObj = JSON.parse(exampleRaw);
    exampleObj.githubToken = ''; // 强制清除 Token
    await fs.writeFile(cleanConfigPath, JSON.stringify(exampleObj, null, 2), 'utf8');
  }

  // 5. 生成一键启动 BAT 脚本 (启动系统.bat)
  const startBatContent = `@echo off
title GitHub Image Hosting System

cd /d "%~dp0"

echo ========================================================
echo   Starting GitHub Image Hosting System...
echo   Web UI Dashboard: http://localhost:3000
echo ========================================================
echo.

if exist "%~dp0node.exe" (
    set "NODE_CMD=%~dp0node.exe"
) else (
    set "NODE_CMD=node"
)

start http://localhost:3000

"%NODE_CMD%" "%~dp0src\\server.js"

pause
`;
  await fs.writeFile(path.join(distDir, '启动系统.bat'), startBatContent, 'ascii');

  // 6. 生成一键停止 BAT 脚本 (停止系统.bat)
  const stopBatContent = `@echo off
title Stop GitHub Image Hosting System

echo Stopping Node.js server process...
taskkill /f /im node.exe >nul 2>&1
echo Server stopped.
timeout /t 2 >nul
`;
  await fs.writeFile(path.join(distDir, '停止系统.bat'), stopBatContent, 'ascii');

  console.log('\n========================================================');
  console.log('🎉 便携绿色免安装包构建完成！');
  console.log(`📁 输出目录: ${distDir}`);
  console.log('💡 任何 Windows 电脑解压该文件夹后，直接双击【启动系统.bat】即可使用！');
  console.log('========================================================\n');
}

buildPortablePackage().catch((err) => {
  console.error('❌ 构建失败:', err);
  process.exit(1);
});
