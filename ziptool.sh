#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./zip_repo.sh [output-zip-name]
# Default name: repo.zip

OUT="${1:-repo.zip}"

# Go to the repo root if you want; here we assume you're already there.
# If you want to force it to script's directory, uncomment:
# cd "$(dirname "$0")"

zip -r "$OUT" . \
  -x "./.git/*" \
  "./node_modules/*" \
  "./webui/node_modules/*"\
  "./dist-electron/*"\
  "./electron/bin/*"\
