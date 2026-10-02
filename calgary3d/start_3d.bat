@echo off
REM Starts the live SUMO server and opens the 3D city in your browser.
cd /d "%~dp0"
for /f "delims=" %%P in ('dir /b /ad "C:\Users\15874\AppData\Local\hermes\tools\python-3.14.7*"') do set PY=C:\Users\15874\AppData\Local\hermes\tools\%%P\python.exe
start "Calgary3D server" "%PY%" -u server\server.py
timeout /t 12 >nul
start "" http://localhost:8765/
