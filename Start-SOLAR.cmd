@echo off
cd /d "%~dp0"
echo S0LAR - http://127.0.0.1:8787
echo Admin - http://127.0.0.1:8787/admin.html
node --env-file-if-exists=.env server.mjs
pause
