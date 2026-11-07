# grammar-llm container

A **drop-in replacement for the LanguageTool container**
([docker-languagetool](https://github.com/Erikvl87/docker-languagetool),
`erikvl87/languagetool`) for grammar checking — same port, same wire API —
powered by the **grammar-llm** engine: a fine-tuned local LLM
(`GRMR-V3-G4B`, [whiteh4cker-tr/grammar-llm](https://github.com/whiteh4cker-tr/grammar-llm))
running through [`node-llama-cpp`](https://github.com/withcatai/node-llama-cpp).

The intent: one admin can run the classic `languagetool` container, another
can run this container — and the rest of the stack (e.g. the Overleaf
LanguageTool module) points at whichever one is up, without code changes.

```
┌────────────┐   LanguageTool v2 API (port 8010)   ┌───────────────────────────┐
│  Overleaf  │ ───────────────────────────────────▶ │  grammar-llm container   │
│ (or any    │ ◀─────────────────────────────────── │  ┌─────────────────────┐ │
│ LT client) │     { software, matches[] … } JSON   │  │ HTTP server (node)  │ │
└────────────┘                                       │  │ grammar-llm core*   │ │
                                                     │  │ node-llama-cpp +    │ │
                                                     │  │ GRMR-V3-G4B model   │ │
                                                     │  └─────────────────────┘ │
                                                     └───────────────────────────┘
* vendored from /data_1/compare/grammar-llm/src/electron/core (see scripts/sync-core.sh)
```

## Quickstart

```sh
# from this directory
docker build -t grammar-llm .
docker run -d --name grammar-llm -p 8010:8010 -v grammar-llm-models:/models grammar-llm

# or with compose
docker compose up -d
```

First start downloads the model (~2.4 GB) into the `/models` volume from
Hugging Face (`icecubetr/GRMR-V3-G4B-GGUF`, Q4_K_M). Subsequent starts use the
cached file. The server answers immediately; `/v2/health` reports
`state: loading/ready` and `/v2/check` returns `503` until the model is
loaded — the same "silent linter" behavior Overleaf already has for timeouts.

Probe it like LanguageTool:

```sh
curl -s http://localhost:8010/v2/languages | jq '.[0]'
curl -s -X POST http://localhost:8010/v2/check \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'language=auto' \
  --data-urlencode 'level=picky' \
  --data-urlencode 'text=I has two cats. They is very good.' | jq '.matches'
```

Use it as the Overleaf LT backend (see `services/web/modules/languagetool`):

```sh
# env for the overleaf web service — unchanged from the languagetool setup,
# just point at this container:
LANGUAGE_TOOL_ENABLED=true
LANGUAGE_TOOL_HOST=grammar-llm     # or 127.0.0.1 on the host
LANGUAGE_TOOL_PORT=8010
# …or explicitly:
# LANGUAGE_TOOL_URL=http://grammar-llm:8010
```

## API (LanguageTool v2 subset)

| Method & path      | LanguageTool equivalent | Notes |
|--------------------|-------------------------|-------|
| `GET /v2/languages` | `GET /v2/languages` | English variants only (model is English-only) |
| `POST /v2/check`    | `POST /v2/check` | form-urlencoded **or** JSON body |
| `GET /v2/version`   | version info | container/version + engine state |
| `GET /v2/health`    | — (not an LT endpoint) | model state, counter; used by Docker HEALTHCHECK |
| `GET /`             | — | JSON info payload (endpoints, software) |

### `POST /v2/check` parameters

| Param | Status | Notes |
|-------|--------|-------|
| `text` | **used** | plain text to check |
| `data` | **used** | JSON `{"text": "…"}` or `{"annotation": [{text|markup}, …]}` — Overleaf sends `annotation` (LaTeX markup = "ignore this text"); markup is skipped and offsets stay aligned with the editor document |
| `language` | **used** | English codes (`en`, `en-US`, `en-GB`, …) and `auto`. Non-English: by default → `200` with empty matches (linter silent; admin can set `GRAMMAR_LLM_UNSUPPORTED_LANGUAGE=error` for HTTP 400 instead) |
| `level` (`default`/`picky`) | **used** | **Picky mode for the LLM** (see below). `picky` → stricter prompt (style + word choice + phrasing on top of base grammar). `default` → base prompt only (byte-identical to the desktop app). Always forwarded verbatim to the real LanguageTool box when one is configured. |
| `disabledRules` | forwarded / ignored | Forwarded to the real LanguageTool box (understands LT rule ids); ignored by the LLM (it never produces them) |
| `enabled`, `disabled`, `motherTongue`, `replacedText`, … | accepted, ignored | tolerance for other LT clients |

### Response shape

Full LanguageTool envelope (schema reference:
`org.languagetool.tools.RuleMatchesAsJsonSerializer` in the `languagetool` source):

```jsonc
{
  "software": { "name": "LanguageTool", "version": "6.8", "apiVersion": 1, "premium": false, "…": "…" },
  "warnings": { "incompleteResults": false },            // true + reason if the time budget cut the check short
  "language": { "name": "English (US)", "code": "en-US", "detectedLanguage": { … } },
  "matches": [
    {
      "message": "Shouldn't this be 'the'?",
      "shortMessage": "the",
      "replacements": [ { "value": "the" } ],            // Overleaf shows the first 5 as apply-buttons
      "offset": 24,                                       // absolute into the submitted document
      "length": 3,
      "context": { "text": "… I has two …", "offset": 19, "length": 3 },
      "type": { "typeName": "grammar" },
      "rule": {
        "id": "GRAMMAR_LLM",
        "description": "Grammar, spelling, or style issue detected by grammar-llm (GRMR-V3-G4B)",
        "issueType": "Grammar",
        "category": { "id": "GRAMMAR", "name": "Grammar" },  // deliberately NOT 'TYPOS' (see below)
        "tags": ["LLM", "GRMR-V3-G4B"]
      },
      "ignoreForIncompleteSentence": false,
      "contextForSureMatch": -1
    }
  ],
  "sentenceRanges": [[0, 16], [17, 33]]
}
```

Notes on the mapping:

- **Word-level fixes** (replacement / deletion from the core's `wordFixes`)
  become one match each. **Pure insertions** (zero-width core fixes) are
  anchored on the neighboring token — e.g. the core's `slow → slowly` +
  insert-`,` becomes two matches that re-compose exactly to `slowly, …`.
- **Quoted-word artifact unwrapping**: GRMR models sometimes emit the
  corrected word wrapped in quotes (`goed → "good"`). The desktop app shows
  that in its review UI; a LanguageTool client would apply it verbatim and
  inject literal quote characters into the document — so the adapter strips
  one pair of matching surrounding quotes from single-word replacements.
  (Vendor core is untouched; this happens in `src/languagetool.ts`.)
- **Sentence-level rewrites** without word fixes become one match over the
  changed span.
- `category.id` is **`GRAMMAR`**, not `TYPOS`: Overleaf's editor filters out
  `TYPOS` matches while the Hunspell spellchecker is active — this way
  grammar-llm suggestions are never silently filtered, while both tools stay
  usable together.
- Matches never span LaTeX `markup` segments: the core pipeline runs per
  plain-text run (markup is invisible to the model, as in LanguageTool).
- Errors mirror LanguageTool: `400` missing `text`/`data`, `413` text too
  long, `503` model not ready / server busy, `500` unexpected.

## Model

| What | Where |
|------|-------|
| Default model | `GRMR-V3-G4B-Q4_K_M.gguf` (2.4 GB) from `https://huggingface.co/icecubetr/GRMR-V3-G4B-GGUF/resolve/main/` |
| Stored in | `/models` (container volume) |
| Higher quality | `GRMR-V3-G4B-Q8_0.gguf` (set `GRAMMAR_LLM_MODEL_FILE` + matching `GRAMMAR_LLM_MODEL_URL`) |
| Any custom GGUF | set `GRAMMAR_LLM_MODEL_FILE` and pre-place the file in `/models` (or point `GRAMMAR_LLM_MODEL_URL` at it) |

The model download is done by the container's own `dist/download-model.mjs`
(node-llama-cpp `createModelDownloader`, the same API grammar-llm's desktop
modelManager uses). It's skipped automatically if the file already exists.

## Configuration

| Env | Default | Description |
|-----|---------|-------------|
| `PORT` | `8010` | HTTP port (matches docker-languagetool & Overleaf's default) |
| `HOST` | `0.0.0.0` | bind address |
| `GRAMMAR_LLM_MODEL_DIR` | `/models` | model storage dir |
| `GRAMMAR_LLM_MODEL_FILE` | `GRMR-V3-G4B-Q4_K_M.gguf` | model file name inside the dir |
| `GRAMMAR_LLM_MODEL_URL` | HF Q4_K_M URL | download source (only used when file is absent) |
| `GRAMMAR_LLM_DOWNLOAD_AT_START` | `true` | auto-download at boot when file is absent |
| `GRAMMAR_LLM_PRELOAD` | `true` | start model load at boot (vs. first check) |
| `GRAMMAR_LLM_CONTEXT_SIZE` | `8192` | LLM context (desktop-compatible clamp 256…131072) |
| `GRAMMAR_LLM_CONCURRENCY` | `1` | (reserved; single shared session today) |
| `GRAMMAR_LLM_MAX_TEXT_LENGTH` | `100000` | max characters per request (→ 413; matches Overleaf's 100 KB cap) |
| `GRAMMAR_LLM_MAX_RUNS` | `0` (unlimited) | cap on checkable text runs per request (→ `incompleteResults`) |
| `GRAMMAR_LLM_REQUEST_TIMEOUT_MS` | `55000` | per-request time budget; remaining sentences pass through unchanged + `warnings.incompleteResults` (keep under Overleaf's 60 s proxy timeout) |
| `GRAMMAR_LLM_SENTENCE_TIMEOUT_MS` | `20000` | per-sentence guard (informational) |
| `GRAMMAR_LLM_MAX_IN_FLIGHT` | `4` | concurrent checks before 503 |
| `GRAMMAR_LLM_MAX_BODY_BYTES` | `2097152` | HTTP body cap |
| `GRAMMAR_LLM_LANGUAGES` | `auto,en,en-us,en-gb,en-au,en-ca,en-ie,en-nz,en-in,en-za` | accepted `language` codes (lower-cased) |
| `GRAMMAR_LLM_UNSUPPORTED_LANGUAGE` | `empty` | `empty` = 200 + no matches, `error` = 400 |
| `GRAMMAR_LLM_BACKEND` | `local` | `local` (node-llama-cpp) or `openai` (OpenAI-compatible remote endpoint) |
| `GRAMMAR_LLM_OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL (OpenAI, OpenRouter, vLLM, llama.cpp `llama-server`, Ollama `/v1`, a self-hosted GRMR endpoint, …) |
| `GRAMMAR_LLM_OPENAI_API_KEY` | _empty_ | Bearer token (only if the endpoint requires one) |
| `GRAMMAR_LLM_OPENAI_MODEL` | _required for openai_ | model name/id on the server (e.g. `gpt-4o-mini`, or your GRMR model) |
| `GRAMMAR_LLM_OPENAI_STYLE` | `openai` | `openai` = standard `/chat/completions`; `ollama` = native `/api/chat` with `think:false` (needed for Ollama Qwen3-family models, see below) |
| `GRAMMAR_LLM_OPENAI_TIMEOUT_MS` | `60000` | timeout for one remote call |
| `GRAMMAR_LLM_LANGUAGETOOL_URL` | _empty_ | optional **real LanguageTool container to run in parallel and merge with the LLM result** (A+B union; e.g. `http://languagetool:8010`); empty = LLM only |
| `GRAMMAR_LLM_LANGUAGETOOL_TIMEOUT_MS` | `45000` | real-LT call window (ms); if it misses, the LLM result stands alone (total stays inside the cascade budget) |
| `GRAMMAR_LLM_CASCADE_BUDGET_MS` | `55000` | **shared wall-clock budget for the merged check** (both engines in parallel). Must stay under the LT client's cap — Overleaf's controller times out at **60 s and then silently shows nothing** |
| `GRAMMAR_LLM_DEFAULT_LEVEL` | `default` | level used when the client sends none (`default` \| `picky`) |
| `GRAMMAR_LLM_ALLOW_ORIGIN` | `*` | CORS origin (docker-languagetool runs with `--allow-origin '*'`) |
| `GRAMMAR_LLM_TEMPERATURE` / `GRAMMAR_LLM_TOP_K` / `GRAMMAR_LLM_TOP_P` / `GRAMMAR_LLM_MIN_P` | `0.7 / 40 / 0.95 / 0.01` | sampling — identical defaults to the grammar-llm desktop app |
| `GRAMMAR_LLM_REPORTED_LT_VERSION` | `6.8` | version string reported as "LanguageTool" |
| `GRAMMAR_LLM_LOG_LEVEL` | `info` | `debug\|info\|warn\|error` |
| `LLAMA_USE_MLOCK`, `GGML_N_THREADS`, … | — | node-llama-cpp / llama.cpp passthrough env vars work as-is |

## Check routing & modes

Three independent, composable knobs control where and how a check is computed.

### 1) Optional real LanguageTool merge (A+B cascade)

Point this container at a real LanguageTool box and both engines run for every
check; the response is the **merged union (A+B)** of the real-LT findings and
the LLM's findings — clients see both tool sets, never just the faster tool's
slice. A document where LT flags 30 spans AND the LLM has 40 suggestions
delivers the union; a span flagged by BOTH tools becomes ONE match (real-LT
authoritative, with the LLM's distinct replacement candidates appended):

```sh
GRAMMAR_LLM_LANGUAGETOOL_URL=http://languagetool:8010   # same compose network
```

**How the merge works** (both sides on ONE shared budget,
`GRAMMAR_LLM_CASCADE_BUDGET_MS`, default 55 s — chosen to sit under Overleaf's
60 s controller timeout):

1. The request is forwarded **verbatim** (`text` **or** the original
   `data.annotation`, `language`, `disabledRules`, and **`level` —
   `picky`→`picky`**) to `$GRAMMAR_LLM_LANGUAGETOOL_URL/v2/check` (window:
   `GRAMMAR_LLM_LANGUAGETOOL_TIMEOUT_MS`), while the LLM runs in parallel.
2. Resolution (once both sides have settled, or as soon as both are known lost):
   - LT with matches **and** LLM with matches → **merged union** (LT order
     first, then LLM-only spans; shared spans collapsed, candidates deduped);
   - LT with matches, LLM empty/failed → the LT response as-is;
   - LT empty/unreachable, LLM ok → the LLM response as-is;
   - neither usable → the LLM error (400/503/500).
3. The English-only language gate applies to the **LLM side only** — in a
   cascade, a non-English document is still served by the real LT.

Latency: response time ≈ **max(LT, LLM)** — always inside the shared budget,
so Overleaf's 60 s cap (and therefore the UI) is never blown; worst case is a
*partial* result (`warnings.incompleteResults`), never a client-side timeout.
A dead LanguageTool box never breaks checking — it just costs one attempt.
Set the URL back to empty for LLM-only. (Trade-off vs. the older
one-winner cascade: the LLM always spends compute, even when the real LT
already found matches.)

### 2) Optional remote LLM (OpenAI-compatible API)

When the Overleaf host can't afford local inference, redirect the LLM step to
any OpenAI-compatible `chat/completions` endpoint (OpenAI, OpenRouter, vLLM,
llama.cpp `llama-server`, Ollama `/v1`, a hosted GRMR/V3 LoRA, …):

```sh
GRAMMAR_LLM_BACKEND=openai
GRAMMAR_LLM_OPENAI_BASE_URL=https://api.openai.com/v1        # or your endpoint
GRAMMAR_LLM_OPENAI_MODEL=gpt-4o-mini                          # required
GRAMMAR_LLM_OPENAI_API_KEY=sk-…                               # only if needed
```

**Ollama (Qwen3 and similar reasoning models):** use the native style instead. On
Ollama's OpenAI-compat layer the `think:false` flag is ignored for Qwen3-family
models and the response can spend *all* completion tokens on hidden reasoning
(measured: 111–400 tokens burned for ~15-token answers, occasionally hitting
max_tokens and returning an empty answer with HTTP 200). The native
`/api/chat` honors top-level `think:false` and suppresses reasoning entirely
(measured: ~15 completion tokens, same answer):

```sh
GRAMMAR_LLM_BACKEND=openai
GRAMMAR_LLM_OPENAI_STYLE=ollama
GRAMMAR_LLM_OPENAI_BASE_URL=http://127.0.0.1:11434    # /v1 suffix is stripped automatically
GRAMMAR_LLM_OPENAI_MODEL=qwen3.8:latest
GRAMMAR_LLM_OPENAI_API_KEY=ollama                      # Ollama ignores it
```

If the Ollama server only listens on the host's loopback, add a tiny TCP relay
container bound to the docker bridge gateway IP (see
`/data_1/docker/compose/ollama-gw/` in this deployment) so containers on the
bridge network can reach it without exposing Ollama to the LAN.

With `backend=openai` **no local model is downloaded or loaded** (`start.sh`
skips the model step; the image is unchanged). The same grammar-llm core
pipeline (sentence diff, word-fix extraction, quote cleanup, LanguageTool
mapping) runs locally — only the per-sentence generation call is remote.
Prompt/stop/sampling semantics match the local backend exactly.

### 3) Picky mode for the LLM (`level`)

LanguageTool's `default` vs `picky` maps to two LLM prompt modes, mirroring
LT's idea that *picky adds rule families on top of the default set*:

| level      | LLM behavior |
|------------|--------------|
| `default`  | base correction prompt only — **byte-identical to the grammar-llm desktop app** (grammar, spelling, punctuation). |
| `picky`    | base prompt **plus** a "highly picky editor" addendum: word choice, awkward/redundant phrasing, weak punctuation, style. Produces the fuller suggestion set. |

`/v2/check` sends whatever `level` the client gave (Overleaf default is
`picky`). When a client sends no level, `GRAMMAR_LLM_DEFAULT_LEVEL` decides
(default `default`). The requested level is always forwarded verbatim to the
real LanguageTool box (step 1), so a `picky` Overleaf tab still gets
`level=picky` there.

> Tuning: the picky addendum text is fixed in code (
> `DEFAULT_PICKY_EXTRA` in `src/llama.ts`). If you want it stronger or
> weaker, send a PR or vendor the constant — the level *mechanism* (two
> prompts + LT forwarding) stays the same.

## Behavior & caveats (vs. LanguageTool)

| Topic | LanguageTool | grammar-llm container |
|-------|--------------|-----------------------|
| Languages | 30+ | English only (GRMR-V3-G4B). Non-English → silent (or 400, configurable) |
| Speed | ms | seconds per sentence (CPU). Short docs fine; very long docs hit the time budget → `incompleteResults` + partial matches (a LanguageTool-native concept) |
| Rules/levels | fine-grained rules, levels `default…picky` | **level supported**: `default` (base prompt, desktop parity) / `picky` (base + style addendum); `disabledRules` forward to a real LT box when configured, ignored by the LLM |
| Where it runs | same box | **local** node-llama-cpp, or **remote** OpenAI-compatible endpoint (`GRAMMAR_LLM_BACKEND=openai`), or merged with a real LT box (`GRAMMAR_LLM_LANGUAGETOOL_URL`, A+B union) — pick your compute strategy per deployment |
| Dictionary | rule-based + user dicts | statistical (model) |
| Memory | ~1–2 GB | model ~2.6 GB (Q4) + context ≈ **give the container ≥ 4 GB RAM** |
| GPU | n/a | auto-detected by node-llama-cpp (build/run with a CUDA build + `--gpus all` for best performance) |
| Telemetry/premium endpoints | has some | not needed by Overleaf; others → 404 |

The engine output is byte-identical to the grammar-llm desktop app for a given
model: same system prompt, stop sequences, sampling, sentence pipeline
(vendored `core/` + mirrored `llamaService` semantics).

## Development

**Build the Docker image** — no local Node installation required; the
compile (`npm ci` + esbuild) happens inside the `node:24-bookworm-slim`
base image's own Node:

```sh
make all          # docker build -t grammar-llm:latest .
```

**Local development** (optional; needs Node ≥ 20 + npm to run the bundle
and unit tests directly on the host):

```sh
npm install
npm run build        # esbuild → dist/*.mjs (self-contained; node-llama-cpp external)
npm test             # build + node --test (LLM-free: fake engine + unit tests)
npm run smoke        # end-to-end curl against a running local server (needs model)
```

`Makefile` exposes the same targets plus Docker ops — `make help`:

```make
make all             # build the Docker image (default target; no local Node needed)
make docker-test     # run the unit tests inside a node base-image container (no local Node needed)
make docker-build    # docker build -t grammar-llm:latest .
make docker-smoke    # build + container on :8010 + e2e smoke
make docker-run      # start the container (model volume kept)
make docker-stop     # stop + rm (volume kept)  /  make docker-clobber (also deletes volume)
make logs            # tail container logs
```

### Updating the vendored core

The functional core is vendored under `core/` (snapshot of
`grammar-llm/src/electron/core/*.ts` — provenance in `core/.sync-info`):

```sh
scripts/sync-core.sh                     # from /data_1/compare/grammar-llm (default)
scripts/sync-core.sh /path/to/grammar-llm
npm run build && npm test
```

`src/llama.ts` mirrors `grammar-llm/src/electron/llamaService.ts` — when the
desktop changes prompts/sampling, keep both in sync.

## Docker build layout

- **builder**: `node:24-bookworm-slim`, `npm ci` (installs
  `node-llama-cpp` + platform prebuilds + `esbuild`), bundles `dist/`.
- **runtime**: `node:24-bookworm-slim`, `npm ci --omit=dev` (native libs for
  the target platform), non-root user, `VOLUME /models`, `HEALTHCHECK` against
  `/v2/health` (1800 s start-period to cover first-run model download).

## License & credits

See [CREDITS.md](CREDITS.md). The functional core is vendored from
[whiteh4cker-tr/grammar-llm](https://github.com/whiteh4cker-tr/grammar-llm)
(MIT, © 2025 whiteh4cker-tr) — provenance and per-file hashes in
`core/.sync-info`. The external protocol is a compatibility implementation of
the [LanguageTool](https://languagetool.org) v2 REST API (LGPL; API-level
only, no LT code included).
