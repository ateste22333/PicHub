@echo off
:: 设置编码为 UTF-8，防止中文路径乱码
chcp 65001 >nul

:: 切换到当前 bat 脚本所在的盘符和文件夹路径
cd /d "%~dp0"

echo 正在当前目录执行 npm start...
echo 当前工作目录: %CD%

:: 执行 npm start
npm start

:: 运行结束后暂停，方便查看错误信息（如果不需要自动关闭可以保留这一行）
pause