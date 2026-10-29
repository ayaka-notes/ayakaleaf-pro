# SVG Editor module (`svgeditor`)

Adds an **Edit SVG** action to the file view header for `.svg` files: the
file view shows an SVG preview with **Download** and **Edit** buttons (same
header as the raster image views). **Edit** opens the SVG-Edit editor in a
full-space Overleaf modal; **Save** re-uploads the edited SVG under the
original file name (replacing the file) and refreshes the preview to the
new hash.

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
│   │   └── svg-editor.css             full-bleed modal + overlay styles
│   └── util/
│       ├── svg-editor-utils.ts        pure helpers (tested)
│       └── svg-editor-save.ts         upload flow (tested)
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

## Integration points (this app)

- `config/settings.defaults.js`: `fileViewButtons` slot entry +
  `moduleImportSequence` (`svgeditor`).
- `frontend/js/features/file-view/components/file-view-header.tsx`:
  renders the slot buttons next to Download.
- `frontend/js/features/file-view/components/file-view.tsx` previews `.svg`
  through `FileViewSvg`: the project blob endpoint serves blobs as
  `application/octet-stream` (raster previews rely on browser sniffing),
  which browsers reject for SVG in `<img>` — so the SVG is fetched as text
  and rendered via a same-origin object URL with an explicit
  `image/svg+xml` type (still an `<img>` embed: no script execution).
- Locale strings in `locales/en.json` / `frontend/extracted-translations.json`.

## Tests

- `yarn test:unit` (services/web) — vitest picks up
  `modules/svgeditor/test/unit/src/*.test.mjs` (save flow + pure helpers).
- `yarn webpack:production` — bundles the module components (0 errors).
- Live browser E2E: preview + Edit + modify + Save (hash change) + unsaved
  guard + zero external requests, against the Overleaf test server
  (Playwright).

## Not in scope (possible follow-ups)

- Companion renderings (PNG/PDF) for `\includegraphics` — the legacy
  `diagram` module exported those as sibling files on save; this editor
  keeps the single-source SVG (the file is replaced in place).
- The legacy module's editor-pane "visual editor" mode for `.svg`
  documents (replacing the code editor) — this module is the file view
  editor only.
