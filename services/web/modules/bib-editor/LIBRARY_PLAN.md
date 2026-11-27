# bib-editor — Library (Phase L) implementation plan

**Status: APPROVED & IMPLEMENTED (L1–L5).** Unit tests, i18n, scoped ESLint, and
the production webpack build are green; the live E2E matrix (Docker rebuild +
`127.0.0.1:4000`) is the remaining verification (L6).

The in-project `.bib` visual editor (Phases A–C) is synced to the overleaf.com
reference captures `2..4.html`. The one big section that is missing is the
**personal Library** — reference capture `1.html` (saved
`https://www.overleaf.com/library`, machine-readable spec in
`1_files/library-9230b27e5ab3067f9878.js` + `1_files/library-*.css`).
This plan builds the Library in the `bib-editor` module and makes the
deliberate-deviation C9 ("Import from Library" inside a project) functional.

**Repo:** `davrot/overleaf-cep` tree at `/root/junk_bib/overleaf-cep`, branch
`bib-editor` (initial commit `b0723c62`). **Module:**
`services/web/modules/bib-editor` (all behavior lives here). **Reference:**
`/root/junk_bib/ref_bib/` (1..4.html + `*_files/`).

**Environment (this machine):** Docker available; compose stack at
`/data_1/docker/compose_cep` (overleafserver image currently
`ext-ce-llm` — OLD, does **not** contain the bib-editor module; a rebuild
from this tree's `server-ce/` (~30 min) + container cycle is required for the
live matrix — skill `rebuild-overleaf-docker-image`). E2E via `127.0.0.1:4000`
(curl + cookie jar, CSRF re-GET after login, `X-Forwarded-Proto: https`).

---

## 1. Authority & precedence (final)

1. Reference capture `ref_bib/1.html` + `1_files/library-*.js/css` (SaaS
   Library) — wins for the Library section.
2. Phases A–C code (committed on `bib-editor`): in-project editor stays as-is.
3. Repo conventions (module pattern from `template-gallery` / `zotero`,
   i18n dual-file discipline, ESLint gate).

**Extracted reference spec (persisted here so the plan is self-contained):**

### 1.1 SaaS Library API (from the bundle)

| Method & path | Body / params | Response |
|---|---|---|
| `GET /library/references` | `?search=&trashed=true&cursor=` (SaaS also `scope=`) | `{items: entryApi[], nextCursor}` |
| `POST /library/references` | `{entries: [entryApi]}` (bulk create) | `{items: entryApi[]}` |
| `POST /library/references/match` | `{entries: [entryApi]}` | `{matches: string[]}` (keys already present) |
| `PATCH /library/references/:key` | `entryApi` (key rename allowed) | entryApi |
| `POST /library/references/delete` | `{ids?: string[]} \| {search?}, permanent: bool` | `{deletedCount}` |
| `POST /library/references/restore` | `{ids: string[]}` | `{restoredCount}` |
| `GET /library/references/download` | `?mode=exclusion&search=&ids=` | `.bib` file |
| `GET /library/references/count` | `?search=&trashed=` | `{count}` |
| `GET /library/references/citation-key-suggestions` | `?base=&keys=` | `{keys: string[]}` |
| `POST /zotero/sync` | — | **SaaS-only — out of scope** |

SaaS `entryApi` = `{key, type, fields: [{name, editableValue}]}`; stored
client model `{type, key, fields(Map name→{editableValue,...}), _id,
occurrenceIndex, updatedAt}`.

### 1.2 SaaS Library strings (en.json, exact)

