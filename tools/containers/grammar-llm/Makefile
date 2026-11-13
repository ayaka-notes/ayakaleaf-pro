# grammar-llm container — development & ops tasks
#
# Everything maps to the documented npm scripts / docs; pick whichever you
# like. Run `make help` (the default) for the list.

SHELL       := /bin/bash
NODE        ?= node
DOCKER      ?= docker
NODE_TAG    ?= 24

IMAGE       ?= grammar-llm
TAG         ?= latest
PORT        ?= 8010
CONTAINER_NAME    := glm-run
MODEL_VOLUME      := glm-models
MODEL_DIR         ?= models
MODEL_FILE        ?= GRMR-V3-G4B-Q4_K_M.gguf
MODEL_URL         ?= https://huggingface.co/icecubetr/GRMR-V3-G4B-GGUF/resolve/main/GRMR-V3-G4B-Q4_K_M.gguf
# BASE for the smoke script (server to smoke-test against)
BASE          ?= http://127.0.0.1:8010

.PHONY: help
help:
	@echo "grammar-llm container — make targets"
	@echo
	@echo "  Local dev"
	@echo "    install            npm install (node-llama-cpp + esbuild)"
	@echo "    build              bundle src/ -> dist/ (esbuild)"
	@echo "    test               build + node --test test/ (no model needed)"
	@echo "    start              run the server locally (needs model; see download-model)"
	@echo "    download-model     fetch GRMR-V3-G4B GGUF into ./$(MODEL_DIR)/ (local server)"
	@echo "    sync-core          re-vendor core/ from grammar-llm (scripts/sync-core.sh)"
	@echo "    smoke BASE=<url>   e2e smoke against a RUNNING server (default $(BASE))"
	@echo
	@echo "  Docker"
	@echo "    docker-build       docker build -t $(IMAGE):$(TAG) ."
	@echo "    docker-smoke       docker-build + run on :$(PORT) + smoke against it"
	@echo "    docker-run         start container on :$(PORT) (model volume, detached)"
	@echo "    docker-stop        stop + rm the container (volume kept)"
	@echo "    docker-clobber     docker-stop + delete the model volume"
	@echo
	@echo "  Misc"
	@echo "    all              build the Docker image (compiles inside the node base image — no local Node needed)"
	@echo "    docker-test      run the unit tests inside a node base-image container (no local Node needed)"
	@echo "    logs               tail the running container's logs"
	@echo "    clean              rm -rf dist node_modules (keep core/, models)"

.PHONY: install
install:
	npm install

.PHONY: ensure-deps
ensure-deps:
	@if [ ! -d node_modules ]; then \
	  echo "node_modules missing — running npm install…"; \
	  npm install; \
	fi

.PHONY: build
build: ensure-deps
	$(NODE) build.mjs

.PHONY: test
test: ensure-deps
	$(NODE) build.mjs --quiet && $(NODE) --test test/*.test.mjs

.PHONY: start
start: ensure-deps build
	GRAMMAR_LLM_MODEL_DIR=$(MODEL_DIR) PORT=$${PORT:-8010} $(NODE) dist/server.mjs

.PHONY: download-model
download-model: ensure-deps build
	mkdir -p $(MODEL_DIR)
	$(NODE) dist/download-model.mjs --url "$(MODEL_URL)" --out "$(MODEL_DIR)/$(MODEL_FILE)"

.PHONY: sync-core
sync-core:
	bash scripts/sync-core.sh $(GRAMMAR_LLM_SRC)

.PHONY: smoke
smoke:
	BASE=$(BASE) bash test/smoke.sh

# --- docker ---------------------------------------------------------------

.PHONY: docker-build
docker-build:
	$(DOCKER) build -t $(IMAGE):$(TAG) .

.PHONY: docker-test
docker-test:
	@echo "running the test suite inside the $(NODE_TAG:24=24)-bookworm-slim base image (no local Node needed)"
	$(DOCKER) run --rm -v "$(PWD):/src:ro" -w /app node:$(NODE_TAG)-bookworm-slim sh -c \
		'cp -r /src/. /app && npm ci --no-audit --no-fund && node build.mjs --quiet && node --test test/*.test.mjs'

.PHONY: docker-smoke
docker-smoke: docker-build
	$(DOCKER) rm -f $(CONTAINER_NAME) 2>/dev/null || true
	$(DOCKER) run -d --name $(CONTAINER_NAME) -p $(PORT):$(PORT) -v $(MODEL_VOLUME):/models $(IMAGE):$(TAG)
	@echo "waiting for model load…"
	@for i in $$(seq 1 120); do \
	   [ "$$($(DOCKER) logs $(CONTAINER_NAME) 2>&1 | grep -c 'model loaded and ready')" -ge 1 ] && break; \
	   sleep 5; \
	 done
	BASE=http://127.0.0.1:$(PORT) bash test/smoke.sh
	@echo "container $(CONTAINER_NAME) left running — stop with: make docker-stop"

.PHONY: docker-run
docker-run:
	$(DOCKER) rm -f $(CONTAINER_NAME) 2>/dev/null || true
	$(DOCKER) run -d --name $(CONTAINER_NAME) -p $(PORT):$(PORT) -v $(MODEL_VOLUME):/models $(IMAGE):$(TAG)
	@echo "$(CONTAINER_NAME) is up on :$(PORT) — check with: make smoke BASE=http://127.0.0.1:$(PORT)"

.PHONY: docker-stop
docker-stop:
	$(DOCKER) stop $(CONTAINER_NAME) 2>/dev/null || true
	$(DOCKER) rm $(CONTAINER_NAME) 2>/dev/null || true

.PHONY: docker-clobber
docker-clobber: docker-stop
	$(DOCKER) volume rm $(MODEL_VOLUME)

.PHONY: logs
logs:
	$(DOCKER) logs -f $(CONTAINER_NAME)

.PHONY: clean
clean:
	rm -rf dist node_modules

.PHONY: all
all: docker-build
	@echo "all done — image: $(IMAGE):$(TAG) (compiled inside the node base image; no local Node needed)"
