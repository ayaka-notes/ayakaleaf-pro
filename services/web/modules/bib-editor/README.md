# bib-editor

BibTeX tooling for Overleaf CE, in two parts:

1. **In-project visual editor** — on a `.bib` file the user can toggle
   Code ↔ Visual, browse entries as cards, and add / edit / delete BibTeX
   entries in a form. The Code and Visual modes always represent the
   **same underlying `.bib` file** — the file is the single source of truth.
2. **Library** (`LIBRARY_PLAN.md`) — a per-user reference library on its own
   page (`/library`, `/library/trashed`) with add flows (Paste BibTeX/DOIs,
   Upload .bib, Enter manually), edit, delete-to-trash (30-day retention),
   restore, download, search, and the in-project "Import from Library"
   (C9, the one deliberate reference deviation). Backed by a Mongo
   collection (no per-process state). Gated by `OVERLEAF_BIB_LIBRARY`
   (default ON).

Registered in `services/web/config/settings.defaults.js` (additive):
`sourceEditorExtensions`, `rootContextProviders`, `visualEditorProviders`,
`moduleImportSequence`, plus `nav.header_extras` (the top-nav **Library**
link) and `Settings.bibLibrary` (module `index.mjs` defaults).

## Library (per-user reference library)

**Pages** (module `index.mjs` registers `LibraryRoutes`):

| Route | Render |
|---|---|
| `GET /library` | `library/library` view → entry `modules/bib-editor/pages/library` (auto-entry glob) → `frontend/js/library/*` |
| `GET /library/trashed` | same entry, `ol-libraryView=trash` meta (client view switch re-loads via the API) |

**REST API** (all session-scoped; SaaS shapes, D-C1):

| Method & path | Purpose |
|---|---|
| `GET /library/references?search&trashed&cursor&limit` | list `{items, nextCursor}` |
| `POST /library/references {entries}` | batch add (≤ 500) → `{items}` |
| `POST /library/references/match {entries}` | duplicate/occurrence check → `{matches}` |
| `PATCH /library/references/:key` | replace one entry |
| `POST /library/references/delete {ids|search, permanent}` | trash (default) or purge → `{deletedCount}` |
| `POST /library/references/restore {ids}` | restore → `{restoredCount}` |
| `GET /library/references/download?mode&search&ids` | `.bib` download (inclusion/exclusion) |
| `GET /library/references/count?search&trashed` | `{count}` |
| `GET /library/references/citation-key-suggestions?base&keys` | key suggestions |

**Storage**: `LibraryReference` — `{user_id, key, type, fields:[{name,value}],
occurrence, trashedAt, updatedAt, searchBlob}`. `{user_id, key}` is
**non-unique** — duplicate citation keys are allowed (SaaS parity) and
flagged in the list. Trash purge is lazy/idempotent (runs inside
`delete`/list paths after the retention window — no cron).

**Frontend**: `frontend/js/library/` — `library-api` (REST client),
`library-model` (API↔`BibEntry` mapping, suggestion merge, SaaS search fold,
duplicate detection), `library-context` (state + toasts), `library-page`
(SaaS anatomy), `library-manual-modal`, `library-root`; page entry
`frontend/js/pages/library.tsx`; styles `frontend/stylesheets/bib-library.css`
(component rules re-scoped from `bib-editor-panel.css` + Library chrome).
The shared in-project components (`bib-entry-list`, `bib-entry-form`,
`bib-entry-preview`, `bib-import-modal`) were extended with **optional**
library-variant props; in-project behavior is unchanged.

**C9 (Import from Library)**: the in-project Add-menu item (pre-L disabled
stub) now opens `bib-import-from-library.tsx` (search + conflict pre-
uncheck, same as the Paste preview) and dispatches through the SAME
guarded, all-or-nothing project import path — no new write machinery.

**Gating & dev**: `OVERLEAF_BIB_LIBRARY=false` disables the routes and the
nav link. `OVERLEAF_BIB_LIBRARY_TRASH_RETENTION_DAYS` (default 30).

