# LanguageTool module

Grammar and style checking in the Overleaf source editor, powered by an
external [LanguageTool](https://languagetool.org) server (API v2).

Based on the upstream PR:
<https://github.com/yu-i-i/overleaf-cep/pull/179> (commit 8337e00), adapted
for ext-ce-v6.3.1 with:

- **Picky level as the default** and an on/off "Picky mode" toggle in the
  project settings (the deployed LT fork, `erikvl87/languagetool`, supports
  `default` + `picky`; other levels return HTTP 400).
- **Project-wide settings** (stored on the project document, shared by all
  collaborators, synced over the editor socket):
  - `languageToolEnabled` — grammar check on/off (default: on)
  - `languageToolPicky` — picky level on/off (default: **on** → `level=picky`)
  - `languageToolLanguage` — LT language code, e.g. `en-US`, `de` (default: `auto`)
- **Dark/light theme support**: tooltip + underlines use the Overleaf themed
  CSS variables (`--bg-primary-themed`, `--content-primary-themed`, ...)
  with light-mode fallbacks (fixes the dark-theme tooltip bug from the PR).
- **Env-gated visibility (runtime)**: when `LANGUAGE_TOOL_ENABLED` is not set on
  the container, the "LanguageTool" entry in Settings → Spelling and Language is
  hidden — including the section label — via the `languageToolAvailable`
  exposed setting. NOTE: this is a RUNTIME gate; the frontend slots in
  `config/settings.defaults.js` are registered unconditionally because that
  list is consumed at webpack BUILD time by the `import-overleaf-module`
  babel macro, so gating it on a build-time env flag silently dropped the
  chunks even when the deployment enabled the feature at runtime.

## Server (Overleaf) environment

| Variable                | Default           | Notes                                   |
| ----------------------- | ----------------- | --------------------------------------- |
| `LANGUAGE_TOOL_ENABLED` | _unset_           | must be exactly `true` to activate      |
| `LANGUAGE_TOOL_HOST`    | `languagetool`    | host of the LT service                  |
| `LANGUAGE_TOOL_PORT`    | `8010`            | LT API port                             |
| `LANGUAGE_TOOL_URL`     | derived           | overrides host+port when set            |

The overleaf container needs network access to the LT service. Both backend
containers ship in this repo under `tools/containers/`:

| Container | Path | Notes |
| --------- | ---- | ----- |
| `languagetool` | `tools/containers/languagetool/` | `erikvl87/languagetool` Java server, v2 API, `./ngrams` models (see its `download_ngrams.sh`) |
| `grammar-llm` | `tools/containers/grammar-llm/` | drop-in replacement: same port (8010), same `/v2/*` wire API, backed by a GRMR-V3-G4B LLM (local or OpenAI-compatible). English only, so keep `LANGUAGE_TOOL_ENABLED` scoped accordingly. See its README. |

Whichever container is used, point `LANGUAGE_TOOL_HOST` (or
`LANGUAGE_TOOL_URL`) at it — e.g. `http://languagetool:8010` when the overleaf
container shares its Docker network.

> **Visibility gating (runtime, not build-time).** On the server, the router
> is registered only when `LANGUAGE_TOOL_ENABLED=true` (this module's
> `index.mjs`). The frontend slots (`sourceEditorExtensions`,
> `settingsModalSpellcheckSections` in `config/settings.defaults.js`) are
> registered **unconditionally on purpose**: that list is read at webpack
> build time by the `import-overleaf-module` babel macro
> (`frontend/macros/import-overleaf-module.macro.js`), so a build-time env
> gate would drop the chunks even for enabled deployments. Runtime visibility
> is instead driven by the exposed setting `languageToolAvailable` (set from
> `LANGUAGE_TOOL_ENABLED` at container start): the settings section hook
> returns `null` (hiding the label too) and the editor extension stays dormant
> when the service is disabled.

## Endpoints (authenticated)

- `GET /languagetool/languages` — LT language list (used by the settings UI)
- `POST /languagetool/check` — JSON body `{ language, level?, text? | data? }`;
  proxied to LT `/v2/check` with a 100 KB cap and LaTeX-noise `disabledRules`.
  **Exempt from CSRF** (`webRouter.csrf.disableDefaultCsrfProtection` in the
  router): it is a stateless, login-gated query — and long-lived editor tabs
  outlive session rotations, where the page's meta token would stale out and
  403 every check. The client still sends `X-CSRF-Token`; it passes when the
  session is fresh.

## Frontend

- `frontend/js/languagetool-extension.ts` — CodeMirror 6 extension
  (wired via the `sourceEditorExtensions` slot in
  `services/web/config/settings.defaults.js`). Wavy underlines + hover
  tooltip with replacement buttons; LaTeX-aware annotation via the Lezer
  syntax tree (regex fallback); debounced 2 s; aborts stale requests;
  filters TYPOS while the Hunspell spellchecker is active.
- `frontend/js/languagetool-section.tsx` +
  `frontend/js/components/languagetool-settings.tsx` — Settings modal,
  Spelling and Language → **LanguageTool** (wired via the
  `settingsModalSpellcheckSections` slot).

Settings reach the editor through `options.languageTool`
(`use-codemirror-scope.ts`) and the `lt:settings-changed` window event.

## Files

```
index.mjs                                  module entry (env-gated router)
app/src/LanguageToolRouter.mjs
app/src/LanguageToolController.mjs
frontend/js/languagetool-extension.ts      dormant unless available at runtime
frontend/js/languagetool-section.tsx       returns null (no label) when unavailable
frontend/js/components/languagetool-settings.tsx
frontend/js/utils/latex-to-annotations.ts
```

Core Overleaf changes (see git diff):

- `services/web/config/settings.defaults.js`
  (`sourceEditorExtensions`, `settingsModalSpellcheckSections`,
  `moduleImportSequence`)
- `services/web/app/src/infrastructure/ExpressLocals.mjs`
  (exposed setting `languageToolAvailable`)
- `services/web/types/exposed-settings.ts`
- `services/web/app/src/Features/Project/ProjectController.mjs`
  (project-settings schema + update)
- `services/web/app/src/Features/Project/ProjectOptionsHandler.mjs` (persist)
- `services/web/app/src/Features/Editor/EditorController.mjs` (socket emit)
- `services/web/frontend/js/features/ide-settings/...` (settings UI context,
  hooks, socket listener, `api.ts`)
- `services/web/frontend/js/features/source-editor/hooks/use-codemirror-scope.ts`
