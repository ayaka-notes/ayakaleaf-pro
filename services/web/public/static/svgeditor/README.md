# Vendored SVG-Edit 7.4.2 asset set

This directory ships the **pre-built SVG-Edit 7.4.2 application as static
assets**, served by Overleaf at `/static/svgeditor/`. It is the build output
of the SVG-Edit source project (see
https://github.com/svg-edit/svg-edit, version 7.4.2), which this project
keeps in the local clone `/data_1/compare/special2/svgedit`.

- **License**: permissive OR-license, e.g. MIT — see `LICENSE`.
- **Offline guarantee**: every file needed at runtime (editor bundle,
  styles, icons, the extensions loaded by `embed.js`) is in this directory.
  Nothing here is fetched dynamically from an external origin in the
  embedded flow: `embed.js` loads a fixed extension list that excludes the
  file-save/storage extensions, prunes the browser file operations from the
  menu (and blocks their shortcuts), and the only known third-party URL
  reference (`pdfobject` inside `extensions/ext-opensave/`) is in a code
  path that is never reachable from the embedded UI.
- **Embedded host**: `embed.html` + `embed.css` + `embed.js` run the app
  inside a same-origin iframe and expose the bridge
  `window.__olSvgEmbed.{ready, load, getSvg, onChanged}` used by the
  `svgeditor` module (`services/web/modules/svgeditor/`).

Ported from `services/web/modules/diagram` +
`public/static/svgedit/` in the legacy `overleaf-cep` checkout (same
asset version, same embedded bridge, re-labelled for the `svgeditor`
module).
