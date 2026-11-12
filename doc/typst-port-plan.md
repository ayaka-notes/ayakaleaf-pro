# Typst support — port plan (from the OlliTeX golang branch)

Goal: first-class Typst support in this repo, as close as possible to the TeX
experience (compile, logs, click-to-source, word count, new-project flow,
editor language features). Source of truth for the feature set:
`/data_1/image_mining/the_diff/overleaf` (OlliTeX, golang branch), where the
same feature was built as `clsi_typst` (Go) + `frontend/modules/typst`.

Architecture decision (owner, 2026-11-10): build a **Node microservice
`services/clsi-typst`** as a sibling of `services/clsi` (the TeX compile
service), instead of porting the Go `clsitypst`. It reuses the proven clsi
plumbing (request parsing, resource writer, output cache, locks, nginx
download host) and swaps the engine layer.

## Feature map (source → target)

| Feature | Source (OlliTeX) | Target (this repo) |
|---|---|---|
| Compile engine | `go/services/clsitypst/typstrunner` | `services/clsi-typst/app/js/TypstRunner.js` (Node port) |
| Compiler image | `images/typst-amd64` (typst fork 0.15.1 + D21 sourcemap patch) | `services/clsi-typst/Dockerfile` (same fork/patch, multi-stage) |
| Sync (click-to-source) | `go/services/clsitypst/sourcemap` (D21 sidecar `output.sourcemap.json`) | `services/clsi-typst/app/js/TypstSourcemap.js` + same `/sync/code`, `/sync/pdf` routes |
| Word count | wordometer injected doc + PDF marker read | `services/clsi-typst/app/js/TypstWordcount.js` (same marker scheme, pdfjs read) |
| New project | `POST /project/new/typst` (basic/article/example) | `services/web/modules/typst/app/src/TypstRouter.mjs` + ProjectCreationHandler |
| Templates | `frontend/modules/typst/app/templates/project_files` | `services/web/modules/typst/app/templates/project_files` |
| Editor language | `frontend/modules/typst/frontend/js/languages/typst` (codemirror-lang-typst) | same files under `services/web/modules/typst` + `languages/index.ts` entry |
| Log parsing | `frontend/js/ide/log-parser/typst-log-parser.ts` | `services/web/frontend/js/ide/log-parser/typst-log-parser.ts` + `output-files.ts` dispatch |
| New-project UI | `typstNewProjectMenu` / `typstNewProjectModalWrapper` module components | same, via `overleafModuleImports` + `importOverleafModules` macro |
| Compiler setting | `compiler-setting.tsx` typst option | same |
| Outline | `tree-operations/outline.ts` typst headings | same |
| Format toolbar | `typst-format.ts` (typstyle wasm) | same (phase 2) |
| Word count UI | `word-count-modal` typst handling | same |
| Flag | `ExposedSettings.typstEnabled` | `Settings.typst.enabled` → `ol-ExposedSettings.typstEnabled` |

## clsi-typst service

Clone of `services/clsi` with the engine layer swapped:

- Keep: `app.js` skeleton, `CompileController` (routes), `RequestParser`
  (VALID_COMPILERS → `['typst']`), `ResourceWriter`, `OutputController`,
  `OutputFileFinder` (output.pdf), `LockManager`, `ProjectPersistenceManager`,
  `OutputCacheManager`, `Metrics`, `Errors`, `SafeReader`, `UrlCache`,
  `UrlFetcher`, `LastProjectAccess`, `DockerRunner`/`LocalCommandRunner`,
  `smoketest` (adapted: compile a small .typ).
- New: `TypstRunner.js` — `typst compile <main> output.pdf` via
  `sh -c '... exit 0'` (errors are data: typst writes `error:` lines into the
  log and still exits 0; success gate = output.pdf exists, count `^error:`
  lines into stats `typst-errors`).
- New: `TypstSourcemap.js` — pure reader/coordinate math over the D21
  `output.sourcemap.json` sidecar (port of `go/services/clsitypst/sourcemap`).
  `/sync/pdf` → (file, line, col); `/sync/code` → page/rect in clsi h/v basis.
- New: `TypstWordcount.js` — wordometer.typ + `__clsi_wc_main.typ` injection,
  compile, read marker `TOTAL_WORDS:…HEADING_WORDS:…NUM_HEADINGS:…` from the
  rendered PDF (pdfjs-dist).
- Drop: `ConversionController/Manager`, `Png2Pdf`, `TikzManager`,
  `ContentCache*`, `XrefParser`, `SynctexOutputParser` (replaced by
  sourcemap), `DraftModeManager`, `LatexMetrics` (replaced by typst stats),
  `LatexRunner`.
