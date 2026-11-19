# Credits & Attribution

This project wraps two upstream bodies of work. Neither is redistributed in
unattributed form; the specifics of what comes from where are listed below.

## 1. grammar-llm — functional core

**Repo:** <https://github.com/whiteh4cker-tr/grammar-llm>
**License:** MIT — Copyright (c) 2025 whiteh4cker-tr
**What this project takes:**

- **The whole correction pipeline** — the pure engine under
  `grammar-llm/src/electron/core/`, vendored byte-for-byte into this repo's
  `core/` (7 files: `apply.ts`, `clean.ts`, `correction.ts`, `diff.ts`,
  `reconstruct.ts`, `sentences.ts`, `types.ts`): sentence splitting, model
  output cleaning, word-diff/word-fix extraction, suggestion reconstruction.
  Provenance (source commit `ceff65a` + per-file SHA-256) is recorded in
  `core/.sync-info`; refresh with `scripts/sync-core.sh`.
- **LLM call semantics** — system prompt, stop sequences, sampling defaults
  (temperature 0.7 / topK 40 / topP 0.95 / minP 0.01), and
  `node-llama-cpp` session usage mirror
  `grammar-llm/src/electron/llamaService.ts` so container output stays
  byte-identical to the desktop app for a given model.
- **Model** — GRMR-V3-G4B (fine-tuned by the grammar-llm project; GGUF
  weights are fetched from Hugging Face at
  `icecubetr/GRMR-V3-G4B-GGUF`, Q4_K_M by default).
- **Model downloader usage** — the download flow in `src/download-model.ts`
  follows `grammar-llm`'s use of `createModelDownloader` from
  `modelManager.ts`.

> grammar-llm is itself an Electron/React desktop migration of the original
> GrammarLLM Python app (`whiteh4cker-tr/grammar-llm`, `python` branch); the
> engine core it ships is what this container is built on.

Full MIT license text (retained with the vendored `core/` files):

```
MIT License

Copyright (c) 2025 whiteh4cker-tr

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. LanguageTool — API compatibility reference

**Project:** <https://languagetool.org> (source:
<https://github.com/languagetool-org/languagetool>)
**License:** GNU Lesser General Public License (LGPL) — see `COPYING.txt` in
the LanguageTool source tree
**What this project takes:** *the wire protocol, not the code.*

- **The v2 REST API contract** this container emulates: `GET /v2/languages`,
  `POST /v2/check`, and the response envelope (`software`, `warnings`,
  `language`, `matches[]`, `sentenceRanges`) — schema taken from
  `languagetool-core/src/main/java/org/languagetool/tools/RuleMatchesAsJsonSerializer.java`,
  `languagetool-server/.../ApiV2.java` and `TextChecker.java`, so that
  existing LanguageTool clients (Overleaf, editors, CI linters) work
  unmodified.
- **Error/status semantics** (`400` missing text, `413` too long, `503`
  degraded, `warnings.incompleteResults`) follow LanguageTool's behavior so
  clients that special-case it keep working.
- **Drop-in target packaging** — port `8010`, `--allow-origin '*'` behavior
  and the "run-a-side" admin story follow the widely deployed
  `erikvl87/languagetool` / `Erikvl87/docker-languagetool` images.

No LanguageTool source code is included in this repository; compatibility is
at the HTTP/JSON level only, so the LGPL obligations of the Java source do
not attach to this container. (If you embed this as a *library* rather than a
service, review the LGPL implications yourself.)

## 3. Runtime dependencies

| Dependency | License | Role |
|---|---|---|
| [node-llama-cpp](https://github.com/withcatai/node-llama-cpp) (Gilad S. / withcatai), v3.19.1 | MIT | GGUF inference engine (`llama.cpp` bindings) + `createModelDownloader` used for model fetches |
| [esbuild](https://github.com/evanw/esbuild) | MIT | bundling `src/` → `dist/` |
| Node.js LTS (≥ 20) | MIT (nodejs org) | runtime |

## 4. Integration context

Serves the Overleaf LanguageTool module in this repo
(`services/web/modules/languagetool/`, based on upstream
[yu-i-i/overleaf-cep#179](https://github.com/yu-i-i/overleaf-cep/pull/179))
as a one-for-one replacement for a `languagetool` service container.
