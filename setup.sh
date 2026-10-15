#!/usr/bin/env bash
# Build and audit a fresh local preview from the generated private snapshot.
set -euo pipefail
SITE_ROOT="$(cd "$(dirname "$0")" && pwd)"
SOURCE_PATH="${PRIVATE_SOURCE_PATH:?Set PRIVATE_SOURCE_PATH to your private vault}"
CONFIG_PATH="${PUBLISHING_CONFIG:?Set PUBLISHING_CONFIG to its generated publishing.yaml}"
command -v node >/dev/null || { echo "Node.js >= 22 is required"; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) < 22 ? 1 : 0)' || { echo "Node.js >= 22 is required"; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 is required for local preview"; exit 1; }
RUN_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/paper-preview.XXXXXXXX")"
cd "$SITE_ROOT"
npm ci
node scripts/publication.mjs export \
  --config "$CONFIG_PATH" --source "$SOURCE_PATH" \
  --output "$RUN_ROOT/content" --overlay content-extras \
  --quartz-config "$RUN_ROOT/quartz.config.yaml"
QUARTZ_CONFIG_PATH="$RUN_ROOT/quartz.config.yaml" \
  npx quartz build -d "$RUN_ROOT/content" -o "$RUN_ROOT/public"
node scripts/publication.mjs audit \
  --config "$CONFIG_PATH" --content "$RUN_ROOT/content" --output "$RUN_ROOT/public"
echo "Preview: http://127.0.0.1:${PREVIEW_PORT:-8080}"
python3 -m http.server "${PREVIEW_PORT:-8080}" --bind 127.0.0.1 --directory "$RUN_ROOT/public"