`Add reference`, `Add references`,
`Add references to Library once and insert them into any project.`,
`Already in your library`,
`This citation key is used by another entry. Duplicate keys cause citation
errors — rename this key or delete one of the entries.`,
`Auto-generated from the author and year, if left blank`,
`Unique key for citations, no spaces or special characters`, `Clear search`,
`Permanently delete this reference?`,
`References you delete will be kept here for 30 days before being permanently
removed.`, `Paste BibTeX or DOIs here.`,
`References couldn’t be loaded. Refresh the page to try again.` (U+2019),
`Missing field(s) for` (`Missing field for`/`Missing fields for`),
`No results for ‘__query__’` (U+2018/U+2019), `No references in Trash`,
`Permanently delete` (`Delete permanently`), `View Trash`,
`__count__ reference moved to Trash` (`references_moved_to_trash`),
`References are permanently deleted after 30 days.`,
`Some or all DOIs could not be resolved.`, `Select at least one reference`,
`Upload .bib file`, `Upload failed`, `Your references, ready to use anywhere.`,
`Updated __date__`, `Sync now`/`Sync failed` (+ all `zotero_sync_*` —
SaaS-only, skip).
Plus existing CE strings already in `en.json` (Paste references, Enter
manually, Previous/Next reference, Select all entries, Required fields
missing, …) — reuse, add only the missing ones.

### 1.3 SaaS CSS (library-*.css, key rules)

`.library-heading`, `.library-toolbar`(`-trashed`), `.library-toolbar-actions`
(search `flex:1`), `.library-toolbar-buttons`, `.library-page-main`
(`:has(.bibtex-entry-preview-panel-open){margin-right:30rem}`),
`.library-body-row` / `.library-list-pane`, `.library-bulk-actions-{delete,
download,restore}-btn`, `.library-empty-state(-image|-heading|-body|-add-btn)`,
`.library-trash-notification`. (Bibtex-* rules already synced in C7.)

### 1.4 SaaS page anatomy (1.html)

- Top navbar (Projects …) + **application-page shell** (no fat footer).
- Toolbar row: `h1#library-heading "Library"`, search box
  ("Search in your library…"), Add dropdown (button `bibtex-add-button`).
- Add menu: **Paste references** ("BibTeX, DOI" description) →
  **Upload .bib file** → **Enter manually**.
  (In-project Add menu order per Phase C: Paste → Enter manually →
   Import from Library (C9 stub, disabled).)
- List pane: bulk bar (select-all + "N references"), virtualized entry rows
  (checkbox, key, title, author, year, **`Updated __date__`**, error icon,
  duplicate-key warning `bibtex_duplicates_keys`), preview panel on the right
  (same `bibtex-entry-preview-*` component as in-project: prev/next, summary,
  kebab Download/Delete, Details/Abstract tabs, inplace form).
- Empty states: `library-empty-state` (heading "Your references, ready to use
  anywhere." + body "Add references to Library once and insert them into any
  project." + Add button); no-search-results state ("No results for
  '__query__'", body "Try a different term" / "…or add a new reference",
  Clear search button).
- Trash view: trashed toolbar, trash notification
  ("References you delete will be kept here for 30 days…"), bulk
  **Restore** + **Delete permanently** (confirm
  "Permanently delete this reference?" / N-variant),
  "No references in Trash" empty state,
  "References are permanently deleted after 30 days."
- Hidden `<input type="file" accept=".bib">` (client-side .bib upload).
- Delete → trash toast: "__count__ reference moved to Trash" (+ View Trash
  action). Duplicate keys are ALLOWED but flagged
  ("This citation key is used by another entry…").

---

## 2. Scope

**In (Phase L):**
- L-data: per-user `LibraryReference` Mongo model (user-scoped references;
  trash as soft delete; 30-day retention with lazy purge).
- L-api: the SaaS REST surface above (minus `/zotero/sync`, minus `scope`).
- L-page: `/library` (+`/library/trashed` deep-link) app page with the SaaS
  anatomy above, reusing the committed components
  (`bib-entry-list`, `bib-entry-form`, `bib-entry-preview`, `bib-import-modal`,
  all `utils/*`).