**Known deviations** (documented in `LIBRARY_PLAN.md`): D-C1 field shape
`{name, value}`; D-C2 no `scope`; D-C3 no sync-provider badge; D-C4 top-nav
link instead of SaaS's ds-nav switcher; D-C5 client-side upload through the
paste pipeline; D-C6 lazy trash purge; D-C7 in-project file-is-truth
semantics unchanged. SaaS-only items (Zotero/Mendeley/Papers sync,
split-test badge, feedback link) are out of scope for CE.

---

## In-project visual editor

Visual BibTeX editor for `.bib` files, as described above. Registered
additively via `settings.defaults.js` (the registrations listed above;
the in-editor parts need no `index.mjs` change).

## Architecture: the file is truth

The React side is a **view over the live CodeMirror document**, never a
parallel state:

```
read path:  CM docChanged ─(300 ms debounce, parse)─► context.entries ─► UI
write path: form ─► flush ─► fresh parse of CURRENT doc ─► re-resolve range
            ─► view.dispatch {from, to, insert}
```

Design rules (the four **R-rules** below are the contract):

- **R1 (parse live)** — entries are re-derived from the current document text
  on every change; Code-mode edits appear in Visual automatically.
- **R2 (flush-on-leave)** — whenever the panel stops being relevant
  (Code toggle, Back, file switch, unmount), the open form is written back to
  the document. The write is a re-serialized diff re-resolved against a
  *fresh* parse (no cached offsets); it is rejected with a toast when the
  document is no longer the bibliography being edited. This replaces the old
  draft-persistence machinery, which is deleted (no `pendingAddDraft`, no
  `currentDraftRef`, no click interception on the Code/Visual toggle).
- **R3 (no second source)** — the form is the draft; nothing else is persisted.
- **R4 (external change while open)** — CodeMirror stays mounted (hidden) in
  Visual mode, so external edits re-derive `entries`; the selected entry is
  re-resolved by id, and if it vanished the panel backs out to the list.

### Write path (guard)

`extensions/bib-editor-extension.ts` listens to DOM events
(`BIB_WRITE_EVENT` / `BIB_DELETE_EVENT`) dispatched by the context. On each,
it re-parses the **live** document, verifies `expectedSource` still matches,
re-resolves the entry range by citation key (clamped/guarded), and dispatches
to CodeMirror. A rejected write emits `BIB_WRITE_FAILED_EVENT`; the provider
surface a banner instead of corrupting the buffer. After a successful write it
re-emits the parsed state, so the list/form rebinds without the debounce
delay.

### Components

| File | Role |
|---|---|
| `frontend/js/extensions/bib-editor-extension.ts` | CodeMirror ViewPlugin: parse-and-emit, guarded write/delete, scroll-to |
| `frontend/js/context/bib-editor-context.tsx` | Modes `list \| edit`; `selection: null \| {kind:'existing'} \| {kind:'new'}`; `writeEntry` / `deleteEntry` dispatch guarded events |
| `frontend/js/context/bib-editor-provider.tsx` | Bridges the extension's DOM events ↔ React context; write-failure banner |
| `frontend/js/components/bib-editor-panel.tsx` | Panel shell; R2 leave-watchers (showVisual prev-ref, openDoc, unmount); focus effects; delete confirm |
| `frontend/js/components/bib-entry-form.tsx` | One form for new + existing; Check (validate only / materialize for new); stars & OR-group messages; DOI upsert; key generation |
| `frontend/js/components/bib-entry-list.tsx` | Entry cards; inline search; ArrowUp/Down + Enter keyboard nav |
| `frontend/js/utils/bib-parser.ts` | BibTeX parser with byte offsets (+ `generateCitationKey`) |
| `frontend/js/utils/bib-types.ts` | Schema-driven pure field-visibility / star rules |
| `frontend/js/utils/bib-validate.ts` | Pure Check validation (required groups, key/year/DOI/URL formats) |
| `frontend/js/utils/bib-write.ts` | Pure write planner (fresh-source range + guards) |
| `frontend/js/utils/bibtex-schema.json` | Per-type field rules (incl. new `defaultOptionalFields` for the trimmed *new*-entry view) |
| `frontend/js/utils/doi-fetcher.ts` | CrossRef/doi.org metadata fetch (upsert into the form) |
| `frontend/stylesheets/bib-editor-panel.css` | Module-scoped `bib-*` styles |

