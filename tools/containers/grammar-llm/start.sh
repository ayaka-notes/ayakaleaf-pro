#!/usr/bin/env bash
# grammar-llm container entrypoint.
#
# 1. Warn about LanguageTool-container env vars that don't apply here
#    (drop-in sanity: admins often copy the old container's env verbatim).
# 2. Ensure the model file is present (download on first start by default).
# 3. Exec the HTTP server.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- drop-in compatibility warnings ---------------------------------------
while IFS= read -r name; do
  [ -n "$name" ] || continue
  echo "WARN: env '$name' is a LanguageTool (Java) setting; the grammar-llm container ignores it." >&2
done < <(env | grep -Eo '^langtool_[A-Za-z0-9_]*' | sort -u)
for var in Java_Xms Java_Xmx; do
  case "$var" in Java_Xms) val="${Java_Xms:-}" ;; Java_Xmx) val="${Java_Xmx:-}" ;; *) val="" ;; esac
  if [ -n "$val" ]; then
    echo "WARN: env '$var' is a LanguageTool (Java) setting; the grammar-llm container ignores it." >&2
  fi
done

# --- configuration (defaults match docker-languagetool expectations) -------
BACKEND="${GRAMMAR_LLM_BACKEND:-local}"
MODEL_DIR="${GRAMMAR_LLM_MODEL_DIR:-/models}"
MODEL_FILE="${GRAMMAR_LLM_MODEL_FILE:-GRMR-V3-G4B-Q4_K_M.gguf}"
MODEL_URL="${GRAMMAR_LLM_MODEL_URL:-https://huggingface.co/icecubetr/GRMR-V3-G4B-GGUF/resolve/main/GRMR-V3-G4B-Q4_K_M.gguf}"
MODEL_PATH="$MODEL_DIR/$MODEL_FILE"
DOWNLOAD_AT_START="${GRAMMAR_LLM_DOWNLOAD_AT_START:-true}"

export GRAMMAR_LLM_MODEL_DIR="$MODEL_DIR"
export GRAMMAR_LLM_MODEL_FILE="$MODEL_FILE"
export GRAMMAR_LLM_MODEL_URL="$MODEL_URL"

mkdir -p "$MODEL_DIR"

if [ "${BACKEND}" != "openai" ]; then
  if [ ! -s "$MODEL_PATH" ]; then
    if [ "$DOWNLOAD_AT_START" = "true" ]; then
      echo "INFO: model not found at $MODEL_PATH — downloading $(basename "$MODEL_PATH") ..."
      node "$APP_DIR/dist/download-model.mjs" --url "$MODEL_URL" --out "$MODEL_PATH"
    else
      echo "ERROR: model not found at $MODEL_PATH and GRAMMAR_LLM_DOWNLOAD_AT_START=false" >&2
      echo "       Mount the model file into $MODEL_DIR or set GRAMMAR_LLM_DOWNLOAD_AT_START=true." >&2
      exit 1
    fi
  fi
  if [ ! -s "$MODEL_PATH" ]; then
    echo "ERROR: model still missing at $MODEL_PATH after download step" >&2
    exit 1
  fi
  echo "INFO: using model $MODEL_PATH (local backend)"
else
  echo "INFO: backend=openai (model=${GRAMMAR_LLM_OPENAI_MODEL:-<unset>} base=${GRAMMAR_LLM_OPENAI_BASE_URL:-https://api.openai.com/v1}) — no local model needed"
fi
echo "INFO: starting grammar-llm server (LanguageTool-compatible API) on port ${PORT:-8010}"
exec node "$APP_DIR/dist/server.mjs"
