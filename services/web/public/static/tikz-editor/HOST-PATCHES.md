# Host-side patches (Overleaf integration, 2026-11-07)

The vendored app is otherwise UNMODIFIED (see PROVENANCE/README). These
host-side patches adapt it to Overleaf's data-storage model, where the
Overleaf project file (.tikz) is the ONLY document store and the
document lifecycle (create/open/close/save) is owned by Overleaf —
not by the embed.

## 1. File menu: remove local-document-lifecycle items

File: `assets/index-B0WjW5Xi.js` (the app's main bundle chunk)

Removed menu items (they manage a local file/tab lifecycle that does
not exist in our integration — Overleaf owns the document, and
content syncs to the project file automatically):

- New (file.new-document) — "new document" inside the embed
- Open... (file.open-document) — local file picker
- Save / Save As... (file.save-document[-as]) — local file save
- Close Tab / Close All Tabs (file.close-document / file.close-all-documents)

Removed by deleting these exact substrings from the File-menu items
array (`I_=[{id:"file",...`):

    {kind:"command",commandId:G.NEW_DOCUMENT,label:"New",accelerator:"CmdOrCtrl+N"},
    {kind:"command",commandId:G.OPEN_DOCUMENT,label:"Open..."},
    {kind:"command",commandId:G.SAVE_DOCUMENT,label:"Save",accelerator:"CmdOrCtrl+S"},
    {kind:"command",commandId:G.SAVE_DOCUMENT_AS,label:"Save As..."},
    {kind:"separator"},
    {kind:"command",commandId:G.CLOSE_DOCUMENT,label:"Close Tab",accelerator:"CmdOrCtrl+W"},
    {kind:"command",commandId:G.CLOSE_ALL_DOCUMENTS,label:"Close All Tabs"},

and disabled the matching command-map entries (this also kills the
in-embed Ctrl+N / Ctrl+S / Ctrl+W shortcuts):

    [G.NEW_DOCUMENT]:{enabled:!0,...      -> enabled:!1
    [G.OPEN_DOCUMENT]:{enabled:fe,...     -> enabled:!1
    [G.SAVE_DOCUMENT]:{enabled:he,...     -> enabled:!1
    [G.CLOSE_DOCUMENT]:{enabled:EXPR,...  -> enabled:!1
    [G.CLOSE_ALL_DOCUMENTS]:{enabled:EXPR,... -> enabled:!1

### 1b. Document-tab-strip buttons (same commit, same rationale)

The tab strip's "+" (new document) and × (close) buttons dispatch the
NEW_DOCUMENT / CLOSE_DOCUMENT state actions DIRECTLY (they do not go
through the command map), so they were disabled separately:

    tab-new button:  className:Mo.add,onClick:()=>{r({type:"NEW_DOCUMENT"})}
      -> className:Mo.add,disabled:!0,onClick:()=>{}
    tab close button: className:Mo.close,...onClick:()=>{...CLOSE_DOCUMENT...}
      -> className:Mo.close,disabled:!0,...,onClick:()=>{}

Buttons render greyed (disabled) — visible affordance that the
document lifecycle is owned by Overleaf.

Kept (compatible with project storage): Open Example..., Import
(Ipe/PowerPoint/SVG — loads content into the current document), Export
(SVG/Standalone LaTeX/PDF/PNG downloads, Copy as SVG), Show Compiled
Picture..., Settings...

Resulting web File menu:
    Open Example...
    ──────
    Import ▸ (Ipe / PowerPoint / SVG)
    Export ▸ (SVG / Standalone LaTeX / PDF / PNG)
    Copy as SVG
    ──────
    Show Compiled Picture...
    ──────
    Settings...

## Re-applying after a re-vendor

If `public/static/tikz-editor/` is ever re-vendored from a new
tikz-editor build, re-apply the string replacements above (the minified
identifiers like `G` or the enabled-expression values may change —
match on the stable `commandId:G.<NAME>,label:"..."` menu strings and
the `[G.<NAME>]:{enabled:` command-map prefixes). Verify with:

    node -e 'require("acorn").parse(fs.readFileSync("assets/index-B0WjW5Xi.js","utf8"),{ecmaVersion:2024,sourceType:"module"})'
