# autoformatter

Formats the open LaTeX or BibTeX document in the browser. The idea and the
first version come from [davrot](https://github.com/davrot) (PR #141), after
[TeXlyre](https://github.com/TeXlyre/texlyre).

- `.tex`, `.sty` and `.cls` files are formatted with
  [tex-fmt](https://github.com/WGUNDERWOOD/tex-fmt), compiled to WebAssembly.
- `.bib` files are formatted with
  [bibtex-tidy](https://github.com/FlamingTempura/bibtex-tidy).

Nothing runs on the server, so no binary has to be installed in the image.

## Using it

Editors of the project (not viewers) can format a document from:

- the **Format document** button on the right of the editor toolbar,
- **Format → Format document** in the menu bar, or the command palette,
- the keyboard: **Shift+Alt+F** (**Shift+Option+F** on macOS), as in VS Code.

Formatting can be undone with Ctrl+Z / ⌘Z. With track changes on, it shows up
as tracked changes.

## How it works

- The formatter is loaded on first use (`tex_fmt_bg.wasm` is about 1.4 MB).
- Only the text that changes is replaced: the document and the formatted text
  are lined up on their non-whitespace characters, and only the gaps between
  them that differ are changed. Comments, tracked changes and the cursor stay
  where they are, and other users' edits are kept.
- tex-fmt runs with its default options (2-space indent) but without wrapping
  long lines, as LaTeX Workshop runs it in VS Code (`--nowrap`).
- bibtex-tidy runs with its defaults, except those that change entries rather
  than their layout: `escape`, `removeDuplicateFields` and `lowercase` are off.
  It is pinned to 1.14.0, as 1.15.x calls `Map.prototype.getOrInsert`, which
  browsers only have since early 2026 (Chrome 145, Firefox 144, Safari 26.2).

## Rebuilding tex-fmt

`frontend/js/tex-fmt/wasm/` holds tex-fmt built from its release tag with the
steps of its `wasm` justfile recipe. To rebuild it (for example for a new
release, set in `compile.sh`):

```sh
cd frontend/js/tex-fmt
./build.sh
```

## License

tex-fmt and bibtex-tidy are MIT licensed, see [LICENSE-tex-fmt](LICENSE-tex-fmt)
and [LICENSE-bibtex-tidy](LICENSE-bibtex-tidy).
