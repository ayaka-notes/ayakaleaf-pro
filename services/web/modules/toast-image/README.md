# Toast Image editor module

Adds an **"Edit Image"** button to the file view header for raster images
(png/jpg/jpeg/gif). Clicking it opens a full-screen image editor modal —
powered by [Filerobot Image Editor](https://github.com/scaleflex/filerobot-image-editor)
(FIE, `react-filerobot-image-editor` **4.9.1**, Konva-based) — with tabs for
crop/rotate/flip (Adjust), brightness/contrast/HSL/warmth (Finetune),
blur/threshold/posterize/pixelate/noise (Filters), text/pen/shapes/image
objects (Annotate), watermark, and resize. Saving goes through FIE's own
save dialog (name/format/quality/resize); the module uploads the exported
image through the standard project upload endpoint **under the original
file name** (replacing the file), and the file view is refreshed through the
standard file-tree selection path — so the preview shows the new bytes.

## Engine choice: FIE 4.9.1 (not tui-image-editor)

This module originally wrapped TUI Image Editor 3.15.3, whose project
(`nhn/tui.image-editor`) is **archived** (final release April 2022, 289 open
issues, no successor). Filerobot Image Editor replaces it:

- **actively maintained** (Scaleflex — the Tiptap company; npm releases into
  2026, `5.0.0` beta line in development), MIT license;
- **reimplementation on Konva** (pure canvas 2D, actively maintained), not a
  TUI wrapper — zero Fabric/2022-era code enters the bundle;
- **feature superset** for this use case (resize, watermark, crop presets,
  zoom); the only TUI capability it lacks is the mask/lasso tool;
- **natively implements** unsaved-changes tracking (`onModify`,
  `haveNotSavedChanges`) and can wait on our async `onSave` promise.

**Version pinning:** `react-filerobot-image-editor` is pinned to **exactly
4.9.1** (no caret) in `services/web/package.json`. The 5.x line requires
**React ≥19**; this project runs React 18.3.1, so 4.9.1 (peer `react >=17`)
is the compatible line. Extra peers declared by the web workspace:
`react-konva` (React 18 generation) and `styled-components` (v5 generation,
as `@scaleflex/ui` targets it).

**Yarn PnP plumbing (build-time):** FIE's dependency tree ships with
phantom/undeclared peers that PnP's no-hoisting rule rejects, so the web
workspace additionally declares `konva` and `react-is` directly, and the
root `.yarnrc.yml` `packageExtensions` adds the missing `@babel/runtime`
and `tippy.js` dependencies to `@scaleflex/ui` / `@scaleflex/icons` (the
same pattern as the existing `bootstrap` extension). Without that,
`yarn webpack:production` fails with ~2k "Required package" errors.

## Overleaf-native chrome

The OL page style is preserved: the editor is hosted in an OLModal (backdrop,
focus trap, dialog semantics) stretched to the **whole available space** —
there is intentionally **no OL header and no OL footer** (user requirement).
FIE's own topbar owns title-less close (X) and Save, which is the correct
place for them in an image editor. OLButton / OLNotification are still used
for the failure and guard surfaces — no third-party app shell, **no
Mantine**.

### Unsaved-changes guard (two paths, one behaviour each)

- **FIE topbar close (X):** FIE 4.9.1 natively shows its own "Discard
  changes?" confirmation (Cancel / Confirm) when the session has unapplied
  edits, and only calls our `onClose` after the user confirms (immediately
  when nothing would be lost). We trust that guard and close directly —
  re-confirming would ask the user twice. (FIE's confirm modal is a **portal
  to `document.body`**, not inside our modal.)
- **Escape / backdrop:** FIE does not guard these, so the module shows its
  own center guard card (`.toast-image-guard`, Keep editing / Discard). A
  document-level capture keydown handler owns this path deterministically
  (React-bootstrap only sees Escape when focus is inside the modal), but it
  always defers to FIE while FIE's own dialog is open, so FIE's in-editor
  Escape semantics (its modals, the text tool) are never hijacked. A close
  while a save is in flight is ignored in both paths.

## Offline guarantee (build-time only downloads)

- FIE + Konva + styled-components + icons are plain npm packages, resolved
  by `yarn install` at **image build time**; webpack code-splits FIE into a
  lazy chunk loaded on first "Edit Image" click. Nothing is fetched from a
  third party at page load.
- **Critical flag:** FIE ships with **`useBackendTranslations: true` by
  default** — on mount it XHRs `https://i18n-fastly.ultrafast.io/api/export`
  and reports missing translation keys to `https://neo.wordplex.io`
  (vendor telemetry). This module passes **`useBackendTranslations: false`**,
  so NO such request is made; FIE's bundled English strings are used.
  `useCloudimage` is explicitly `false` as well.
- The project image itself loads from our own server
  (`/project/:id/blob/:hash`), same origin — no cross-origin canvas tainting.
- Verified live: a network-monitored E2E session (open → edit → save) shows
  **zero** requests to ultrafast.io, wordplex.io, or any non-OL host.

## Behaviour notes / fixes shipped with this port

- Deterministic editor mount: FIE is rendered only after the modal container
  has a non-zero size (no zero-height canvas), plus a **mount-aware** 30 s
  backstop: a watchdog cancels as soon as the FIE app is observed rendered
  in the host (`looksLikeEditorMounted`), so a healthy long-lived session is
  never killed — but an init that truly hangs still surfaces the failure
  panel (Retry + "open the original image"). (The first port shipped an
  unconditional 30 s timer that died healthy sessions; fixed + regression-
  tested.)
- Unsaved-changes guard as above: FIE's `onModify` marks the session dirty
  (real editor signals, not event-name spelunking); closing with unapplied
  edits asks for confirmation exactly once on each path. Save only counts as
  clean after the upload succeeds.
- Verified save flow: FIE's `onSave` returns the Promise of our upload
  (FIE keeps its "saving" state until it settles); `response.ok` checks on
  the data-URL read and the upload, with user-visible error messages; a
  failed save leaves the editor open for retry.
- `savingPixelRatio: 1` — FIE's default is **4** (export at 4× the original
  dimensions); pinning 1 keeps the export at native size and avoids memory
  blow-ups on large images.
