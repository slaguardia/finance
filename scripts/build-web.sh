#!/usr/bin/env bash
# Build the PWA into web/dist (committed; the image bakes it in, scout/scribe-style).
# Runs in Node 22 because the toolkit's vite preset is TypeScript, which Node 22
# loads natively. Expects the brainbot repo (which holds @brainbot/web-toolkit)
# to sit next to this one.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
parent=$(dirname "$here")
docker run --rm -v "$parent:/r" -w "/r/$(basename "$here")/web" node:22-bookworm-slim \
  sh -c 'npm install --install-links=false --no-audit --no-fund --loglevel=error && npm run build'
