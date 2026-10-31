# drawio — draw.io diagram editor for Overleaf

Adds a canvas editor/preview for `.drawio` (draw.io / diagrams.net) documents:

- **"New file → Diagram (draw.io)"** creates a fresh `.drawio` document and opens
  it directly in the canvas editor (registered via the `createFileModes` slot).
- **Opening any `.drawio` file** claims the *Visual* side of the Code|Visual
  editor switch: the editor pane shows the draw.io canvas; *Code* shows the raw
  XML (registered via the `visualEditorProviders` slot — the same house pattern
  as other visual-editor providers).

## How it works

- `visual-editor-provider.js` — the provider: claims `*.drawio`, exposes
  `getVisualEditorComponent()` → `DrawioViewer`, `id` = `drawio`,
  `defaultVisual = true` (canvas first; last-used mode persisted under
  `editor.lastUsedMode.drawio`).
- `components/drawio-viewer.tsx` — hosts the draw.io app in a **same-origin
  iframe** at `/static/drawio/index.html` and keeps the Overleaf document
  (CodeMirror state) as the single source of truth:
  - host → app: pushes the diagram's MODEL XML via
    `location.hash = "#R" + Graph.compress(modelXml)` (the hash protocol
    carries the `mxGraphModel`, draw.io's canonical share form; compressed
    document bodies are pushed as their payload)
  - app → host: polls the app's hash; on a diagram change, decodes it with the
    app's own `Graph.decompress` (uses the app's pako, so the round-trip is exact)
    and writes the XML back to the OpenDocument (wrapped as a classic inline
    `.drawio` document, `buildDrawioFile`).
  - boot: an **empty** (pre-)created file is seeded with the canonical blank
    diagram (`DEFAULT_DRAWIO_XML`) — both into the document (Overleaf
    autosave persists it) and into the app — so the editor always has a valid
    diagram to show and save. Boot only reports ready AFTER a successful
    hand-off (previously the status could stick on "Loading draw.io…").
  - scaling: a `ResizeObserver` on the iframe forwards resizes to the app
    window so the canvas follows the Overleaf editor pane.
  - constraints: `util/drawio-app.ts` strips the standalone-app surfaces out
    of the embedded editor (see below).
- `util/drawio-protocol.ts` — pure parse/build helpers for the `.drawio`
  document shape (classic inline `<mxGraphModel>` body and the newer compressed
  `<diagram>` body are both understood; `buildDrawioFile` writes the classic
  inline shape).
- `util/drawio-app.ts` — the host-constraint layer for the vendored app:
  share button, multi-page tab bar and the "Unsaved changes" alert are
  removed (the alert is replaced by the autosave status), the file-management
  File-menu rows are blocked, and Save is re-routed to the sync flush
  (pure label helpers are unit-tested).
- `components/create-drawio-file.tsx` — the "New file" pane (guarantees the
  `.drawio` extension, opens the new doc; the blank-diagram seed happens in
  the viewer boot — the create API has no content field).
- `components/drawio-viewer.css` — viewer pane layout.

## Save policy and host constraints (owner requirement 2026-10-13)

"New, Open from, Open Recent, Save As, Share, Rename, Make Copy are
contradicting that this is an editor for the file that this was opened for.
These need to go. Save is only allowed to save into the overleaf file tree
with the pre-created file."

- **Autosave is the save.** Every canvas edit is pulled into the Overleaf
  document within the poll interval; the normal Overleaf document autosave
  persists it into the file tree. There is no other save target — the app's
  own save dialog, "Open/Save as", share link, device downloads, libraries
  and external providers are removed:
  - URL params (verified against the vendored bundle): `noSaveBtn=1`,
    `noExitBtn=1`, `saveAndExit=0` drop the primary button and the related
    menu entries;
  - `util/drawio-app.ts` removes the Share button and multi-page tab bar,
    rewrites the "Unsaved changes. Click here to save." alert into the
    autosave status, strips the blocked File-menu rows from rendered menus,
    and intercepts their clicks/shortcuts in the capture phase.
- **File \u003e Save and Ctrl/Cmd+S** are intercepted in the capture phase and
  flush the sync immediately (app state → document → Overleaf autosave);
  the status line reports `drawio_saved`. They can no longer open the app's
  own save dialog.
- **Multi-page is out** (single page only): the page tab bar is hidden — a
  `.drawio` here converts to exactly one PDF/PNG/SVG, and pages would
  silently drop content.
- **Embed / Publish / Libraries** don't work with Overleaf's file storage in
  this deployment (they target the draw.io cloud / device / browser files),
  so they are blocked from the File menu as well.