### Entry form behavior (per reviewer requirements)

- **No Add/Edit distinction.** One form. `existing`: Check validates (no
  write — the write already happened on leave / on Check-for-new). `new`:
  Check materializes the entry into the file (append) *and* validates.
- **Stars / required groups:** a standalone required field shows a star while
  empty; every member of an OR-group (`author`/`editor`, `chapter`/`pages`)
  shows a star while *all* members are empty. Check messages: standalone →
  "X is required"; OR-group → "Either A or B is required" under each empty
  member.
- **No pseudo-fields:** OR-groups are flattened for display (never rendered as
  `authoreditor` rows), guarded by a permanent unit test.
- **Field visibility:** existing → required + optional + valued fields, plus
  `Show all fields`; new → required + a small `defaultOptionalFields` set.
- **Citation key:** hand-entered or auto-generated (author/year + collision
  suffix). A `new` form with nothing but the type materializes nothing.
- **DOI import:** fetches metadata from CrossRef/doi.org and *upserts* into
  the form (user-entered fields not returned by CrossRef are kept).

### i18n

Every `t('...')` literal is a bare string (the app interpolates `__var__`,
never `{{var}}`) and must exist in **both** `services/web/locales/en.json`
(English value) and `services/web/frontend/extracted-translations.json`
(`""` placeholder) — the webpack translations-loader only ships keys listed
in the extracted file, so a missing key renders as raw text in the UI. New
module keys are inserted at sort position in both files (additive-only).

## Testing

Module-local, standalone (mirrors the webdav/notification module convention):

```
cd services/web/modules/bib-editor
yarn install     # standalone node_modules (gitignored); does not touch the monorepo
yarn test        # vitest run
```

Suites (`test/unit/src/`): parser (offsets, round-trip, keyless/no-comma
keys, nested braces), write planner (fresh-range resolution, guards),
types/display rules (no joined pseudo-names), validation (star/group rules,
formats), and i18n sanity (every module literal exists in both shared JSONs;
`__var__` interpolation only).

Live-test matrix (needs a running Overleaf instance — run on the machine
with the container) is in `LIBRARY_PLAN.md` (§ verification matrix).

### Lint

The repo lint gate is ESLint (`services/web/eslint.config.mjs`, `yarn lint`
= whole `services/web` with `--max-warnings 0`). Scoped runs over this
module only (same engine/config):

```bash
cd services/web
../../node_modules/.bin/eslint --no-cache --max-warnings 0 \
  'modules/bib-editor/**/*.ts' 'modules/bib-editor/**/*.tsx' \
  'modules/bib-editor/**/*.mjs' 'modules/bib-editor/test/unit/src/*.test.mjs'
```

Notes:

- `.mjs` tests import `.ts` utils **with the extension** (repo `import/*`
rules); `bibtex-schema.json` is imported without one. Works in both vitest
runners (esbuild).
- The module `package.json` declares `react` / `react-i18next` /
  `@codemirror/*` as **peerDependencies** (provided by the web app) so
  `import/no-extraneous-dependencies` stays green — ESLint resolves that
  rule against the nearest `package.json`.
- `biome.jsonc` (module-local) is the config behind the fast Biome/LSP
  check for single-file diagnostics (Pi `lsp_diagnostics`). It runs
  **`biome lint` only** — never `biome check` (the formatter is not
  wired to repo style). Every rule off there is a documented repo
  convention, not a hole: ESLint remains the gate.

## Upstream-merge hygiene

All behavior lives in this module. The shared-file touches are additive:
the i18n keys in `services/web/locales/en.json` +
`frontend/extracted-translations.json`, the `settings.defaults.js`
registrations listed above, the module-scoped
`import/no-extraneous-dependencies` allowance in
`services/web/eslint.config.mjs` (because this module ships its own
`package.json` for vitest), and `patchJSON` in
`frontend/js/infrastructure/fetch-json.ts` (additive method). 
`bibtex-schema.json` keeps the upstream `optionalFields` / `allKnownFields`
lists intact; the new `defaultOptionalFields` key is additive, so upstream
schema merges stay clean.

