# LLM module for Overleaf Community Edition

Bring your own LLM endpoints (BYO) plus a site-wide shared backend into the
project editor: selection-based **Ask AI** toolbar, a **chat rail**, **inline
completion**, whole-document **generators** (title / abstract / keywords), and
**rubric-based compliance reviews**.

## Provider stack (Vercel AI SDK)

All model calls go through one seam — `app/src/LLMClient.mjs` — built on the
Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`,
`@ai-sdk/openai-compatible`). Three provider types:

| Type                 | Adapter                 | Use for                                              |
|----------------------|-------------------------|------------------------------------------------------|
| `openai`             | `@ai-sdk/openai`        | api.openai.com (or any override base URL)            |
| `anthropic`          | `@ai-sdk/anthropic`     | api.anthropic.com (or any override base URL)         |
| `openaiCompatible`   | `@ai-sdk/openai-compatible` | Ollama, vLLM, llama.cpp, academiccloud, OpenRouter, any OpenAI-style `/v1` server |

Structured outputs (compliance reviews) use `generateObject`; backends that
cannot do strict structured output fall back to plain JSON + a tolerant parser
with retries. Reasoning ("thinking") models are supported; empty answers where
the budget was spent on thinking are surfaced as a clear `empty-response`
error.

## Lanes

Every LLM call runs on one of two lanes, resolved from the **model id**:

- **Site lane** — bare model id (e.g. `qwen3.8:latest`), the admin-configured
  backend. Explicit model ids must be in the admin `allowedModels` list.
- **User lane** — namespaced id `u:<rowId>:<model>`, one of the user's BYO
  provider rows. The user's own credentials are used.

### Model selection (shared, user-scoped)

Since 2026-08-26 there is ONE shared model choice per user, stored on the user
profile (`User.llmSelectedModel`): the **File → “Select LLM Model”** modal
(site models first, then each BYO row) persists it, and *every* AI surface
consumes it — chat rail, inline completion, Ask-AI transforms, the whole-document
generators, and compliance reviews. Lane resolution for a request without an
explicit model is:

1. the user's shared selection (profile),
2. the user's first enabled BYO row (when BYO is allowed),
3. the site backend (admin settings or env).

So a deployment **without any global LLM** is fully functional for users who
have a BYO row or a saved selection. The old admin “Review model” and “Inline
completion model” pickers are gone (both surfaces use the same chain). The
saved value is validated on write (well-formed model reference or empty
string) because a broken selection silently downgrades every surface.

## Endpoints

All chat/completion/generation endpoints are project-scoped (read permission);
settings are user- or admin-scoped.

| Method | Path                                        | Purpose                              |
|--------|---------------------------------------------|--------------------------------------|
| POST   | `/project/:id/llm/chat`                     | Chat (Ask AI rail + toolbar)         |
| GET    | `/project/:id/llm/models`                   | Site models + user provider rows     |
| GET    | `/project/:id/llm/features`                 | Per-feature enable flags             |
| GET    | `/project/:id/llm/source-context`           | Source window around a compile error |
| GET    | `/project/:id/llm/prompts`                  | Effective editable prompts           |
| POST   | `/project/:id/llm/completion`               | Inline completion                    |
| POST   | `/project/:id/llm/generate`                 | Title / abstract / keywords          |
| GET    | `/project/:id/llm/compliance/rubrics`       | Configured rubrics                   |
| POST   | `/project/:id/llm/compliance/start`         | Start a review job                   |
| GET    | `/project/:id/llm/compliance/status/:jobId`| Poll a review job                    |
| POST   | `/project/:id/llm/compliance/cancel/:jobId`| Cancel a review job                  |
| GET    | `/user/llm-providers`                       | List BYO rows (keys masked)          |
| POST   | `/user/llm-providers`                       | Add a BYO row                        |
| POST   | `/user/llm-providers/:id`                   | Update a BYO row                     |
| POST   | `/user/llm-providers/:id/delete`            | Delete a BYO row                     |
| POST   | `/user/llm-providers/check`                 | Test an existing row or draft        |
| POST   | `/user/llm-providers/scan`                  | List models served by a backend      |
| GET    | `/user/llm/selected-model`                  | Current shared model selection       |
| POST   | `/user/llm/selected-model`                  | Save the shared selection `{selected}` |
| GET    | `/user/llm/compliance`                      | User's review rubrics (+ inherited flag) |
| POST   | `/user/llm/compliance`                      | Save the user's review rubrics `{rubrics}` |
| GET    | `/user/llm-usage?days=N`                    | My token usage (meter, default 30 days)  |
| GET    | `/admin/llm/settings` (+ `/json`)           | Site backend settings page/API       |
| POST   | `/admin/llm/settings`                       | Save site backend settings           |
| POST   | `/admin/llm/settings/check`                 | Connection test (model list fetch)   |
| POST   | `/admin/llm/models`                         | Scan the site backend for models     |
| GET    | `/admin/llm/usage?days=N`                   | Whole-site token usage (meter)       |

* `GET /user/llm-settings` — dedicated user settings page: BYO provider table
  (Test/Scan) **plus the user's own compliance review rubrics** (the rubric
  editor is per-user since 2026-08-27; a user without their own set inherits
  the deployment-wide defaults until they save one).
* Admin settings UI: **Manage Site → “LLM Configuration” tab**
  (`/admin`), served by the standalone page `GET /admin/llm/settings`, with
  six sections: **Features, API Connection, Model Selection, System Prompt,
  AI Prompts, Usage** (the review token budgets live under AI Prompts).
  There is intentionally **no separate navbar entry** (reviewer requirement).
* **Usage meter (2026-08-28):** every successful model call is captured in
  `LLMClient.chatText/chatObject` (`options.usageMeta`, single choke point)
  and stored in the `llmusages` collection (`LLMUsage.mjs`): userId, action
  (`chat`, `completion`, `review`, `generate-<type>`, `compile-fix`,
  `check`), lane (`site`/`user`), model, input/output/total tokens, day
  bucket. Record is fire-and-forget and swallows Mongo errors — the meter
  can never break an LLM call or a settings page. Both meters render a
  muted “unavailable” note if the store is unreachable. Shown as the admin
  “Usage” tab (whole site) and a “Usage” card on `/user/llm-settings`
  (my own rows only); 30-day bar series + by-feature + top models.

## Environment variables

| Variable                   | Default          | Meaning                                             |
|----------------------------|------------------|-----------------------------------------------------|
| `LLM_ENABLED`              | `true` if `llm.enabled !== false` | Loads the module at all |
| `LLM_API_URL`              | —                | Fallback site backend base URL (admin file wins)    |
| `LLM_API_KEY`              | —                | Fallback site backend key                           |
| `LLM_MODEL_NAME`           | —                | Fallback default model (comma list for several)     |
| `LLM_AVAILABLE_MODELS`     | —                | Fallback allowed model list                         |
| `LLM_API_TYPE`             | auto-detect      | Fallback provider type (`openai`/`anthropic`/`openaiCompatible`) |
| `LLM_ALLOW_USER_SETTINGS`  | **off**          | `'true'` enables BYO rows (all user endpoints 403 otherwise) |
| `LLM_KEY_SECRET`           | —                | Secret for encrypting stored API keys (AESCrypt, `enc:v1:`). **Set it** — without it keys are stored in plaintext. |
| `LLM_ADMIN_SETTINGS_PATH`  | `/var/lib/overleaf/data/llm-admin-settings.json` | Site settings file |
| `LLM_USER_RATE_PER_MINUTE` | `60`             | Per-user LLM calls per rolling minute               |
| `LLM_USER_DAILY_TOKENS`    | `1000000`        | Per-user output-token budget per UTC day            |
| `LLM_REVIEW_MAX_TOKENS`    | `12000`          | Review answer budget                                |
| `LLM_REVIEW_MAX_PASSES`    | `200`            | Max review passes per job (per-file caps include)   |

## Security notes

- BYO endpoints are gated on `LLM_ALLOW_USER_SETTINGS` in **every** handler
  (router registration is unconditional; disabled deployments answer `403`).
- Site-lane model ids are validated against the admin allowlist server-side.
- API keys are encrypted at rest when `LLM_KEY_SECRET` is set (never returned
  to the browser, only `hasKey`). The **admin site key** is masked the same
  way: the UI shows `••••••••` placeholders, and `GET /admin/llm/settings/json`
  exposes only `hasLlmApiKey` — the raw key never crosses the wire either way
  (verified 2026-08-28 audit, item m1).
- **BYO SSRF guard (2026-08-28 audit, item M1).** User-supplied provider base
  URLs (add / update / Test / Scan) must pass `assertPublicLlmBaseUrl`
  (`LLMClient.mjs`): http(s) only, and the host must not be loopback
  (`localhost`, `.local`, `.internal`, `.lan`, `127.0.0.0/8`, `::1`),
  unspecified (`0.0.0.0`, `::`), cloud metadata/link-local (`169.254.0.0/16`),
  or other reserved ranges. Blocking these stops a user row from being pointed
  at internal services (metadata endpoint, adjacent containers) to exfiltrate
  or probe. **Private LAN ranges are deliberately allowed** (10/8, 172.16/12,
  192.168/16) — a local Ollama/llama.cpp on the LAN is a core BYO use case, and
  the admin site lane already uses docker-network URLs. Known limitation: a DNS
  name that *resolves* to a blocked range after passing the guard is not
  re-checked at request time (single-host deployments; documented trade-off).
- Scan-pattern regexes (admin and user rubrics) pass one shared validator with
  length caps (whole field ≤ 4000, **each pattern ≤ 200 chars**) before any
  `new RegExp()` compile — they are evaluated on every review run.
- The shared model selection is validated on save (well-formed model reference
  or empty string; anything else is a 400), so a client bug cannot wedge every
  AI surface of a profile.
- LLM output is rendered through `marked` + `DOMPurify` (sanitized) in the
  chat rail and selection toolbar.
- Per-user rate + daily token guards protect the shared backend from
  runaway usage (inline completion is the high-frequency path).
- Review jobs are capped: per-user in-flight limit, global queue limit, and a
  hard pass budget per job.

## Job & usage persistence (2026-08-28 audit, item M2)

Two collections make runtime state survive a server restart. Both use the raw
mongoose package (the same default instance the app connects) with
`bufferCommands: false`, and **every operation is non-fatal** — a Mongo hiccup
logs and swallows; it never breaks an LLM call, a review, or a settings page.

- **`llmreviewjobs`** (`app/src/models/LLMReviewJob.mjs`) — compliance review
  jobs persist their state and result. Previously both lived only in process
  memory, so a restart mid-review turned every later poll into a spurious
  “not found or expired”. Now: the in-process queue stays the executor, but
  `status`/`cancel` answer from Mongo when the job is not live in this process;
  a stale `queued`/`running` document is promoted to a definitive
  `server-restarted` error (once-per-process lazy sweep); a `done` result is
  retrievable after a restart. The live `AbortController` is intentionally not
  persisted (per-process only).
- **`llmusages`** (`app/src/LLMUsage.mjs`) — the usage meter (see above).

## Legacy import (upgrade path)

Users of the previous single-backend design stored `llmApiUrl`/`llmApiKey`/
`llmModelName` (+ `llmApiType`) on the user document. On the first
`loadProviders()` call, that configuration is **materialized once** into
`llmProviders[0]` — an `id: 'legacy'` row named **“Imported settings”**
(`enabled: true`) with the key **encrypted at rest** — and served under its
`legacy` id from then on. The legacy fields are left untouched, so a rollback
deep-links the same data. Users who already have provider rows are not
affected.

## Error surfacing for failed connections

`check`/`scan` and admin saves surface *specific* failures:

- Provider 401/403 → `HTTP 401` with a human message ("provider rejected
  the key / no key provided", provider detail included when the backend
  returns one). The UI shows that message in the connection notice.
- Admin settings save → `400 {ok:false, error, errors:[{field,message}]}`
  (all zod issues), shown as a banner next to the Save button.
- Chat/generator/completion failures name the **model** that failed: 404 →
  "Model not found … re-scan the provider and select an available model",
  5xx → "…transient provider overload — retry, or select a different model".

### Known model-behaviour quirks (handled)

- **Fabricated tool calls** — some instruct models answer generator/transform
  requests with a fake `tool call: get_keywords_from_document(…)` line. Every
  generator and transform prompt carries a hard *no-tool-call* instruction,
  the generator path retries once with a nudge, and if the output still looks
  like a tool call the user gets a clear "choose another model" error — the
  gibberish is never shown as the result.
- **Qwen "thinking" leaks** — `stripThinkTags()` removes stray `</think>`
  markers some Ollama/Qwen combinations emit into `content`.

## Ask AI context menu (reference-synced, 2026-08-27)

The selection toolbar (editor toolbar **Ask AI** button / floating anchor)
is context-sensitive like the reference product:

- **With a selection** → *Rephrase*, *Shorten*, *More scientific*,
  *Translate* (inline accordion with a **language search field** — reachable,
  no fly-out), *Synonyms*.
- **Without a selection** → the whole-document generators *Title*, *Abstract*,
  *Keywords* (File menu equivalents included).

The selection is captured at **pointer-down** on the trigger, so the click
itself can no longer clear it before the menu opens. Admin-action templates
exist exactly for the reachable actions: `paraphrase`, `academic`, `concise`,
`translate`, `synonyms` (orphaned templates were removed 2026-08-27).

## Tests

```bash
# Backend unit tests (offline; run from services/web/modules/llm):
cd services/web/modules/llm && node --test app/test/*.test.mjs
#   llm-client        — provider seam, error wrapping, assertNonEmpty
#   llm-crypto        — key-encrypt roundtrip + legacy plaintext
#   llm-url-guard     — BYO SSRF guard (allowed/blocked base URLs)
#   llm-usage         — usage schema + non-fatal offline behaviour
#   llm-compliance-rubrics — shared rubric validators + review-job schema
#   llm-compile-fix / llm-model-sync — remaining pure paths

node services/web/modules/llm/app/test/LLMClient.live.mjs   # live smoke (needs a reachable backend)

# Frontend render regressions (jsdom; needs the standalone harness config):
cd services/web
NODE_ENV=development <node_modules>/.bin/vitest run --config vitest.llm-frontend.config.js
```

Deployed-container verification (CDP/curl driver) covers login, site/user
lanes, BYO CRUD + check/scan, rate-guard burst, compliance job lifecycle,
the meter end-to-end (seeded call → both endpoints + both pages), and the
settings pages — green on the 2026-08-28 build (48/48 unit tests).

## Reviewer compliance (issue #222, remaining items)

- **#5 auto-detect API type** — `POST /user/llm-providers/check` and `/scan` try the
  requested type first, then every supported type. A working type different from
  the saved one is returned as `detectedProviderType`, the UI persists it on the
  row (drafts are switched too), and the Test button says "API type auto-set to …".
- **#9 model-list freshness (decided: manual only)** — no automatic background sync
  (removed by owner decision 2026-08-21: timer-based auto-refreshes can replace a
  user-curated model list and surprise users; the benefit was small). Model lists
  are refreshed explicitly: **Test connection** (verifies and returns the current
  list) and **Scan models** (merges the freshly served list into the row).
  Providers whose model roster changes over time are handled with one click of
  Scan — no timers, no background traffic, no rate-limit exposure.
- **#11 split/join** — removed from the editor toolbar (type, labels, modes 5/6)
  and the orphaned prompt templates were removed from the admin UI and the
  shipped defaults on 2026-08-27 (audit: no UI path referenced them anymore).
- **#13 generators in the File menu** — title / abstract / keywords in the core
  **File menu** (module extensions
  `frontend/js/extensions/llm-file-menu-*`, core `insertMenuSections` +
  `menubarExtraComponents` in `config/settings.defaults.js`). They read the whole
  project (`POST /project/:id/llm/generate`) — matching the reviewer's point
  that whole-document generators do not belong to a selection context — and open
  a result modal with copy-to-clipboard. Non-LLM deployments see no menu items
  (unregistered commands are filtered by the core menu renderer).
- **#2 user settings inside Account Settings** — per the owner refinement
  (2026-08-27) the Account Settings "AI assistant" section is now a **link card**
  to `/user/llm-settings` (BYO providers + the user's own compliance rubrics),
  keeping the core Account Settings page lean.

### Owner decisions (2026-08-27)

- **Global LLM via the admin interface** — the site backend is configured and
  edited under Manage Site → LLM Configuration (admin settings file), not via
  environment variables (`LLM_API_URL`/… remain only as fallbacks for
  deployments that prefer env).
- **Compliance review is user-based** — each user maintains their own rubric set
  (`/user/llm-settings` → Compliance Review); global admin rubrics survive only
  as the *inherited* deployment default until a user saves their own.
- **One shared model selection** (user-scoped) for every AI surface; the admin
  model pickers are gone.

### Audit hardening (2026-08-28)

- **M1 — BYO SSRF guard** on user base URLs (see Security notes); LAN allowed,
  loopback/metadata/reserved blocked.
- **m1 — admin key masking** verified end-to-end (UI + JSON API + logs).
- **M2 — review jobs in Mongo** (`llmreviewjobs`): results and job state
  survive restarts; definitive `server-restarted` answer for interrupted jobs.
- **M3 — i18n parity**: all module UI strings exist in `en.json` (38 canonical
  entries added) and are translated in `de.json` (123 entries added; the file
  has **zero** null values). New surfaces (usage meter, user rubric editor,
  compile-fix card, …) ship with EN defaults + German translations.
- **Usage meter** — token accounting on both settings pages (see above).

## Layout

- `app/src/LLMClient.mjs` — AI-SDK seam (models, chat text/objects, model
  listing, **BYO URL SSRF guard**, token-usage capture)
- `app/src/LLMModelRef.mjs` — model-ref grammar (`u:<rowId>:<model>`)
- `app/src/LLMBudget.mjs` — per-user rate + token guards
- `app/src/LLMChatController.mjs` — chat / completion / models / generators
- `app/src/LLMSettingsController.mjs` — BYO provider rows (CRUD, check, scan)
- `app/src/LLMAdminController.mjs` — site backend settings, check, scan, prompts
- `app/src/LLMComplianceController.mjs` — rubric review engine (job queue)
- `app/src/models/LLMReviewJob.mjs` — review-job Mongo schema + safe helpers (M2)
- `app/src/LLMUsage.mjs` — usage meter: `llmusages` schema, recorder, aggregator
- `app/src/LLMCrypto.mjs` — at-rest key encryption
- `app/src/LLMPrompts.mjs` — prompt defaults + merges
- `app/views/*.pug` — page shells (settings, admin)
- `frontend/js/components` — toolbar, chat rail, compliance pane, settings UI,
  **`llm-usage-meter.tsx`** (shared meter card)
- `frontend/js/hooks` — chat / compliance / features state
- `frontend/js/pages` — webpack entries (`user/llm-settings`, `admin/...`)
- `frontend/stylesheets/*.scss` — module styles (shared `--wf-*` design tokens)