- L-add: Paste references / Upload .bib / Enter manually (modal,
  type-helper "Select a type to see the required fields."), citation-key
  suggestions + duplicate-key handling.
- L-C9: in-project Add-menu **"Import from Library"** — functional
  (lists the user's library, search + select, imports selection into the
  open `.bib` through the existing guarded `importMany` path; file-key
  conflicts pre-unchecked with the existing "Key already exists in the
  file" line).
- L-strings/CSS/config/nav: i18n dual-file additions (alphabetical, U+2019),
  `bib-library.css`, `Settings.bibLibrary`, top-nav "Library" link.
- L-tests: module-local unit tests (new pure modules), i18n sanity,
  ESLint 0 warnings, `make all` build gate, live matrix (rebuild + cycle).

**Out (deliberate deviations, recorded here):**
- D-C1 API field shape: CE returns `{name, value}` (plain strings); SaaS used
  `editableValue` (rich values). Frontend maps; no functional difference.
- D-C2 No `scope` param (personal library only).
- D-C3 No Zotero/Mendeley/Papers Library sync (SaaS OAuth + `ol-refSyncState`
  machinery), no split-test badge, "Give feedback" link, or docs info-badge.
- D-C4 Navigation: top-nav **"Library"** link (SaaS uses the workbench
  Projects↔Library↔Trash sidebar switcher, which CE dashboards don't have);
  Library↔Trash stays an in-page view switch + `/library/trashed` route.
- D-C5 .bib upload is client-side (file text → same paste pipeline; no new
  server upload endpoint).
- D-C6 Trash purge is a lazy idempotent sweep (on list/count/restore), not a
  cron worker (2-worker safe: Mongo-backed, per-worker safe).
- D-C7 In-project editor semantics unchanged (file is truth, R1–R4); the
  Library is a separate user-scoped store; C9 is the bridge.

**Not in this phase (tracked, open from Phase C):** D9 reference Add-modal
details (subsumed by L-add "Enter manually" — resolved here), D11
error-tooltip click wiring in the project list (small, separate ticket).

---

## 3. Data model (L-data)

`app/src/models/LibraryReference.mjs` (module-local mongoose model,
`template-gallery` pattern — `mongoose.model('LibraryReference', schema)`
with the `mongoose.models.Name ||` guard against double-registration):

```
{
  user_id:    { type: String, required: true }   // core-model convention
  key:        { type: String, required: true }
  type:       { type: String, required: true }   // one of the 48
  fields:     [ { name: String, value: String } ] // ordered; minimize:false
  occurrence: { type: Number, default: 0 }        // stable ordering
  trashedAt:  { type: Date, default: null }       // soft delete
  searchBlob: String                             // lowercased, diacritic-
                                                 // stripped blob (key, type,
                                                 // field names+values,
                                                 // space-separated) — cheap
                                                 // case/diacritic-insensitive
                                                 // regex search (SaaS bundle
                                                 // maps æ→ae, œ→oe, ø→o, ß→ss,
                                                 // ł→l, đ→d, ð→d, þ→th, ŋ→ng)
  createdAt/updatedAt (Date)
}
Indexes: {user_id:1, key:1}            // NON-unique (dup keys allowed, SaaS)
        {user_id:1, trashedAt:1, occurrence:1}
```

Gating/config: `Settings.bibLibrary = {
  enabled: process.env.OVERLEAF_BIB_LIBRARY !== 'false',   // default ON
  trashRetentionDays: parseInt(process.env.OVERLEAF_BIB_LIBRARY_TRASH_RETENTION_DAYS || '30', 10)
}` — set in `index.mjs` (evaluated at page render, before anything reads it).

---

## 4. Backend (L-api)

New files (all in the module, `app/src/`):

- `LibraryRoutes.mjs` — `apply(webRouter, privateApiRouter, publicApiRouter)`:
  all routes `AuthenticationController.requireLogin()`; rate limiters
  (template rateLimiter pattern) for create/delete/download. Express order:
  specific paths before `/:key` (`/match`, `/delete`, `/download`, `/restore`,
  `/count`, `/citation-key-suggestions` → then `PATCH /:key`).
- `LibraryController.mjs` — thin; session user id; validation
  (type in the 48 vocabulary via a small shared const; key regex
  `^[A-Za-z0-9._:/-]+$`); errors as `OError` (400/404/409
  `duplicate-key`).
- `LibraryManager.mjs` — CRUD + search + cursor paging
  (`cursor` = last `_id` hex, `occurrence` asc sort, default limit 50,
  max 200) + match + suggestions + trash ops + lazy retention purge
  (single idempotent `deleteMany({user_id, trashedAt:{$gt:null,$lt:cutoff}})`
  per handler) + download serialization.
- `LibrarySerializer.mjs` — pure BibTeX (de)serialization for
  `download` (entries → `.bib` text, brace escaping, ordered `fields`,
  `@type{key, name = {value}, ...}`) — unit-tested round-trip against the
  committed `bib-parser.ts` via a JS-compatible port (the parser is TS; the
  serializer is independent, tested on known fixtures).
- `LibrarySearch.mjs` — pure: diacritic-fold map (1.4 spec),
  `normalizeQuery`, `entrySearchBlob(entry)`, `matchesSearch(entry, q)` —
  unit-tested (this is the SaaS `æ→ae…` logic, machine-extracted).
- `app/src/models/LibraryReference.mjs` — schema above.
- `app/views/library/library.pug` — extends
  `../../../../../app/views/layout-react`;
  `block entrypointVar - entrypoint =
  'modules/bib-editor/pages/library'`; `block vars - suppressFooter = true`
  (application-page, SaaS capture); `block content #library-root` (+
  `ol-libraryView` meta = `'library' | 'trash'`).
- `index.mjs` — currently `export default {}` → becomes
  `{ router: LibraryRoutes }` (+ `Settings.bibLibrary` default set when
  unset); keeps `moduleImportSequence` entry (already registered, line 1236).

**API contract (CE):** exactly §1.1 with D-C1/D-C2; all requests scoped to
`req.session` user id (no user-id in body); responses exactly the SaaS
shapes (so reference diffs stay machine-comparable). `download` sends
`Content-Type: text/plain; charset=utf-8` +
`Content-Disposition: attachment; filename="library.bib"`.

**Page routes:**

```
GET /library          requireLogin, AsyncLocalStorage.middleware,
                       PermissionsController.useCapabilities()
                       → res.render('library/library', { libraryView: 'library' })
GET /library/trashed  same → libraryView: 'trash'
```

(Nav link: `nav.header_extras += {text: 'Library', url: '/library'}`
gated on `OVERLEAF_BIB_LIBRARY !== 'false'` — the one shared-file
touchpoint beyond i18n; additive, reversible.)

---

## 5. Frontend (L-page / L-add / C9)

New files (module `frontend/`):

```
js/pages/library.tsx            # webpack entry (auto-discovered:
                                # modules/*/frontend/js/pages/**) →
                                # bootstrap <LibraryRoot/> into #library-root
js/library/library-root.tsx     # providers + trashed-state (route-derived)
js/library/library-context.tsx  # API-bound state: entries (cursor paged),
                                # loading/error, trashed view, search,
                                # bulk selection, toasts, selection
js/library/library-api.ts       # fetch-json client for §4 endpoints
                                # (CSRF via shared fetch-json; AbortController
                                # where SaaS used swallowAbortError:false)
js/library/library-model.ts     # PURE: search filter, suggestion merge,
                                # normalized entry mapping (unit-tested)
js/library/library-page.tsx     # shell: heading row, toolbar (search + Add
                                # dropdown), body row (list pane + preview),
                                # toasts, empty / no-results / error states
js/library/library-trash-page.tsx
js/library/library-add-menu.tsx # Paste references | Upload .bib file |
                                # Enter manually
js/library/library-manual-modal.tsx  # OLModal + BibEntryForm
                                    # (variant='modal', kind='new',
                                    # t('Select a type to see the required
                                    # fields.') helper, Cancel + Add)
js/components/bib-import-from-library.tsx  # C9 (project-side modal)
stylesheets/bib-library.css     # §1.3 spec + .library-* / trash / empty states
```

**Reuse (no fork):** `bib-entry-list.tsx` gains a small `variant` prop set
(`addActions: 'project' | 'library' | 'trash'`, `showUpdatedAt`,
`onBulkRestore`, `onBulkDeletePermanent`, `searchPlaceholder`,
`onUpload`) — in-project behavior unchanged when props are omitted;
`bib-entry-form.tsx`, `bib-entry-preview.tsx`, `bib-import-modal.tsx`,
`bib-parser/bib-types/bib-validate/bib-import/doi-fetcher/preview-model/
overleaf-type-map/virtual-list` all used as-is. `Preview` in-library:
`entries` = loaded page of entries, prev/next walk the loaded list (SaaS:
pagination cursor; we keep simple: walk current page; next-page loads on
boundary), `onDownload` = single-entry `.bib` via the serializer (client
build), `onDelete` (library mode) = move-to-trash (trash mode) = delete
permanently confirm.

**C9 (project):** `bib-entry-list.tsx` Add-menu C9 stub → enabled item
"Import from Library" (enabled iff `Settings.bibLibrary.enabled` reached by
the client — the menu item is always rendered; opening it fetches
`GET /library/references?limit=50&search=` and surfaces
"References couldn't be loaded…" on failure). Import goes through the
**existing** guarded `importMany` event (C5 path) — no new write machinery.

**i18n (L-strings):** additive keys in BOTH `services/web/locales/en.json`
(English value, U+2019 apostrophes) and
`services/web/frontend/extracted-translations.json` (`""`), inserted
alphabetical; the module's `i18n.test.mjs` pattern already enforces
"every module literal exists in both files" — it will pick the new
strings up automatically once the components use them. **New strings (delta
vs current en.json):** the §1.2 list minus the ~15 already present
("Add reference", "Paste references", "Paste BibTeX or DOIs here.",
"Paste BibTeX, DOI"… exact delta computed at implementation time against
`en.json`; the i18n test is the gate).

**CSS (L-css):** `bib-library.css` (new file, imported by the page entry +
the C9 modal) — §1.3 rules verbatim-adapted to our design tokens
(`var(--bg-secondary-themed)`, `var(--border-radius-…)`), plus
`.bibtex-entry-card-updated-at` (SaaS shows "Updated __date__" on
library rows), `.library-bulk-actions-restore/-download/-delete-btn`,
`.bibtex-entry-list-panel` 320px search (already in C7 css; verify),
`.bibtex-already-in-library` (already in C7 css).

---

## 6. Tests & verification (L7)

1. **Unit (module-local vitest, no network):**
   - `test/unit/src/library-search.test.mjs` — diacritic fold (exact SaaS
     map: æ→ae, œ→oe, ø→o, ß→ss, ł→l, đ→d, ð→d, þ→th, ŋ→ng),
     `matchesSearch`, `entrySearchBlob`.
   - `test/unit/src/library-model.test.mjs` — suggestion merge/collision
     (author/year + suffix, excluding taken keys), entry mapping,
     trash-filter predicate.
   - `test/unit/src/library-serializer.test.mjs` — BibTeX serialize
     (escaping braces/backslashes, ordered fields, multi-line `abstract`,
     comment-free), round-trip fixtures.
   - `test/unit/src/bib-import-from-library.test.mjs` — C9 rows:
     file-key conflict pre-unchecked + "Key already exists in the file"
     line; non-conflict selectable.
   - existing 10 suites stay green.
2. **i18n:** `i18n.test.mjs` (both JSON files, `__var__` interpolation only).
3. **Lint:** scoped module ESLint, `--max-warnings 0` (repo gate).
4. **Build:** `make all` (build-only; label==sha; no webpack ERROR) via
   `server-ce/` — from services/web per repo convention.
5. **Live matrix (after image rebuild + container cycle):**
   - L-V1 GET `/library` renders (#library-root + entry script; no raw i18n
     keys; toolbar/list/empty state per §1.4).
   - L-V2 Add → Enter manually → save (key auto-generated via
     suggestion endpoint; duplicate-key warning shown, entry still created
     (SaaS behavior)).
   - L-V3 Add → Paste references (BibTeX + DOIs) → preview (Already-in-
     library tags) → Import.
   - L-V4 Add → Upload .bib file (fixture) → preview → Import.
   - L-V5 search (diacritic case: "ernst" finds "Efficient … Ernst 2007";
     accented query folds) + no-results state + Clear search.
   - L-V6 preview: Details form edits + Abstract tab + prev/next +
     Close; Edit persists (PATCH round-trip; `updatedAt` line updates).
   - L-V7 bulk select → Delete → toast "__count__ reference moved to Trash"
     (+ View Trash) → trash view → Restore (back) → Delete permanently
     (confirm) → gone.
   - L-V8 Download (selection + `mode=exclusion&search=`) content correct.
   - L-V9 C9 in-project: Add → Import from Library → select → Import into
     `.bib` (appears in Code mode; conflict line pre-unchecked).
   - L-V10 CSRF/401 behavior on raw API (unauthenticated → 401/redirect;
     bad CSRF → 403), rate-limit header present.
   - L-V11 i18n: no raw keys anywhere in rendered DOM (grep `__count__`,
     `t('`).
   - L-V12 two-worker sanity: create in one tab (worker A), visible in
     worker B session (Mongo-backed; no per-process state).
6. **Upstream-merge hygiene:** module README updated (component table +
   i18n note + new tests + Library section); shared touchpoints limited to
   (a) the two i18n JSONs (additive-only), (b)
   `settings.defaults.js` nav item (additive, env-gated), (c) no
   `app/src/*` core changes.

---

## 7. File map (delta)

```
NEW   app/src/LibraryRoutes.mjs
NEW   app/src/LibraryController.mjs
NEW   app/src/LibraryManager.mjs
NEW   app/src/LibrarySearch.mjs
NEW   app/src/LibrarySerializer.mjs
NEW   app/src/models/LibraryReference.mjs
NEW   app/views/library/library.pug
NEW   frontend/js/pages/library.tsx
NEW   frontend/js/library/library-root.tsx
NEW   frontend/js/library/library-context.tsx
NEW   frontend/js/library/library-api.ts
NEW   frontend/js/library/library-model.ts
NEW   frontend/js/library/library-page.tsx
NEW   frontend/js/library/library-trash-page.tsx
NEW   frontend/js/library/library-add-menu.tsx
NEW   frontend/js/library/library-manual-modal.tsx
NEW   frontend/js/components/bib-import-from-library.tsx
NEW   frontend/stylesheets/bib-library.css
NEW   test/unit/src/library-search.test.mjs
NEW   test/unit/src/library-model.test.mjs
NEW   test/unit/src/library-serializer.test.mjs
NEW   test/unit/src/bib-import-from-library.test.mjs
NEW   LIBRARY_PLAN.md (this file)
MOD   index.mjs                       # router + Settings.bibLibrary
MOD   frontend/js/components/bib-entry-list.tsx   # variant props + C9 enable
MOD   frontend/stylesheets/bib-editor-panel.css   # (only if library css needs
                                                  #  shared bibtex-* additions)
SVC   services/web/locales/en.json                          # additive only
SVC   services/web/frontend/extracted-translations.json     # additive only
SVC   services/web/config/settings.defaults.js              # nav item, env-gated
MOD   README.md                     # Library section + i18n/tests updates
DEL   (none)
```

**Untouched:** `bib-editor-extension.ts`, `bib-write.ts`, panel/context/
provider (project write path — R1–R4), all `utils/` except where the C9
modal needs `buildImportRows` (already generic).

---

## 8. Phases (one commit each, in order)

| Phase | Content | Gate |
|---|---|---|
| **L1** | Backend: model + search/serializer pure modules + manager + controller + routes + page routes + `index.mjs` router | unit tests (search/serializer) green; `node --check` all .mjs; curl API smoke (login jar) |
| **L2** | Page shell: pug + page entry + root/context/api-client + toolbar/search + list (reused) + bulk bar + empty/no-results/error states + trash view | make-all build green; live L-V1/V5/V7 (if rebuilt) |
| **L3** | Add flows: add menu (Paste/Upload/Manual) + manual modal + suggestions + match wiring + C9 modal | live L-V2/V3/V4/V9 |
| **L4** | Edit/delete flows: preview wiring (form/abstract/prev-next), single-entry download, trash ops (move/restore/permanently delete) + toasts with View Trash action | live L-V6/V7/V8 |
| **L5** | Strings (both i18n files, exact delta), `bib-library.css`, settings + nav link, README update | i18n test; lint 0; build green |
| **L6** | Full verification battery (§6) incl. live matrix L-V1…L-V12 + parity checklist vs §1 | all green; parity checklist signed |

**Ordering rationale:** backend first (API is the contract; page can
develop against it), shell before flows (states first), flows reuse
committed components (low risk), strings/css last (pure additive),
verification last.

---

## 9. Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | webpack entry auto-discovery for the module page | `modules/*/frontend/js/pages/**` glob verified (template-gallery precedent); `make all` + `entrypointStyles(entrypoint)` in layout-base |
| R2 | i18n missing-key raw text in UI | dual-file discipline + existing `i18n.test.mjs` gate + L-V11 DOM grep |
| R3 | `mongoose.model` double-registration under 2 workers / re-import | `mongoose.models['LibraryReference'] || mongoose.model(...)` guard (module imports once anyway) |
| R4 | per-worker in-memory state divergence | zero in-memory state: all reads/writes Mongo; retention purge idempotent per worker |
| R5 | CSRF on POST/PATCH/DELETE | reuse shared `fetch-json` (adds `X-CSRF-TOKEN` from meta) + verified on live matrix |
| R6 | duplicate-key semantics divergence from SaaS | SaaS ALLOWS dupes + warns (`bibtex_duplicates_keys`) → non-unique index; match endpoint drives pre-checks |
| R7 | `:has()` CSS in older browsers | progressive enhancement only (list shift); layout correct without it |
| R8 | build ~30 min + live cycle downtime | single rebuild at L2 (first page-visible step) and once more at L6; `cycle_overleafserver.sh` flow + health check before E2E |
| R9 | in-project component API creep (variant props) | default props reproduce current behavior exactly; existing module tests + in-project live check (L-V9 double-checks the project view) |
| R10 | stale `ol-refSyncState`/`refProviders` expectations | out of scope per D-C3; no client code reads them |

---

## 10. Open notes (observations, no action taken)

- Working tree shows **deletions** (unstaged) of `PHASE_B_PLAN.md`,
  `PHASE_C_PLAN.md`, `REDESIGN_PLAN.md`, and `services/web/modules/bib-editor/reference/capture/*` — they remain in git HEAD (`d5ff231e23` et al.). Plan here is self-contained (spec embedded in §1). If the deletion was accidental, `git restore` of `reference/capture/` is possible at any point.
- Phase C open items D9 (Add modal) is subsumed by L-add "Enter manually";
  D11 (error-tooltip click wiring, project list) stays a separate small
  ticket — can be folded into L5 if preferred.
