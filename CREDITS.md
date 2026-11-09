# Credits

Third-party code included in this fork (on top of ShareLaTeX/Overleaf CE,
itself licensed under GPL-3.0). Full license texts travel with the vendored
code; the entries below give the origin, license, and where it lives.

## TikZ editor (WYSIWYG `.tikz`/`.pgf` visual editor)

Shipped in `services/web/public/static/tikz-editor/` and driven by
`services/web/modules/tikz/`.

- **tikz-editor** — Dominik Peters
  <https://github.com/DominikPeters/tikz-editor> — **MIT**
  The WYSIWYG TikZ editor (v0.5.2), the application rendered inside the
  iframe.
- **tikz-editor-embed-mirror** — TeXlyre contributors
  <https://github.com/TeXlyre/tikz-editor-embed-mirror> — **MIT**
  The static, iframe-embeddable build (postMessage host protocol:
  `init` / `load` / `change` / `autosave` / `save` / `export` /
  `persistence-save`) installed from its v0.5.2 release.
- **TikzJax** — drgrice1 (`@drgrice1/tikzjax`, 1.0.0-beta24)
  <https://github.com/drgrice1/tikzjax> — **MIT**
  The browser TikZ rendering engine (vendored in
  `static/tikz-editor/tikzjax/`: `tikzjax.js`, `fonts.css`, glyph fonts),
  fully offline.
- **MathJax 4** — the MathJax Consortium
  <https://github.com/mathjax/MathJax> — **Apache-2.0**
  Offline TeX typesetting for editor content; the Cambria-Math font set
  (`static/mathjax-fonts/mathjax-newcm-font/`) and the
  `static/math-maps/` Unicode-to-TeX mappings come from the `mathjax`
  npm package (4.1.2).

License texts: `static/tikz-editor/LICENSE-MIT.txt` covers the tikz-editor
bundle; see the upstream repositories for the full MIT / Apache-2.0 texts.

## Draw.io (WYSIWYG `.drawio` diagram editor)

The diagram editor for `.drawio` files (module: `services/web/modules/drawio/`)
embeds a vendored draw.io application bundle:

| Component | Provenance | License |
|-----------|-----------|---------|
| draw.io core | [JGraph draw.io](https://github.com/jgraph/drawio), vendored from the official [viewer.diagrams.net](https://viewer.diagrams.net/) static build (v32.3.0) | MPL 2.0 (core) |
| jsPDF | [jsPDF](https://github.com/parallax/jsPDF) `^3.0.1` (npm — vector PDF conversion) | MIT |
| svg2pdf.js | [svg2pdf.js](https://github.com/yworks/svg2pdf.js) `^2.5.1` (npm — SVG→PDF operators) | Apache-2.0 |

Vendored at `services/web/public/static/drawio/` (20 MB) with its own
`PROVENANCE.txt`; served same-origin, offline, inside an isolated iframe
(same discipline as the tikz-editor bundle). The npm dependencies are
dynamically imported only by the file-tree "Convert to PDF/PNG" action so
they stay out of the main IDE bundle.

## Notes

- All of the above is vendored into the image and served same-origin;
  nothing is loaded from a CDN or any other origin at runtime.
- Host-side modifications to the vendored tikz-editor bundle (document
  lifecycle trimming, offline MathJax paths) are documented in
  `static/tikz-editor/HOST-PATCHES.md`; the patching instructions there
  must be re-applied after any re-vendoring.
- The file-tree **Export to PNG/SVG/PDF** feature generates its artifacts
  from the editor's rendered output with no additional third-party
  libraries (PNG via canvas, PDF via a small built-in writer).
