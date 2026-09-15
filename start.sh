#!/bin/sh
cd "$(dirname "$0")" || exit 1
export PYTHONPATH="$PWD/src"
exec python3 -m agent_hub "$@"