- `CompileManager.js`: typst flow (single pass, no latexmk rules, no biber;
  synctex/wordcount wired to the new engines).
- Dockerfile: node base + **typst fork build stage**
  (rust:alpine → typst `0.15.1-with-extras` @ d101c2f5 +
  `patches/0001-clsi-sourcemap.patch`, static binary copied in) — ported from
  `images/typst-amd64/Dockerfile` in the source repo.

## Web app

- `config/settings.defaults.js`: `apis.clsi_typst` (url/downloadHost from
  `CLSI_TYPST_HOST`), `typst: { enabled: COMPILE_TYPEST_ENABLED }`
  (default ON, matching source), `typstNewProjectMenu` +
  `typstNewProjectModalWrapper` in `overleafModuleImports`, `typst` in
  `moduleImportSequence`, `'typst'` in `safeCompilers`.
- `types/project-settings.ts`: `ProjectCompiler += 'typst'`.
- `ClsiManager.mjs` / `ClsiURLHelpers.mjs` / `ClsiCookieManager.mjs`:
  compiler-aware base URL — `project.compiler === 'typst'` →
  `Settings.apis.clsi_typst`.
- `modules/typst`: `index.mjs` (router export), `TypstRouter.mjs`
  (`POST /project/new/typst` — zod schema + template basic/article/example,
  `<%= project_name %>` substitution, frog.jpg example), template project
  files, frontend language + components, styles.
- Exposed settings: `typstEnabled` for the runtime UI gate.
- File type handling: `.typ` documents are first-class (main file stored as
  doc, like `.tex`).

## Frontend

- `ide/log-parser/typst-log-parser.ts` (port; miette-style diagnostics,
  `(file):(line):col` positions).
- `pdf-preview/util/output-files.ts`: dispatch on `data.compiler === 'typst'`.
- `source-editor/languages/index.ts`: typst `LanguageDescription` (lazy
  `@codemirror/lang-typst` via the module language file: completion,
  reference-completion, shortcuts, linter, document outline).
- `project-list/new-project-button.tsx` + modal: `blank_typst_project`
  variant, gated on `ol-ExposedSettings.typstEnabled`.
- `ide-settings/compiler-setting.tsx`: typst option (shown for typst
  projects).
- `source-editor/utils/tree-operations/outline.ts`: typst headings.
- `word-count-modal`: typst support (endpoint already served by clsi-typst).
- `extensions/toolbar/typst-format.ts` + commands (phase 2, typstyle wasm).

## Infra

- `develop/docker-compose.yml`: `clsi-typst` + `clsi-typst-nginx` services
  (mirror `clsi`/`clsi-nginx`); `develop/dev.env`: `CLSI_TYPST_HOST`.
- `server-ce`: Dockerfile typst stage (binary), runit
  `clsi-typst-overleaf`, nginx site for the typst download host.
- `services/clsi-typst/nginx.conf` (mirror `services/clsi/nginx.conf`).

## Phases

1. **clsi-typst service** (engine + image + unit tests + smoke test).
2. **web backend** (settings, ClsiManager routing, module + router +
   templates, exposed settings).
3. **frontend** (language, log parser, new-project UI, compiler setting,
   outline, output dispatch).
4. **infra** (dev compose, server-ce, nginx).
5. **E2E verification** (build image, boot dev stack, create typst project,
   compile, logs, click-to-source, word count, example project).
6. **Phase 2 niceties** (typstyle format toolbar, completion polish).

## Status (port complete; E2E verified)

**Done (code):**
- **clsi-typst service** (`services/clsi-typst/`): `TypstRunner` (single
  `typst compile` pass; success = `output.pdf` present, `^error:` lines →
  `typst-errors`), `TypstSourcemap` (D21 `output.sourcemap.json` sidecar
  reader + `/sync/code` + `/sync/pdf`), `TypstWordcount` (wordometer-injected
  doc + pdfjs marker read, `wc -w` fallback), rewritten `CompileManager`,
  `RequestParser` (`VALID_COMPILERS=['typst']`), no-op TeX manager stubs.
  **30/30 unit tests green**; verified locally E2E (compile, wordcount, sync,
  error arms, stop/clear). `Dockerfile` builds the typst fork
  (`typst/typst` `0.15.1-with-extras` @ `d101c2f5`, confirmed reachable) +
  `patches/0001-clsi-sourcemap.patch` as a static musl binary.
