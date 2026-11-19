#!/usr/bin/env bash
#
# sync-core.sh — refresh the vendored grammar-llm core in ./core/ from the
# grammar-llm source tree.
#
# The container's functional core lives in the grammar-llm project
# (/data_1/compare/grammar-llm on this machine). This project vendors a
# snapshot of src/electron/core/*.ts (the pure, framework-free engine) so the
# Docker build stays self-contained. Run this script after updating
# grammar-llm to pick up engine changes.
#
# Usage:
#   scripts/sync-core.sh [path-to-grammar-llm-repo]
#
# The default location is the sibling repo at <compare-root>/grammar-llm.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Default: /data_1/compare/grammar-llm (project is at
# <repo-root>/tools/containers/grammar-llm; override with: scripts/sync-core.sh <path>)
DEFAULT_SRC="${GRAMMAR_LLM_SRC:-/data_1/compare/grammar-llm}"
SRC="${1:-$DEFAULT_SRC}"

if [ ! -d "$SRC/src/electron/core" ]; then
  echo "ERROR: $SRC/src/electron/core not found." >&2
  echo "Usage: $0 [path-to-grammar-llm-repo]" >&2
  exit 1
fi

DEST="$PROJECT_ROOT/core"
mkdir -p "$DEST"

# Copy the non-test core modules (apply.ts is UI-side app logic, kept for
# completeness; the server uses sentences/clean/correction/diff/reconstruct/types).
shopt -s nullglob
for f in "$SRC"/src/electron/core/*.ts; do
  b="$(basename "$f")"
  case "$b" in
    *.test.ts) ;;
    *) cp -f "$f" "$DEST/$b" ;;
  esac
done

# Record provenance
{
  date -u +%Y-%m-%dT%H:%M:%SZ
  echo "source: $SRC"
  if git -C "$SRC" rev-parse --short HEAD >/dev/null 2>&1; then
    echo "commit: $(git -C "$SRC" rev-parse --short HEAD)"
    echo "status: $(git -C "$SRC" status --porcelain -- src/electron/core | head -1)"
  fi
  sha256sum "$SRC"/src/electron/core/*.ts | grep -v test || true
} > "$DEST/.sync-info"

echo "Synced $(ls "$DEST"/*.ts | wc -l) core module(s) from $SRC"
echo "Provenance written to $DEST/.sync-info"
