# SVG Editor module (`svgeditor`)

Adds an **Edit SVG** action to the file view header for `.svg` files: the
file view shows an SVG preview, with **Download**, **Edit** buttons (same
header as the raster image views), and **Convert to PDF** / **Convert to
PNG** items in the file-tree right-click menu. **Edit** opens the SVG-Edit
editor in a full-space Overleaf modal; **Save** re-uploads the edited SVG
under the original file name (replacing the file) and refreshes the
preview to the new hash. Conversions create companion files (vector PDF
for `\includegraphics`, raster PNG) in the same folder as the source SVG.

Ported from the `diagram` module of the legacy `overleaf-cep` checkout
(same embedded SVG-Edit 7.4.2 + same-origin iframe bridge), re-structured
as a file view editor with the Overleaf-native modal chrome used by the
`toast-image` raster editor. Mantine is not used anywhere.

## Layout

```
modules/svgeditor/
├── index.mjs                          module registration (debug log)
├── frontend/js/
│   ├── components/
│   │   ├── svg-editor-button.tsx      file-view "Edit SVG" button (slot entry)
│   │   ├── svg-editor-modal.tsx       full-space modal: iframe, bridge, save, guard
│   │   ├── svg-editor.css             full-bleed modal + overlay styles
│   │   ├── svg-convert-menu-item.tsx  context menu "Convert to PDF/PNG" (slot entry)
│   │   └── svg-convert-toasts.tsx     success/error toasts (toastGenerators slot)
│   └── util/
│       ├── svg-editor-utils.ts        pure helpers (tested)
│       ├── svg-editor-save.ts         editor save/upload flow (tested)
│       └── svg-convert.ts             SVG→PDF/PNG + upload orchestration (tested)
├── test/unit/src/                     vitest unit tests
└── ../../public/static/svgeditor/     vendored SVG-Edit 7.4.2 assets + bridge
```

## How it works

- **Vendored editor**: `public/static/svgeditor/` ships the pre-built
  SVG-Edit 7.4.2 app (MIT/permissive OR-license, see its `LICENSE`),
  served by Overleaf at `/static/svgeditor/`. The embed page
  (`embed.html` + `embed.js`) runs it inside a **same-origin iframe** and
  exposes the bridge `window.__olSvgEmbed.{ready, load, getSvg,
  onChanged}`. All assets are in the image: **nothing is fetched from an
  external origin at runtime** (the storage/file-save extensions are not
  loaded, the browser file operations are pruned from the menu and their
  shortcuts blocked; the one known third-party URL reference — `pdfobject`
  inside `extensions/ext-opensave/` — is in a code path unreachable from
  the embedded UI).
- **Modal chrome**: OLModal stretched to the whole available space
  (`svg-editor.css`), with an Overleaf header owning **Save** + close (X).
  The editor keeps its own toolbars inside the iframe.
- **Save flow**: `getSvg()` serialises the canvas; the text is uploaded as
  `image/svg+xml` under the **original file name** into the same folder
  (`/project/:id/upload`), then (as with the raster editor) the modal
  closes FIRST and a detached verify-and-reassert loop (≤ 10 × 1 s)
  refreshes the file view to the new hash — the real-time delete event
  unmounts the pane mid-save, so the refresh cannot be component-bound.
- **Unsaved-changes guard**: closing (X / Escape / backdrop) while the
  canvas differs from the loaded baseline (whitespace-normalised
  comparison) shows a Keep editing / Discard and close card.
- **Mount backstop**: if the bridge is not ready within 30 s the error
  panel offers Retry (iframe remount) and Open original.

## Converting SVG → PDF / PNG (file-tree context menu)

Plain SVG cannot be `\includegraphics`-ed by pdfLaTeX, so right-clicking a
`.svg` file in the file tree offers **Convert to PDF** and **Convert to
 PNG** (rendered by `svg-convert-menu-item.tsx` via the
`fileTreeContextMenuItems` slot):

- **PDF** stays **vector**: the SVG DOM is translated to PDF operators with
  `svg2pdf.js` 2.8.x into a jsPDF 3.x page sized to the SVG
  (explicit width/height, else viewBox aspect, else 1200 px). Verified:
  output contains path operators and no `/Image` XObjects, so
  `\includegraphics{figure.pdf}` renders crisp at any zoom.
- **PNG** rasterises the SVG through `<img>` + `<canvas>` at the SVG's
  pixel size (same object-URL trick as the file-view preview).
- The browser does the conversion (no new server surface); the blob is
  uploaded with the standard `/project/:id/upload` endpoint into the
  **same folder** as the source: `logo.svg` → `logo.pdf` / `logo.png`
  (names already taken get `-1`, `-2`, …). Success/error toasts
  (`toastGenerators` slot) confirm the created file or show the error
  detail.
- `jspdf` + `svg2pdf.js` are code-split (lazy webpack chunk), keeping the
  main IDE bundle unchanged.

## Integration points (this app)

- `config/settings.defaults.js`: `fileViewButtons` +
  `fileTreeContextMenuItems` + `toastGenerators` slot entries, and
  `moduleImportSequence` (`svgeditor`).
- `frontend/js/features/file-view/components/file-view-header.tsx`:
  renders the slot buttons next to Download.
- `frontend/js/features/file-tree/components/file-tree-item/file-tree-item-menu-items.tsx`:
  renders the `fileTreeContextMenuItems` slot entries right after
  Download (each entry component returns null unless it handles the
  selected file).
- `frontend/js/features/file-view/components/file-view.tsx` previews `.svg`
  through `FileViewSvg`: the project blob endpoint serves blobs as
  `application/octet-stream` (raster previews rely on browser sniffing),
  which browsers reject for SVG in `<img>` — so the SVG is fetched as text
  and rendered via a same-origin object URL with an explicit
  `image/svg+xml` type (still an `<img>` embed: no script execution).
- Locale strings in `locales/en.json` / `frontend/extracted-translations.json`.

## Tests

- `yarn vitest run modules/svgeditor` — save flow + conversion helpers
  (naming collisions, size computation, convert-and-upload orchestration
  with injected fetch/convert).
- `yarn webpack:production` — bundles the module components (0 errors);
  `jspdf`/`svg2pdf.js` land in their own lazy chunk.
- Live browser E2E (Playwright, against the Overleaf test server):
  preview + Edit + modify + Save (hash change) + unsaved guard + zero
  external requests; context menu conversion — PDF/PNG appear in the tree,
  success toasts, `%PDF-`/PNG magic bytes on the downloaded files, vector
  PDF (no image XObjects).

## Not in scope (possible follow-ups)

- The legacy module's editor-pane "visual editor" mode for `.svg`
  documents (replacing the code editor) — this module is the file view
  editor only.