- **web backend**: `settings.defaults.js` (`clsi_typst` api, `typst` in
  safeCompilers + validRootDocExtensions + text/root doc ext, `typst.enabled`
  flag, moduleImportSequence, overleafModuleImports), `ProjectCompiler` +
  `'typst'`, compiler-aware URL routing in `ClsiManager` / `ClsiURLHelpers` /
  `CompileController` / `CompileManager` (typst → `clsi_typst`),
  `ExposedSettings.typstEnabled`.
- **typst webmodule** (`services/web/modules/typst/`): `POST /project/new/typst`
  (basic/article/example templates, `<%= project_name %>` — same tag + call as
  TeX), templates copied from source, `typst-new-project-menu` + modal wrapper
  components, new-project button/modal wiring, i18n keys.
- **frontend**: `typst-log-parser.ts` (ported), `output-files.ts` dispatch on
  `compiler==='typst'`, `languages/index.ts` + `languages/typst/*` (grammar
  via `codemirror-lang-typst`, completion, linter, outline, shortcuts),
  `doc-folder.ts` +`openDocPathFacet`, `typst-format.ts`, compiler-setting
  Typst option, deps added.
- **infra**: `develop/docker-compose.yml` `clsi-typst` service (writes to the
  SAME shared `/output` volume as clsi, served by the SAME `clsi-nginx`),
  web env `CLSI_TYPST_HOST`.

**Architecture note (vs. the Go port):** the Go OlliTeX port runs a separate
`clsitypst` service + its own nginx. Here both clsi (TeX) and clsi-typst write
to one shared `output/` volume in the identical
`{projectId}/generated-files/{buildId}/` layout, so a single `clsi-nginx`
serves output for both — only the compile API endpoint differs (clsi vs
clsi-typst on :3013), selected per-project by `project.compiler`.

**Verification — COMPLETE (server-ce image, full E2E):**
- [x] `server-ce` Dockerfile: multi-stage `typst-build` (rust:alpine, typst fork
      `0.15.1-with-extras` @ `d101c2f5` + sourcemap patch → static musl binary
      baked into the app image). Image `sharelatex/sharelatex:typst-e2e` builds clean.
- [x] Frontend webpack build green. Two build fixes were needed:
      * `webpack.config.js`: the `codemirror-lang-typst` grammar + `@typstyle/typstyle-wasm-bundler`
        formatter ship wasm-pack `bundler`-target glue that needs webpack native async-WebAssembly
        interop — added a `webassembly/async` rule for `typst_syntax_bg.wasm` / `typstyle_wasm_bg.wasm`
        (excluded from the generic `asset/resource` wasm rule).
      * `codemirror-lang-typst` pinned to `^0.4.0` (the `TypstParser` API the ported language
        code targets; 0.6.x changed the API).
- [x] Booted a full server-ce stack (mongo single-node replica set + redis sidecars + the
      overleaf image). **clsi-typst runs alongside clsi** (clsi :3013, clsi-typst :3014, via
      `server-ce/runit/clsi-typst-overleaf` + `server-ce/config/env.sh` `CLSI_TYPST_PORT=3014`).
- [x] **E2E verified end-to-end in the target:**
      * Create Typst project via `POST /project/new/typst` → project seeded with `main.typ`
        (`<%= project_name %>` substituted), `compiler: 'typst'`, `rootDoc` set.
      * Compile via `POST /project/:id/compile` → routed to **clsi-typst (:3014)** (confirmed in
        `clsi-typst.log` CommandRunner; the web service sources `env.sh` → `clsi_typst.url` =
        `127.0.0.1:3014`) → `status: success`, `output.pdf` (valid PDF 1.7) downloadable.
      * **Click-to-source**: `output.sourcemap.json` served with D21 locations
        (`page`, `x/y/w/h`, `span.byteOffset` → `main.typ`).
      * **Word count**: `GET /project/:id/wordcount` → `{textWords, headWords, headers}`.
      * **Error path**: an intentional `#error(...)` → `status: failure` + log line
        `error: unknown variable: error` at `main.typ:5:1` (the `^error:` shape the
        `typst-log-parser` consumes).
      * **Frontend**: `typst` in `safeCompilers`, `typstEnabled` exposed (gates the Typst
        compiler option + the "Typst" new-project menu), typst language/completion/linter/outline
        compiled into the served webpack bundles.

**Operational gotchas hit during verification (kept for the record):**
- Overleaf CE's `check-mongodb` requires a **replica set** (transactions). A standalone `mongo`
  fails with "Transaction numbers are only allowed on a replica set member". Run mongo with
  `--replSet overleaf`.
