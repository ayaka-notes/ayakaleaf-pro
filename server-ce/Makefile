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
export OVERLEAF_PNG2PDF ?= sharelatex/png2pdf:2026-06-24

all: build-base build-community build-png2pdf

clean:
	-docker rmi --force $(OVERLEAF_BASE_TAG) $(OVERLEAF_TAG) $(OVERLEAF_PNG2PDF)

refresh-cache: refresh-cache-branch
refresh-cache-branch:
	docker inspect $(OVERLEAF_BASE_BRANCH) > /dev/null && docker pull $(OVERLEAF_BASE_BRANCH) || true
	docker inspect $(OVERLEAF_BRANCH) > /dev/null && docker pull $(OVERLEAF_BRANCH) || true
	docker inspect $(OVERLEAF_PNG2PDF) > /dev/null && docker pull $(OVERLEAF_PNG2PDF) || true
refresh-cache: refresh-cache-latest
refresh-cache-latest:
	docker inspect $(OVERLEAF_BASE_LATEST) > /dev/null && docker pull $(OVERLEAF_BASE_LATEST) || true
	docker inspect $(OVERLEAF_LATEST) > /dev/null && docker pull $(OVERLEAF_LATEST) || true
	docker inspect $(OVERLEAF_PNG2PDF) > /dev/null && docker pull $(OVERLEAF_PNG2PDF) || true

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

build-png2pdf:
	cp .dockerignore $(MONOREPO_ROOT)
	docker build \
	  --build-arg BUILDKIT_INLINE_CACHE=1 \
	  --progress=plain \
	  --build-arg OVERLEAF_BASE_TAG \
	  --label "com.overleaf.ce.revision=$(MONOREPO_REVISION)" \
	  --cache-from $(OVERLEAF_PNG2PDF) \
	  --file Dockerfile-png2pdf \
	  --tag $(OVERLEAF_PNG2PDF) \
	  $(MONOREPO_ROOT)

push:
	docker push $(OVERLEAF_BASE_TAG)
	docker push $(OVERLEAF_BASE_BRANCH)
	docker push $(OVERLEAF_TAG)
	docker push $(OVERLEAF_BRANCH)
	docker push $(OVERLEAF_PNG2PDF)

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
	build-base build-community build-png2pdf \
	shellcheck shellcheck_fix
