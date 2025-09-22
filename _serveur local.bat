@echo off
cd /d "%~dp0"
start "" python cors_server.py
timeout /t 2 >nul
start "" http://localhost:8000