Plans & decisions: `LIBRARY_PLAN.md` (the Library; the superseded Phase A–C
plans were intentionally retired by the user in favor of this one).

## Fork change history

### Round 5 (UI/UX fixes, this branch)

- **Single scrollbar on `/library`** — the row pane no longer doubles as
  the scroll container: `library-list-pane` is a layout flex column only,
  and the inner `BibEntryList` root (`.bibtex-entry-list`) is the sole
  scroller (was two nested `overflow: scroll` boxes).
- **"Updated …" chip layout** — moved out of the stacked details column
  into the card header (right-aligned, `flex: 0 0 auto`, `white-space:
  nowrap`, pill background) so the card no longer squeezes when the date
  is present.
- **Import-from-Library card shows the publication title** — new
  `.bibtex-import-preview-card-title` line (BibTeX `title` field) below
  the "Author et al. (year)" heading; the venue chip now omits the
  fallback type text (the type chip already renders it).
- **Modal combobox suggestion list pinned light** — CE modals are always
  light, so `[data-testid='bib-manual-modal']` / `bib-library-manual-modal`
  pin `.bib-add-field-listbox`/options to white + dark ink regardless of
  the page theme (themed page hosts keep their themed list).
- **Templates pages are theme-aware** (`/templates`, `/templates/{slug}`):
  - core `navbar.scss` — the `@include theme('default')` dark-navbar
    scope now also covers `#template-root` / `#template-gallery-root`
    (was `#project-list-root` / `#library-root` only, so the templates
    navbar stayed light).
  - core `templates-v2.scss` — fixed light-only inks (`--neutral-90/70`)
    on the gallery (title, h1/h2, sort buttons, no-results heading,
    caption title/description, author) use
    `--content-primary-themed` / `--content-secondary-themed`.

### Round 4 (UI/UX fixes, this branch)

- **Delete/trash now works from the Library list** — bulk selection is
  keyed by `entry.libId` (the Mongo `_id`, set in `apiToBibEntry` /
  `toRows` and propagated through the list props; `rowIdOf` falls back to
  the citation key only for rows without an id). Previously the
  selection carried citation keys while the delete/restore endpoints
  delete by `_id`, so the UI reported “0 references moved to trash”.
- **“Add optional field” suggestion list** — the combobox/listbox CSS
  (`.bib-add-field-*`, `.bib-combo-*`) is now in `bib-saas.css`, which
  **both** hosts load; before it only existed in `bib-library.css`, so the
  project Add modal rendered an unstyled suggestion list.
- **Library toolbar buttons** — Download and “+ Add” now use the Overleaf
  button family (`btn btn-secondary btn-sm` + `.button-content`) so icon
  alignment and colors match the in-project “+ Add” exactly (both render
  through the shared `DropdownToggle`).
- **Import-from-Library preview** — the card shows the **publication
  venue** (first non-empty of journaltitle / journal / booktitle /
  eventtitle / venue / school / institution) plus the type as a small
  chip (`.bib-publication-name`, `.bib-type-tag`).
- **Library preview panel layout** — the slide-out `:has(…) margin-right`
  shift no longer applies inside the flex side-panel layout (it opened an
  empty third column between list and panel on wide screens); list slot
  is now `list | panel` with no gap.

### Earlier rounds (context)

- Round 3: ds-nav chrome parity for /library (switcher logo, CE+ brand,
  account-menu admin block), modal token pinning (CE modals are always
  light — themed tokens pinned inside `data-testid` modal roots in
  `bib-editor-panel.css` + `bib-library.css`), counts pluralization,
  file-scoped Undo/Redo, responsive list/preview column layout.
- Deep-audit (across the fork): template-gallery `getTemplate` query-key
  whitelist, `template-details` undefined-URL-param fix, track-changes
  auth/validation/rate-limits (see sibling READMEs), admin-tools +
  admin page theming (see sibling READMEs).
