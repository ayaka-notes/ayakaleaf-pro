# ============================================================================
# tools/logo — logo/favicon asset generation (pure Go; no Inkscape,
# ImageMagick or Python needed).
#
# Builds and runs the generator INSIDE the repo's Go builder container
# (ollitex/golang-builder-amd64-alpine, Go 1.27.1 / alpine 3.24) — the same
# image the build-images build uses. Only docker is required; if a host Go
# toolchain is present its module/build caches are bind-mounted so
# `go mod download` and compilation are near-free.
#
# Targets:
#   make build    compile the static logo-generator binary in this dir
#   make assets   regenerate the icon set in this dir (deterministic)
#   make test     parity check: regenerate into a scratch dir in the
#                 container and byte-compare against the committed assets
#                 (the generator is deterministic — exact match expected);
#                 exit 0 = parity
#   make install  copy generated assets into public/ (repo-root) and
#                 frontend/js/shared/svgs/ — review before running
#   make clean    remove the built binary
# ============================================================================

GO_BUILDER_TAG ?= sharelatex/golang-builder-amd64-alpine:1.27.1
GO_BUILDER_DIR ?= .
DOCKER ?= docker

HOST_GO := $(shell command -v go 2>/dev/null)
ifneq ($(HOST_GO),)
	HOST_GOMODCACHE ?= $(shell go env GOMODCACHE 2>/dev/null)
	HOST_GOCACHE ?= $(shell go env GOCACHE 2>/dev/null)
	HOST_MOUNTS := -v $(HOST_GOMODCACHE):/gocache/mod -v $(HOST_GOCACHE):/gocache/build
endif

RUN_ARGS := --rm --platform linux/amd64 \
	-v $(CURDIR):/build/logo -w /build/logo \
	$(HOST_MOUNTS) \
	$(GO_BUILDER_TAG)

.PHONY: builder builder-rebuild build assets test install clean

# Ensure the builder image exists (built from the in-repo Dockerfile if the
# image is not already on this host).
builder:
	@image=$$($(DOCKER) image inspect $(GO_BUILDER_TAG) 2>/dev/null) ; \
	if [ -z "$$image" ]; then \
		echo "building $(GO_BUILDER_TAG) from $(GO_BUILDER_DIR)"; \
		$(DOCKER) build --progress=plain --tag $(GO_BUILDER_TAG) $(GO_BUILDER_DIR); \
	else \
		echo "builder image $(GO_BUILDER_TAG) present"; \
	fi

# Force a rebuild (e.g. after editing the Dockerfile)
builder-rebuild:
	$(DOCKER) build --no-cache --progress=plain --platform linux/amd64 \
		--tag $(GO_BUILDER_TAG) $(GO_BUILDER_DIR)

# Compile a static logo-generator binary into this directory.
build: builder
	$(DOCKER) run --network=host $(RUN_ARGS) \
		sh -c 'go mod download && go build -o logo-generator .'

# Regenerate the icon set (PNG/SVG/ICO + img/ol-brand) in this directory.
assets: build
	$(DOCKER) run $(RUN_ARGS) ./logo-generator

# Parity check script — runs INSIDE the builder container. Note: make
# expands $(...) itself, so the container shell variables use $$. No
# apostrophes may appear in this text (it is single-quoted for the host).
PARITY_FILES := favicon.svg logo_sw.svg mask-favicon.svg \
	favicon-compiled.svg favicon-compiling.svg favicon-error.svg \
	favicon.ico \
	img/ol-brand/overleaf-black.svg img/ol-brand/overleaf-white.svg \
	img/ol-brand/overleaf-o-grey.svg img/ol-brand/overleaf-o-white.svg \
	img/ol-brand/overleaf-o-dark.svg img/ol-brand/overleaf-o.svg img/ol-brand/overleaf.svg \
	img/ol-brand/overleaf-a-ds-solution-mallard.svg \
	img/ol-brand/overleaf-a-ds-solution-mallard-dark.svg \
	img/ol-brand/logo-horizontal.png img/ol-brand/overleaf_og_logo.png \
	android-chrome-192x192.png android-chrome-512x512.png \
	apple-touch-icon.png favicon-16x16.png favicon-32x32.png \
	overleaf_og_logo.png logo-horizontal.png

PARITY_SH := set -eu; \
	rm -rf /tmp/logo-gen; mkdir -p /tmp/logo-gen; \
	cp -r /build/logo/. /tmp/logo-gen/; cd /tmp/logo-gen; \
	/build/logo/logo-generator; \
	fail=0; \
	for f in $(PARITY_FILES); do \
	  if [ ! -f "/build/logo/$$f" ]; then echo "missing-base $$f"; continue; fi; \
	  if cmp -s "/tmp/logo-gen/$$f" "/build/logo/$$f"; then \
	    echo "identical    $$f"; \
	  else \
	    echo "DIFFERS      $$f"; fail=1; \
	  fi; \
	done; \
	if [ "$$fail" = 0 ]; then echo "LOGO PARITY: OK"; else echo "LOGO PARITY: FAILED"; fi; \
	exit $$fail

test: build
	$(DOCKER) run $(RUN_ARGS) sh -c '$(PARITY_SH)'

# Install the generated assets into the project (repo-root public/ + shared
# svgs). Review the output first (make test) — the committed public/ assets
# are the current final art.
install: assets
	sh -c 'set -eu; REPO_ROOT=../../..; mkdir -p "$$REPO_ROOT/public/img/ol-brand" "$$REPO_ROOT/frontend/js/shared/svgs"; cp -f *.png "$$REPO_ROOT/public/"; cp -f *.svg "$$REPO_ROOT/public/"; cp -f *.ico "$$REPO_ROOT/public/"; cp -f img/ol-brand/*.png "$$REPO_ROOT/public/img/ol-brand/"; cp -f img/ol-brand/*.svg "$$REPO_ROOT/public/img/ol-brand/"; cp -f img/ol-brand/overleaf.svg "$$REPO_ROOT/frontend/js/shared/svgs/"; cp -f img/ol-brand/overleaf-*.svg "$$REPO_ROOT/frontend/js/shared/svgs/"'

clean:
	rm -f logo-generator
