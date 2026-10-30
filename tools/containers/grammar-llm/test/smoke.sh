#!/usr/bin/env bash
#
# smoke.sh — end-to-end check against a RUNNING grammar-llm server.
#
# This does NOT start the server (it would need the model). Run a server
# first, e.g.:
#
#   node dist/download-model.mjs --out /tmp/models/GRMR-V3-G4B-Q4_K_M.gguf \
#        --url https://huggingface.co/icecubetr/GRMR-V3-G4B-GGUF/resolve/main/GRMR-V3-G4B-Q4_K_M.gguf
#   GRAMMAR_LLM_MODEL_DIR=/tmp/models PORT=8090 node dist/server.mjs &
#
# then:
#
#   BASE=http://127.0.0.1:8090 npm run smoke
#
# or against the docker container:
#
#   BASE=http://127.0.0.1:8010 npm run smoke

set -euo pipefail

BASE="${BASE:-http://127.0.0.1:8010}"
pass=0
fail=0

say() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; pass=$((pass+1)); }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; fail=$((fail+1)); }

say "GET $BASE/v2/languages"
body="$(curl -fsS "$BASE/v2/languages")"
if echo "$body" | jq -e '.[0].name and .[0].code' >/dev/null 2>&1; then
  ok "languages list has name+code"
  echo "$body" | jq -c '.[0]'
else
  bad "languages list unexpected: $body"
fi

say "GET $BASE/v2/health"
body="$(curl -fsS "$BASE/v2/health" || true)"
state="$(echo "$body" | jq -r '.state // "missing"' 2>/dev/null || echo missing)"
echo "  state: $state"
[ "$state" = "ready" ] && ok "model ready" || { echo "  (model not ready — /v2/check will 503; continuing for shape checks)"; }

say "POST $BASE/v2/check  (text=…, Overleaf style)"
code="$(curl -s -o /tmp/glm-smoke-check.json -w '%{http_code}' -X POST "$BASE/v2/check" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'language=auto' \
  --data-urlencode 'level=picky' \
  --data-urlencode 'disabledRules=WHITESPACE_RULE,CONSECUTIVE_SPACES' \
  --data-urlencode 'text=I has two cats. They is very goed cat.')"
resp="$(cat /tmp/glm-smoke-check.json)"

echo "$resp" | head -c 400; echo
if [ "$code" = "200" ]; then
  n="$(echo "$resp" | jq '.matches | length' 2>/dev/null || echo '?')"
  echo "  matches: $n"
  echo "$resp" | jq -c '.matches[]? | {offset, length, replacements: [ .replacements[].value ], message}' 2>/dev/null | head -5 || true
  if [ "$n" != "?" ] && [ "$n" -ge 1 ]; then ok "produced matches"; else bad "expected >=1 match (model may have found none)"; fi
  if echo "$resp" | jq -e '.software // .software' >/dev/null 2>&1; then ok "has software block"; else bad "no software block"; fi
else
  # 503 (model not ready) is acceptable for a shape test, but report status
  echo "  status: $code"
  [ "$code" = "503" ] && { echo "  (model still loading — rerun smoke once /v2/health shows ready)"; } || bad "unexpected status $code"
fi

say "POST /v2/check with annotation (LaTeX markup must be skipped)"
resp="$(curl -s -X POST "$BASE/v2/check" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'language=en-US' \
  --data-urlencode 'data={"annotation":[{"text":"The "},{"markup":"{\\textbf{bold}} "},{"text":"cat is goed."}]}' )"
echo "$resp" | head -c 400; echo
# No match may fall inside the markup span [4,16)
if echo "$resp" | jq -e '.matches[] | select(.offset >= 4 and .offset < 16)' >/dev/null 2>&1; then
  bad "a match overlaps the LaTeX markup span (offsets misaligned?)"
else
  ok "no match crosses the markup span"
fi

say "negative: missing text/data → 400"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/v2/check" -H 'Content-Type: application/x-www-form-urlencoded' --data 'language=en')"
[ "$code" = "400" ] && ok "400 as expected" || bad "expected 400, got $code"

say "CORS preflight"
code="$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$BASE/v2/check")"
[ "$code" = "204" ] || [ "$code" = "200" ] && ok "preflight $code" || bad "preflight $code"

say "summary"
echo "  pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
