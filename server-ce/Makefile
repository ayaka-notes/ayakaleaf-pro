# Makefile

MONOREPO_ROOT := ../
HERE=$(shell pwd)
export MONOREPO_REVISION := $(shell git rev-parse HEAD)
export BRANCH_NAME ?= $(shell git rev-parse --abbrev-ref HEAD)
export BRANCH_NAME_TAG_SAFE ?= $(subst /,--,$(BRANCH_NAME))
export OVERLEAF_BASE_BRANCH ?= sharelatex/sharelatex-base:$(BRANCH_NAME_TAG_SAFE)
export OVERLEAF_BASE_LATEST ?= sharelatex/sharelatex-base
export OVERLEAF_BASE_TAG ?= sharelatex/sharelatex-base:$(BRANCH_NAME_TAG_SAFE)-$(MONOREPO_REVISION)
export OVERLEAF_BRANCH ?= sharelatex/sharelatex:$(BRANCH_NAME_TAG_SAFE)
export OVERLEAF_LATEST ?= sharelatex/sharelatex
export OVERLEAF_TAG ?= sharelatex/sharelatex:$(BRANCH_NAME_TAG_SAFE)-$(MONOREPO_REVISION)

all: build-base build-community

clean:
	-docker rmi --force $(OVERLEAF_BASE_TAG) $(OVERLEAF_TAG)

refresh-cache: refresh-cache-branch
refresh-cache-branch:
	docker inspect $(OVERLEAF_BASE_BRANCH) > /dev/null && docker pull $(OVERLEAF_BASE_BRANCH) || true
	docker inspect $(OVERLEAF_BRANCH) > /dev/null && docker pull $(OVERLEAF_BRANCH) || true
refresh-cache: refresh-cache-latest
refresh-cache-latest:
	docker inspect $(OVERLEAF_BASE_LATEST) > /dev/null && docker pull $(OVERLEAF_BASE_LATEST) || true
	docker inspect $(OVERLEAF_LATEST) > /dev/null && docker pull $(OVERLEAF_LATEST) || true

build-base:
	cp .dockerignore $(MONOREPO_ROOT)
	docker build \
	  --build-arg BUILDKIT_INLINE_CACHE=1 \
	  --progress=plain \
	  --file Dockerfile-base \
	  --pull \
	  --cache-from $(OVERLEAF_BASE_LATEST) \
	  --cache-from $(OVERLEAF_BASE_BRANCH) \
	  --tag $(OVERLEAF_BASE_TAG) \
	  --tag $(OVERLEAF_BASE_BRANCH) \
	  $(MONOREPO_ROOT)


build-community:
	cp .dockerignore $(MONOREPO_ROOT)
	docker build \
	  --build-arg BUILDKIT_INLINE_CACHE=1 \
	  --progress=plain \
	  --build-arg OVERLEAF_BASE_TAG \
	  --label "com.overleaf.ce.revision=$(MONOREPO_REVISION)" \
	  --cache-from $(OVERLEAF_LATEST) \
	  --cache-from $(OVERLEAF_BRANCH) \
	  --file Dockerfile \
	  --tag $(OVERLEAF_TAG) \
	  --tag $(OVERLEAF_BRANCH) \
	  $(MONOREPO_ROOT)

# --- Typst compiler (fork + CLSI sourcemap sidecar) -------------------------
# The typst compiler is NOT committed to the repo (the source tree + built
# binary are far too large to ship). It is fetched (git clone by SHA, TYPST_REF),
# patched (services/clsi-typst/patches/0001-clsi-sourcemap.patch — the D21
# sourcemap-sidecar extension) and compiled (cargo, static musl) inside the
# `typst-build` stage of ./Dockerfile at build time.
TYPST_REF ?= d101c2f507acd2e680a187735c5c201094e00077
TYPST_BUILD_IMG ?= sharelatex/typst-build:$(BRANCH_NAME_TAG_SAFE)-$(MONOREPO_REVISION)

# Build just the typst-build stage (download + patch + compile) in isolation —
# warms the BuildKit cargo cache and produces a reusable stage image. This is
# the "build / patch process" for the typst compiler.
typst-build:
	cp .dockerignore $(MONOREPO_ROOT)
	docker build \
	  --build-arg BUILDKIT_INLINE_CACHE=1 \
	  --progress=plain \
	  --build-arg TYPST_REF=$(TYPST_REF) \
	  --cache-from $(TYPST_BUILD_IMG) \
	  --target typst-build \
	  --tag $(TYPST_BUILD_IMG) \
	  --file Dockerfile \
	  $(MONOREPO_ROOT)
	@echo "Built typst-build stage: $(TYPST_BUILD_IMG)  (TYPST_REF=$(TYPST_REF))"

# Prove the built compiler is the patched fork: run it and confirm it emits the
# output.sourcemap.json sidecar (the D21 click-to-source extension) next to the
# compiled PDF.
typst-verify:
	docker run --rm $(TYPST_BUILD_IMG) sh -c ' \
	  B=/app/target/release/typst; \
	  "$$B" --version; \
	  cd /tmp && printf "= T\n\n#let x = 42\n\nThe value is #x.\n" > t.typ && \
	  "$$B" compile t.typ o.pdf && \
	  echo "--- output.pdf + sourcemap sidecar ---" && \
	  ls -la o.pdf output.sourcemap.json && \
	  echo "--- sourcemap (first 200 bytes) ---" && \
	  head -c 200 output.sourcemap.json; echo' 
	@echo "typst sourcemap sidecar verified."

# Convenience: build the typst stage and verify it in one go.
typst: typst-build typst-verify

push:
	docker push $(OVERLEAF_BASE_TAG)
	docker push $(OVERLEAF_BASE_BRANCH)
	docker push $(OVERLEAF_TAG)
	docker push $(OVERLEAF_BRANCH)

SHELLCHECK_OPTS = \
	--shell=bash \
	--external-sources \
	--exclude=SC1091
SHELLCHECK_COLOR := $(if $(CI),--color=never,--color)
SHELLCHECK_FILES := { git ls-files "*.sh" -z; git grep -Plz "\A\#\!.*bash"; } | sort -zu

shellcheck:
	@$(SHELLCHECK_FILES) | xargs -0 -r docker run --rm -v $(HERE):/mnt -w /mnt \
		koalaman/shellcheck:stable $(SHELLCHECK_OPTS) $(SHELLCHECK_COLOR)

shellcheck_fix:
	@$(SHELLCHECK_FILES) | while IFS= read -r -d '' file; do \
		diff=$$(docker run --rm -v $(HERE):/mnt -w /mnt koalaman/shellcheck:stable $(SHELLCHECK_OPTS) --format=diff "$$file" 2>/dev/null); \
		if [ -n "$$diff" ] && ! echo "$$diff" | patch -p1 >/dev/null 2>&1; then echo "\033[31m$$file\033[0m"; \
		elif [ -n "$$diff" ]; then echo "$$file"; \
		else echo "\033[2m$$file\033[0m"; fi \
	done

.PHONY: all \
	build-base build-community \
	typst typst-build typst-verify \
	shellcheck shellcheck_fix
