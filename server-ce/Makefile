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
# Standalone Typst runtime image (typst-runtime stage) — sibling container for
# clsi-typst sandboxed compiles (CLSI_TYPST_DOCKER_RUNNER=true, TYPST_IMAGE).
export OVERLEAF_TYPSF_BRANCH ?= ollitex/typst:$(BRANCH_NAME_TAG_SAFE)
export OVERLEAF_TYPSF_LATEST ?= ollitex/typst:latest
export OVERLEAF_TYPSF_TAG ?= ollitex/typst:$(BRANCH_NAME_TAG_SAFE)-$(MONOREPO_REVISION)

all: build-base build-community build-typst

clean:
	-docker rmi --force $(OVERLEAF_BASE_TAG) $(OVERLEAF_TAG) $(OVERLEAF_TYPSF_TAG)

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

build-typst: ## Build the standalone Typst runtime image (typst-runtime stage) for clsi-typst sandboxed compiles
	cp .dockerignore $(MONOREPO_ROOT)
	docker build \
	  --build-arg BUILDKIT_INLINE_CACHE=1 \
	  --progress=plain \
	  --build-arg TINYMIST_REF=$(TINYMIST_REF) \
	  --label "com.overleaf.ce.revision=$(MONOREPO_REVISION)" \
	  --cache-from $(OVERLEAF_TYPSF_LATEST) \
	  --cache-from $(OVERLEAF_TYPSF_BRANCH) \
	  --target typst-runtime \
	  --file Dockerfile \
	  --tag $(OVERLEAF_TYPSF_TAG) \
	  --tag $(OVERLEAF_TYPSF_BRANCH) \
	  $(MONOREPO_ROOT)
	@echo "Built standalone Typst image: $(OVERLEAF_TYPSF_TAG)  (TINYMIST_REF=$(TINYMIST_REF))"

# --- Typst compiler (tinymist, `synctex` branch) ---------------------------
# The compiler is NOT committed to the repo (the source tree + built binary
# are far too large to ship). It is fetched (git clone of the `synctex`
# branch, pinned to TINYMIST_REF) and compiled (cargo, static musl) inside the
# `typst-build` stage of ./Dockerfile at build time. The branch carries Max
# Horn's unmerged `--synctex` feature; clsi-typst adapts the resulting
# `output.synctex.gz` to the `output.sourcemap.json` sidecar (see
# services/clsi-typst/app/js/SynctexAdapter.js).
TINYMIST_REF ?= 4eef4a4c3929d27ac6444af447a1f78a0868f17b
TYPST_BUILD_IMG ?= sharelatex/typst-build:$(BRANCH_NAME_TAG_SAFE)-$(MONOREPO_REVISION)

# Build just the typst-build stage (download + compile) in isolation —
# warms the BuildKit cargo cache and produces a reusable stage image. This is
# the "build process" for the typst compiler (tinymist).
typst-build:
	cp .dockerignore $(MONOREPO_ROOT)
	docker build \
	  --build-arg BUILDKIT_INLINE_CACHE=1 \
	  --progress=plain \
	  --build-arg TINYMIST_REF=$(TINYMIST_REF) \
	  --cache-from $(TYPST_BUILD_IMG) \
	  --target typst-build \
	  --tag $(TYPST_BUILD_IMG) \
	  --file Dockerfile \
	  $(MONOREPO_ROOT)
	@echo "Built typst-build stage: $(TYPST_BUILD_IMG)  (TINYMIST_REF=$(TINYMIST_REF))"

# Prove the built compiler emits the SyncTeX sidecar: run it with --synctex
# and confirm output.synctex.gz appears next to the compiled PDF.
typst-verify:
	docker run --rm $(TYPST_BUILD_IMG) sh -c ' \
	  B=/app/target/release/tinymist; \
	  "$$B" --version; \
	  cd /tmp && printf "= T\n\n#let x = 42\n\nThe value is #x.\n" > t.typ && \
	  "$$B" compile --synctex t.typ o.pdf && \
	  echo "--- output.pdf + synctex sidecar ---" && \
	  ls -la o.pdf o.synctex.gz && \
	  echo "--- synctex (first 200 bytes) ---" && \
	  zcat o.synctex.gz | head -c 200; echo' 
	@echo "tinymist --synctex sidecar verified."

# Convenience: build the typst stage and verify it in one go.
typst: typst-build typst-verify

push:
	docker push $(OVERLEAF_BASE_TAG)
	docker push $(OVERLEAF_BASE_BRANCH)
	docker push $(OVERLEAF_TAG)
	docker push $(OVERLEAF_BRANCH)
	docker push $(OVERLEAF_TYPSF_TAG)
	docker push $(OVERLEAF_TYPSF_BRANCH)

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
	build-base build-community build-typst \
	typst typst-build typst-verify \
	shellcheck shellcheck_fix
