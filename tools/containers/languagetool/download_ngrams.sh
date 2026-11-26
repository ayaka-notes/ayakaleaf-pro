#!/usr/bin/env bash
# Download & extract LanguageTool n-gram data (main set: de en es fr nl)
# into ngrams/ next to this script.
#
# Sources: https://languagetool.org/download/ngram-data/
#   ngrams-de-20150819.zip  (~1.7 GB)
#   ngrams-en-20150817.zip  (~9.0 GB)
#   ngrams-es-20150915.zip  (~1.7 GB)
#   ngrams-fr-20150913.zip  (~1.8 GB)
#   ngrams-nl-20181229.zip  (~1.2 GB)
#
# Usage: ./download_ngrams.sh
# Re-running is safe: already-downloaded & valid zips are skipped (download is
# resumable via curl -C).

set -euo pipefail

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGRAMS_DIR="$BASE/ngrams"
BASE_URL="https://languagetool.org/download/ngram-data"

# lang -> zip filename (verified against server directory listing)
declare -a FILES=(
  "ngrams-de-20150819.zip"
  "ngrams-en-20150817.zip"
  "ngrams-es-20150915.zip"
  "ngrams-fr-20150913.zip"
  "ngrams-nl-20181229.zip"
)

command -v curl  >/dev/null || { echo "ERROR: curl not found"  >&2; exit 1; }
command -v unzip >/dev/null || { echo "ERROR: unzip not found" >&2; exit 1; }

mkdir -p "$NGRAMS_DIR"
echo "Target dir: $NGRAMS_DIR"

failed=0
for zip in "${FILES[@]}"; do
  url="$BASE_URL/$zip"
  dest="$NGRAMS_DIR/$zip"

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

  echo "  [extract] -> $NGRAMS_DIR"
  if ! unzip -o -q "$dest" -d "$NGRAMS_DIR"; then
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
ls -lh "$NGRAMS_DIR"
