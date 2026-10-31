#!/usr/bin/env bash
# Abraham installer for macOS and Linux (Windows: use setup.bat).
#
# Installs everything into this folder: uv (package manager, if missing), a private
# Python 3.12, PyTorch, Demucs, Pedalboard, yt-dlp, ffmpeg and the web server. Nothing needs sudo.
#
#   ./setup.sh               auto-detect hardware (NVIDIA GPU -> CUDA, Mac -> Metal/CPU)
#   ./setup.sh --cpu         force the CPU-only build (smaller download)
#   ./setup.sh --cuda        force the NVIDIA CUDA build
#   ./setup.sh --no-models   skip pre-downloading the separation model
set -euo pipefail
cd "$(dirname "$0")"

ACCEL=""
DOWNLOAD_MODEL=1
for arg in "$@"; do
  case "$arg" in
    --cpu) ACCEL=cpu ;;
    --cuda) ACCEL=cuda ;;
    --no-models) DOWNLOAD_MODEL=0 ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)"; exit 1 ;;
  esac
done

if [ -t 1 ]; then
  bold=$'\033[1m'; cyan=$'\033[36m'; yellow=$'\033[33m'; red=$'\033[31m'; green=$'\033[32m'; reset=$'\033[0m'
else
  bold=; cyan=; yellow=; red=; green=; reset=
fi
step() { printf '\n%s==>%s %s%s%s\n' "$cyan" "$reset" "$bold" "$*" "$reset"; }
warn() { printf '%sWarning:%s %s\n' "$yellow" "$reset" "$*"; }
die()  { printf '%sError:%s %s\n' "$red" "$reset" "$*" >&2; exit 1; }

# ---------------------------------------------------------------- platform
OS=$(uname -s)
ARCH=$(uname -m)
case "$OS" in
  Darwin|Linux) ;;
  MINGW*|MSYS*|CYGWIN*) die "On Windows, run setup.bat instead (double-click it or run it from cmd)." ;;
  *) die "Unsupported OS: $OS" ;;
esac
step "Detected $OS $ARCH"

if [ "$OS" = Darwin ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
  warn "This terminal runs under Rosetta (Intel emulation). Open a native Terminal for Apple GPU support."
fi

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -LsSf "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO- "$1"; }
else
  die "Need curl or wget to download the installer."
fi

# ---------------------------------------------------------------- uv
find_uv() {
  for c in "$(command -v uv 2>/dev/null || true)" "$HOME/.local/bin/uv" "$HOME/.cargo/bin/uv"; do
    [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}
if UV=$(find_uv); then
  step "Using uv at $UV"
else
  step "Installing uv (Python package manager)"
  fetch https://astral.sh/uv/install.sh | sh
  UV=$(find_uv) || die "uv installation failed."
fi

# ---------------------------------------------------------------- hardware
if [ -z "$ACCEL" ]; then
  if [ "$OS" = Linux ] && command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    ACCEL=cuda
  else
    ACCEL=cpu
  fi
fi
if [ "$ACCEL" = cuda ] && { [ "$OS" = Darwin ] || [ "$ARCH" != x86_64 ]; }; then
  die "CUDA builds are only available for x86_64 Linux/Windows. Re-run with --cpu."
fi

case "$OS/$ARCH/$ACCEL" in
  Darwin/arm64/*)  echo "Apple Silicon: separation will run on the Metal GPU." ;;
  Darwin/*)        echo "Intel Mac: separation will run on the CPU (expect a few minutes per song)." ;;
  */cuda)          echo "NVIDIA GPU found: $(nvidia-smi -L 2>/dev/null | head -1)" ;;
  *)               echo "No NVIDIA GPU found: separation will run on the CPU (expect a few minutes per song)." ;;
esac

# ---------------------------------------------------------------- libraries
# A .venv copied from another machine won't run here; start fresh in that case.
if [ -e .venv ] && ! .venv/bin/python -c "" >/dev/null 2>&1; then
  warn "Existing .venv is from another machine; recreating it."
  rm -rf .venv
fi

if [ "$ACCEL" = cuda ]; then
  step "Installing Python 3.12 + libraries, NVIDIA build (~3 GB download on first install)"
else
  step "Installing Python 3.12 + libraries, CPU/Metal build (~400 MB download on first install)"
fi
"$UV" sync --frozen --extra "$ACCEL"

PY=.venv/bin/python

step "Checking the installation"
"$PY" - <<'EOF'
import torch, demucs, soundfile, fastapi, uvicorn, yt_dlp, pedalboard
from separator import FFMPEG, device_name
print(f"  PyTorch {torch.__version__}")
print(f"  Separation device: {device_name()}")
print(f"  ffmpeg: {FFMPEG}")
EOF

if [ "$DOWNLOAD_MODEL" = 1 ]; then
  step "Downloading the default separation model (~50 MB, one time)"
  "$PY" -c "from separator import DEFAULT_MODEL, load_model; load_model(DEFAULT_MODEL)"
fi

chmod +x run.sh 2>/dev/null || true
printf '\n%s%sAll set!%s Start the app with:\n\n    ./run.sh\n\n' "$green" "$bold" "$reset"
echo "It opens http://127.0.0.1:7860 in your browser."
