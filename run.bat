@echo off
rem Start Abraham and open it in the browser. Run setup.bat once first.
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" goto run
echo Abraham is not installed on this PC yet. Run setup.bat first.
pause
exit /b 1
:run
".venv\Scripts\python.exe" app.py
pause
