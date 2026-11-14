# clsi-typst

The **Typst** compile service — a sibling of [`services/clsi`](../clsi) (the TeX
compile service). It exposes the same wire API (compile, stop, output files,
`/sync/code`, `/sync/pdf`, wordcount, status) but swaps the engine layer for
Typst:

| TeX (services/clsi) | Typst (services/clsi-typst) |
|---|---|
| `latexmk` passes (`LatexRunner`) | `typst compile` single pass (`TypstRunner`) — the runner exits 0 even on diagnostics; success gate = `output.pdf` exists, `^error:` lines counted into `typst-errors` |
| `.synctex.gz` + `synctex` binary | D21 `output.sourcemap.json` sidecar from the typst fork (`TypstSourcemap`) — same `/sync/code` & `/sync/pdf` wire shape |
| `texcount` | wordometer injected doc + PDF marker read (`TypstWordcount`, pdfjs-dist), `wc -w` fallback — same `texcount` response key |
| TeX-specific managers (tikz, draft, png2pdf, content cache, xref) | no-op stubs |

## Compiler image

`Dockerfile` builds the typst fork (0.15.1-with-extras @ `d101c2f5`) with the
CLSI sourcemap-sidecar patch (`patches/0001-clsi-sourcemap.patch`, D21) as a
fully static musl binary, then adds it to the Node app stage at
`/usr/local/bin/typst` (the path the runner expects).

## Development

```sh
# from the repo root
yarn install
cd services/clsi-typst
yarn test:unit
yarn types:check

# run locally (needs `typst` on PATH for real compiles)
yarn node app.js     # listens on 127.0.0.1:3013
```

Smoke test (`/smoke_test_force`, `/health_check`) compiles a small `.typ`
document in-process.

## API (identical shape to clsi)

- `POST /project/:project_id[/user/:user_id]/compile` — body
  `{ compile: { rootResourcePath, syncType, options: { compiler: 'typst' }, resources } }`
- `POST .../compile/stop`
- `DELETE ...` (clear project)
- `GET .../sync/code?file=&line=&column=` → `{ pdf: [{page,h,v,width,height}] }`
- `GET .../sync/pdf?page=&h=&v=` → `{ code: [{file,line,column}] }`
- `GET|POST .../wordcount?file=` → `{ texcount: {...} }`
- `GET .../status`, `/health_check`, `/status`