## Offline / no runtime downloads (important)

The draw.io application bundle is **vendored in the repo and copied into the
image at build time** — the app never fetches anything external at runtime:

- Bundle: `services/web/public/static/drawio/` (see `PROVENANCE.txt` there:
  upstream `jgraph/drawio`, mirror `viewer.diagrams.net`, MPL 2.0 core).
- The image build copies it in: `server-ce/Dockerfile` →
  `COPY --parents libraries/ services/ tools/migrations/ /overleaf/` (line 32).
- Served same-origin at `/static/drawio/...` (same static path family as the
  tracked `public/static/brochures/...` assets).

## Files

```
modules/drawio/frontend/js/visual-editor-provider.js      provider (slot entry)
modules/drawio/frontend/js/components/drawio-viewer.tsx   iframe host + sync engine
modules/drawio/frontend/js/components/drawio-viewer.css   viewer styles
modules/drawio/frontend/js/components/create-drawio-file.tsx  "New file" pane
modules/drawio/frontend/js/util/drawio-protocol.ts        parse/build helpers
```

Wiring (`services/web/config/settings.defaults.js`):
`overleafModuleImports.visualEditorProviders` → `visual-editor-provider`;
`overleafModuleImports.createFileModes` → `create-drawio-file`.
Locale strings: `services/web/locales/en.json` (`drawio_*` keys).

Ported from the working Overleaf deployment at
`/data_1/image_mining/the_diff/overleaf` (modules/drawio, AK-11 work), whose
`drawio-roundtrip` e2e test exercised the same code.

## Converting `.drawio` → PDF / PNG (file-tree context menu)

`.drawio` files cannot be `\includegraphics`-ed by pdfLaTeX (and cannot be
previewed), so right-clicking a `.drawio` file in the file tree offers
**Convert to PDF** and **Convert to PNG** (the items are rendered by
`frontend/js/components/drawio-convert-menu-item.tsx` through the
`fileTreeContextMenuItems` slot, which `file-tree-item-menu-items.tsx`
consumes):

- **PDF** stays **vector**: the rendered SVG is translated to PDF operators
  with `svg2pdf.js` 2.8.x into a jsPDF 3.x page sized to the diagram;
  `\includegraphics{diagram.pdf}` therefore renders crisp at any zoom.
- **PNG** rasterises the SVG through `<img>` + `<canvas>` at 2× device
  pixels.
- The conversion runs **entirely client-side** (no new server surface):
  - the `.drawio` text is fetched from the file's blob URL;
  - a hidden same-origin iframe of the vendored draw.io app
    (`/static/drawio/index.html`) decodes the model (plain `mxGraphModel`
    XML or compressed `#R…`) through the app's own `Graph`/`mxGraph`/
    `mxCodec` APIs and renders it via `getSvg` into an SVG document —
    no dynamic downloads, fully offline;
  - the SVG is converted to the target format;
  - the result is uploaded into the **same folder** as the source file via
    the standard `/project/:id/upload` endpoint, under a derived name
    (`diagram.pdf` / `diagram.png`, with `-1`, `-2`, … on collisions).

Success/error is reported with the global toast infrastructure
(`toastGenerators` slot, `frontend/js/components/drawio-convert-toasts.tsx`).

Dependencies: `jspdf` and `svg2pdf.js` (added to `services/web/package.json`
+ the root `yarn.lock`). `svg2pdf.js` is imported dynamically so it stays
out of the main IDE bundle.

## i18n keys

`drawio_title`, `drawio_status_loading`, `drawio_status_ready`,
`drawio_saved`, `drawio_error_boot`, `drawio_new_file` (viewer + new file),
plus the
conversion UI: `convert_to_pdf`, `convert_to_png`, `drawio_convert_done`,
`drawio_convert_failed` (reusing the existing `conversion_error_details`).
All of them are present in `services/web/locales/en.json` and in
`services/web/frontend/extracted-translations.json` (see
`test/unit/src/drawio-i18n.test.mjs`).

## Tests

`test/unit/src/` (picked up by the standard `test:unit:all` glob
`modules/*/test/unit/src`):

- `drawio-convert.test.mjs` — pure conversion/name/upload logic with
  injected fetch/renderer/converter (Node-friendly, no DOM needed).
- `drawio-app.test.mjs` — host-constraint label logic: the owner's file-
  management blocklist is blocked, `Save` is NOT (it is re-routed to the
  sync flush), ellipsis/whitespace normalization.
- `drawio-i18n.test.mjs` — asserts every module key exists in both the
  English catalog and the extracted-translations manifest.
