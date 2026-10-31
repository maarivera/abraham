#!/usr/bin/env bash
# Build dist/abraham.zip to copy to another PC or Mac.
# Leaves out .venv (machine-specific), library/ (your songs) and downloads/ (your YouTube audio).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
PY=$(command -v python3 || echo .venv/bin/python)
"$PY" - <<'PYEOF'
import zipfile
from pathlib import Path

FILES = ["app.py", "separator.py", "youtube.py", "study.py", "models/nmp.onnx", "models/LICENSE", "THIRD_PARTY.md", "pyproject.toml", "uv.lock", ".python-version", ".gitattributes",
         ".gitignore", "README.md", "setup.sh", "setup.bat", "run.sh", "run.bat"]
files = [Path(f) for f in FILES] + sorted(p for p in Path("static").rglob("*") if p.is_file())
out = Path("dist/abraham.zip")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    for f in files:
        info = zipfile.ZipInfo.from_file(f, f"abraham/{f.as_posix()}")
        info.compress_type = zipfile.ZIP_DEFLATED
        mode = 0o755 if f.suffix == ".sh" else 0o644
        info.external_attr = (0o100000 | mode) << 16  # keep setup.sh/run.sh executable
        zf.writestr(info, f.read_bytes())
print(f"Built {out} ({out.stat().st_size // 1024} KB, {len(files)} files)")
PYEOF
