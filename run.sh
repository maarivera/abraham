#!/usr/bin/env bash
# Start Abraham and open it in the browser. Run ./setup.sh once first.
#   PORT=8000 ./run.sh      use another port
#   NO_BROWSER=1 ./run.sh   don't open a browser tab
cd "$(dirname "$0")"
if ! .venv/bin/python -c "" >/dev/null 2>&1; then
  echo "Abraham isn't installed on this machine yet. Run ./setup.sh first."
  exit 1
fi
exec .venv/bin/python app.py "$@"
