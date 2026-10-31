@echo off
rem Abraham installer for Windows 10/11 (macOS/Linux: use setup.sh).
rem
rem Installs everything into this folder: uv (package manager, if missing), a private
rem Python 3.12, PyTorch, Demucs, Pedalboard, yt-dlp, ffmpeg and the web server. No admin rights needed.
rem
rem   setup.bat               auto-detect hardware (NVIDIA GPU -> CUDA, otherwise CPU)
rem   setup.bat --cpu         force the CPU-only build (smaller download)
rem   setup.bat --cuda        force the NVIDIA CUDA build
rem   setup.bat --no-models   skip pre-downloading the separation model
setlocal
cd /d "%~dp0"

set "ACCEL="
set "DOWNLOAD_MODEL=1"
:parse
if "%~1"=="" goto parsed
if /i "%~1"=="--cpu" set "ACCEL=cpu"
if /i "%~1"=="--cuda" set "ACCEL=cuda"
if /i "%~1"=="--no-models" set "DOWNLOAD_MODEL=0"
shift
goto parse
:parsed

echo.
echo ==^> Abraham setup for Windows

rem ------------------------------------------------------------ uv
set "UV="
where uv >nul 2>nul && set "UV=uv"
if not defined UV if exist "%USERPROFILE%\.local\bin\uv.exe" set "UV=%USERPROFILE%\.local\bin\uv.exe"
if not defined UV if exist "%USERPROFILE%\.cargo\bin\uv.exe" set "UV=%USERPROFILE%\.cargo\bin\uv.exe"
if defined UV goto have_uv
echo.
echo ==^> Installing uv (Python package manager)
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
if errorlevel 1 goto fail
set "UV=%USERPROFILE%\.local\bin\uv.exe"
if not exist "%UV%" goto fail
:have_uv
echo Using uv: %UV%

rem ------------------------------------------------------------ hardware
if defined ACCEL goto accel_chosen
set "ACCEL=cpu"
nvidia-smi -L >nul 2>nul && set "ACCEL=cuda"
:accel_chosen
if "%ACCEL%"=="cuda" (
  echo NVIDIA GPU found - installing the CUDA build, about 3 GB on first install.
) else (
  echo No NVIDIA GPU found - installing the CPU build. Expect a few minutes per song.
)

rem ------------------------------------------------------------ libraries
rem A .venv copied from another machine won't run here; start fresh in that case.
if exist ".venv" if not exist ".venv\Scripts\python.exe" (
  echo Existing .venv is from another machine; recreating it.
  rmdir /s /q ".venv"
)

echo.
echo ==^> Installing Python 3.12 + libraries
"%UV%" sync --frozen --extra %ACCEL%
if errorlevel 1 goto fail

echo.
echo ==^> Checking the installation
".venv\Scripts\python.exe" -c "import torch, demucs, soundfile, fastapi, uvicorn, yt_dlp, pedalboard; from separator import FFMPEG, device_name; print('  PyTorch', torch.__version__); print('  Separation device:', device_name()); print('  ffmpeg:', FFMPEG)"
if errorlevel 1 goto fail

if "%DOWNLOAD_MODEL%"=="0" goto done
echo.
echo ==^> Downloading the default separation model (about 50 MB, one time)
".venv\Scripts\python.exe" -c "from separator import DEFAULT_MODEL, load_model; load_model(DEFAULT_MODEL)"
if errorlevel 1 goto fail

:done
echo.
echo All set! Start the app by double-clicking run.bat
echo It opens http://127.0.0.1:7860 in your browser.
echo.
pause
exit /b 0

:fail
echo.
echo Setup failed - see the messages above.
pause
exit /b 1
