# Logo Tools

Generates the logo and favicon assets used by the project from two source
files:

- `logo.svg`: short logo
- `logo_full.svg`: wide logo

## Requirements

- Docker, plus the repo's Go builder image
  `sharelatex/golang-builder-amd64-alpine:1.27.1` 
- Rasterization uses the pure-Go packages `oksvg` and `rasterx`. There are
  **no external conversion tools** — no Inkscape, ImageMagick, Python, or a
  host Go installation needed (this replaced the previous
  `python3 + inkscape + imagemagick` pipeline).

## Generate Assets

```sh
make assets     # = build static logo-generator binary in the builder
                # container, then run it here (deterministic output)
make test       # parity check vs the committed assets (must be exit 0)
make build      # just compile the binary (logo-generator)
make clean      # remove the binary
```

The generator creates (in `tools/logo/`):

- PNG icons: Android (192/512), Apple Touch (180), favicons (16/32),
  Open Graph logo, wide logo
- `favicon.ico`
- Favicon status variants (build status): `favicon-compiled.svg`,
  `favicon-compiling.svg`, `favicon-error.svg`
- Colour variants: black / white / grey / dark, plus `logo_sw.svg`
- Wide and standard brand logos under `img/ol-brand/`

The generated files under `tools/logo/` (PNG/SVG/ICO/`img/`) are
**committed** in this repo — the docker images bake them in via `public/`.

## Install Assets

```sh
make install    # copies generated assets into public/ (repo-root) and
                # frontend/js/shared/svgs/
```

Review the generated output before installing — the committed `public/`
assets are the current final art; `make install` overwrites them with
freshly rasterized copies. `make test` proves the rasterizer reproduces
the committed set (SVG variants byte-identical, PNG dimensions equal).

## Source art

The source SVGs themselves are owned by `BRANDING.md`; this tool only
derives the icon/variant set.