- **Post-save refresh (hard-won):** replacing the file makes the real-time
  delete event unmount the file-view pane — and with it this module's modal —
  while our upload response is still in flight, so refresh code bound to the
  component dies with it. The module therefore closes the modal *first*, then
  runs a detached verify-and-reassert loop (≤10 s) that (a) resolves the new
  file via the app's canonical `openFileWithId` + `setView('file')` and
  (b) emulates the exact human action (file-tree row click on the row's
  `<li role="treeitem" aria-label="<name>"`), each iteration verifying the
  preview actually shows the NEW hash before stopping.
- GIF is editable too (the file view already previews it); the export
  container follows FIE's save dialog (default: keep png for png, jpeg for
  jpg/jpeg/gif).

## Testing

- `yarn test:unit` (vitest): `modules/toast-image/test/unit/src/*`
  (upload/save helper + file-tree helpers + `looksLikeEditorMounted` remain
  engine-agnostic) — 18 tests.
- Live E2E (Playwright against the test container): **19/19** checks — button
  render, FIE mount (6 tabs), real edit, unsaved-changes guards (FIE close X
  + Escape path, each dismissed without losing the editor), FIE save dialog
  → confirm, upload POST to the standard endpoint, **preview hash changes to
  the new bytes**, and no requests to TUI/FIE vendor hosts.
- **Deploy note (learned the hard way):** OL's `/ide` page resolves bundles
  from a manifest cached in the **web process memory** — after syncing new
  `public/` build output you must restart the web service (or container)
  before the new chunks are served. And `docker cp public container:/path/to/public`
  copies *into* an existing dir (nested `public/public`); use `docker cp
  public/. container:/path/to/public/` to sync contents.
