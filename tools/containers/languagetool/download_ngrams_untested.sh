#!/usr/bin/env bash
# Download & extract LanguageTool n-gram data (UNTESTED set) into ngrams/untested/
# next to this script.
#
# Sources: https://languagetool.org/download/ngram-data/untested/
#   ngram-he-20150916.zip  (~225 MB)
#   ngram-it-20150915.zip  (~1.1 GB)
#   ngram-ru-20150914.zip  (~2.3 GB)
#   ngram-zh-20150916.zip  (~1.7 GB)
#
# NOTE: "an" (Aragonese) was requested but does NOT exist on the server
# (checked ngram-data/, untested/, temp/, archive/ — only he/it/ru/zh are
# offered). Kept commented out so it can be enabled if it appears later.
#
# Usage: ./download_ngrams_untested.sh
# Re-running is safe: already-downloaded & valid zips are skipped (download is
# resumable via curl -C).

set -euo pipefail

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGRAMS_DIR="$BASE/ngrams"
UNTESTED_DIR="$NGRAMS_DIR"
BASE_URL="https://languagetool.org/download/ngram-data/untested"

# zip filenames (verified against server directory listing)
declare -a FILES=(
  "ngram-he-20150916.zip"
  "ngram-it-20150915.zip"
  "ngram-ru-20150914.zip"
  "ngram-zh-20150916.zip"
  # "ngram-an-*.zip  (404 — not available on the server as of 2025/2026)"
)

command -v curl  >/dev/null || { echo "ERROR: curl not found"  >&2; exit 1; }
command -v unzip >/dev/null || { echo "ERROR: unzip not found" >&2; exit 1; }

mkdir -p "$UNTESTED_DIR"
echo "Target dir: $UNTESTED_DIR"

failed=0
for zip in "${FILES[@]}"; do
  url="$BASE_URL/$zip"
  dest="$UNTESTED_DIR/$zip"

  echo "=================================================================="
  echo "$zip"

  if [ -f "$dest" ] && unzip -t "$dest" >/dev/null 2>&1; then
    echo "  [skip] already downloaded and valid: $zip"
  else
    echo "  [dl] $url"
    if ! curl --fail --location --retry 3 --retry-delay 5 -C - \
             --connect-timeout 30 --progress-bar -o "$dest" "$url"; then
      echo "  [FAIL] download failed for $url (partial file kept for resume: $dest)" >&2
      rm -f "$dest"  # 404/error body would corrupt the name for future runs
      failed=1
      continue
    fi
  fi

  echo "  [extract] -> $UNTESTED_DIR"
  if ! unzip -o -q "$dest" -d "$UNTESTED_DIR"; then
    echo "  [FAIL] extraction failed for $zip" >&2
    failed=1
  fi
done

echo "=================================================================="
if [ "$failed" -ne 0 ]; then
  echo "Finished with ERRORS — re-run to resume failed downloads." >&2
  exit 1
fi
echo "All done. Contents:"
ls -lh "$UNTESTED_DIR"