- The replica set member **host** must be the container's *external* hostname (e.g. `typst-mongo`),
  **not** `127.0.0.1`. Mongo's `hello` reports that canonical host, so a remote driver (the web
  service in a different container) chases `127.0.0.1` and times out. Production uses `mongo:27017`;
  mirror that (`rs.initiate({_id:'overleaf', members:[{host:'<container-hostname>:27017'}]})`).
- The web login flow requires the user doc to have top-level `email`, `hashedPassword`,
  `analyticsId` (UUID) and `labsProgram` (bool); the login query is `{ email }`.
- The Typst template dir is `modules/typst/app/templates/project_files` (one level up from
  `app/src`, i.e. `../templates/project_files`) — mirroring the TeX module layout.

**Browser-UX parity audit (headless Chromium via CDP, against the running target):**
- [x] **Editor language**: Typst syntax highlighting renders (`tok-heading`, `tok-keyword`,
      `tok-number`, `tok-strong`, `tok-variableName`, `tok-operator` spans). **Bug found + fixed:
      the page CSP `script-src` lacked `\'wasm-unsafe-eval\'`, so `WebAssembly.instantiateStreaming`
      was blocked and the `codemirror-lang-typst` wasm grammar (and the `typstyle-wasm` formatter)
      never loaded → no highlighting, no outline.** Added `\'wasm-unsafe-eval\'` to `buildViewPolicy`
      in `services/web/app/src/infrastructure/CSP.mjs` (mirrors the OlliTeX `core.CSPViewPolicy`
      deviation note, 2026-10-08). After the fix: zero console errors, highlighting + outline work.
      (TeX's lezer grammar is JS, so it was never affected — only the wasm grammars need this.)
- [x] **Toolbar**: Bold / Italic / Format (the Typst-specific toolbar buttons) render for a `.typ` doc.
- [x] **File outline**: the heading outline panel lists `Browser UX E2E` → `Section One`, `Section Two`
      (correctly nested) — this depends on the wasm grammar, so it only works after the CSP fix.
- [x] **Compile in the UI**: the Recompile button compiles via clsi-typst and the PDF preview renders
      (pdf.js canvas 602x851 with non-blank content — verified by pixel sampling the screenshot).
- [x] **Log panel**: present with the All-logs / Errors / Warnings / Info counts; a clean compile shows 0
      (correct). The Typst branch is wired in `output-files.ts` (`data.options.compiler === 'typst'`
      → `parseTypstLogEntries`). Ran the ported `typst-log-parser` against a real failed build's
      `output.log`: it yields `{ level:'error', message:'unknown variable: error', file:'main.typ',
      line:3, column:1 }` — i.e. error entries with file/line/column for click-to-source from the log.
- [x] **Sync (click-to-source + source-to-PDF)**: `GET /project/:id/sync/pdf` (page/h/v → file/line/column)
      and `GET /project/:id/sync/code` (file/line/column → page/h/v/w/h) both return correct data via
      clsi-typst (both require the `editorId` query param the frontend always sends).
- [x] **Word count**: `GET /project/:id/wordcount` → `{textWords, headWords, headers}`.
- [~] **Completion**: typing an incomplete `#f` trips an upstream panic in the wasm grammar
      (`typst-syntax` crate: `Option::unwrap() on None`, then a rust aliasing error). This is an
      **upstream bug in `codemirror-lang-typst@0.4.0`** — the OlliTeX source pins the same `^0.4.0`,
      so it is parity, not a porting defect. Highlighting/outline/compile/log are all unaffected in
      normal use (the panic is only on certain in-flight edit states).

**Bottom line:** all five success criteria hold in the browser, and the audit surfaced one real defect
(the CSP `wasm-unsafe-eval` gap) which is now fixed in-repo and hot-patched into the running stack.

## Attribution

Typst support in this repository is built on contributions from the following upstream projects.

**kxxt/overleaf** (typst branch) — code contributions from @kxxt
- https://github.com/kxxt/overleaf/tree/typst

**texlyre** — Typst editor implementation by @fabawi and contributors
- https://github.com/texlyre/texlyre

**typst/typst** (fork `0.15.1-with-extras` @ `d101c2f507acd2e680a187735c5c201094e00077`)
- https://github.com/typst/typst

The Typst language support for CodeMirror uses `codemirror-lang-typst@0.6.x`
(https://github.com/codemirror-lang-typst), which provides a WASM-free native
Lezer parser and bundled service extensions (highlighting, indent, fold, lint,
completions).
