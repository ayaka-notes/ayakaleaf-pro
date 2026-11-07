# TikZ Editor (`modules/tikz`)

A built-in, offline WYSIWYG editor for **TikZ / PGF documents** in OlliTeX —
adopted 2026-09-29 (candidate B, owner-approved) from the TeXlyre
`tikz-editor-embed-mirror` v0.5.2 kit (MIT), which vendors the WYSIWYG
editor `DominikPeters/tikz-editor` (MIT, v0.5.2, tikz.dev/editor) as a
static iframe-friendly bundle.

Open a figure:

1. **New file → TikZ diagram** (or open any `*.tikz` / `*.pgf`).
2. The editor boots in **Visual** mode (draw nodes/edges on the canvas,
   two-way source sync, in-app export to SVG / PNG / PDF / LaTeX). Switch
   to **Code** at the editor toolbar to edit the raw TikZ source (mode
   remembered per file kind, same convention as the diagram module).
3. The document stays a normal project file — sync, diff and version
   history all apply (the source is written back into the CodeMirror-
   backed document on every editor change).

Everything ships inside our own image and works fully offline — no CDN,
no telemetry, no external origin.

## Implementation

- **Vendored app**: `public/static/tikz-editor/` (17 MB static build;
  `PROVENANCE.txt` + `LICENSE-MIT.txt` inside). Served same-origin at
  `/static/tikz-editor/index.html`, exactly like `public/static/svgedit/`.
- **Bridge**: JSON-string postMessage (the embed's documented protocol):
  `init` → `load {source, autosave, fileName}`; `change`/`autosave`/
  `save` → `source` (aliased `xml`) written into the CM document;
  `export` → `data|svg|source`; `persistence-save` → host localStorage
  (`ollitex:tikz-editor:storage`) re-applied via the `#storage=` hash on
  next boot. Reducer is pure (util/tikz-protocol) and unit-tested
  (test/unit/src/tikz-protocol.test.mjs).
- **Provider**: `visual-editor-provider.js` (claims `.tikz`/`.pgf`,
  registered in `services/web/config/settings.defaults.js`
  `overleafModuleImports.visualEditorProviders`).
- **New-file entry**: `create-tikz-file.tsx` (registered under
  `overleafModuleImports.createFileModes`).
- **i18n**: `tikz_*` keys in `locales/en.json` +
  `frontend/extracted-translations.json` (i18n-lint C1–C4 guarded).

## Upstream / license

- `DominikPeters/tikz-editor` — MIT — the WYSIWYG editor itself.
- `TeXlyre/tikz-editor-embed-mirror` — MIT, tag v0.5.2 — the static embed
  kit (iframe postMessage host API + reference host + protocol doc); this
  module follows its `host/host.js` reference behaviour.
- Both licenses are permissive (MIT); attribution kept in the vendored
  folder. No modifications were made to the vendored app.
