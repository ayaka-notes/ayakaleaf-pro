# E2E tests against an instance deployed the way users deploy it: clone the
# toolkit, bin/init, edit config/, bin/up. Cypress then drives it from a
# container on the toolkit's docker network.
#
#   make setup [SUITE=<suite>]   deploy, layering suites/<suite>/ config if any
#                                and starting the services/ it lists in services
#   make test SUITE=<suite>      run suites/<suite>/*.spec.ts, then each variant
#                                subfolder with its own config (see bin/run-suite)
#   make test_<suite>            the same for a top-level suite
#   make clean                   remove the deployment and its data
#
# Locally, INSTANCE=<1-5> on every make call runs up to five deployments at
# once, each with its own toolkit dir, compose project, containers and port.

SHELL := /bin/bash

MONOREPO := $(abspath ../../..)
TEST_ROOT := $(abspath ..)

TOOLKIT_REPO ?= https://github.com/ayaka-notes/toolkit.git
TOOLKIT_REF ?= 5132d5a0e97659b8149df2b407585d21853d7486
# Empty in CI: one deployment with the toolkit's own names
INSTANCE ?=
INSTANCE_SUFFIX := $(if $(INSTANCE),-$(INSTANCE))
TOOLKIT_DIR ?= $(HOME)/ayakaleaf-toolkit-e2e$(INSTANCE_SUFFIX)
TOOLKIT_NETWORK ?= overleaf$(INSTANCE)_default
# Container names start with it, e.g. e2e2-sharelatex; read by the scripts
export CONTAINER_PREFIX := $(if $(INSTANCE),e2e$(INSTANCE)-)

# Image under test, tagged locally as OVERLEAF_IMAGE_NAME:<toolkit version>
OVERLEAF_IMAGE ?= ghcr.io/ayaka-notes/overleaf-pro/ops:latest
OVERLEAF_IMAGE_NAME := $(shell sed -n 's/^OVERLEAF_IMAGE_NAME=//p' config/overleaf.rc)$(INSTANCE_SUFFIX)

CYPRESS_IMAGE ?= overleaf-pro-e2e-cypress
# The learn suite caches the whole wiki before the web service starts
STARTUP_TIMEOUT ?= 600

SUITE ?=
# Extra services a suite needs, listed in suites/<suite>/services
SERVICES = $(if $(SUITE),$(shell cat suites/$(SUITE)/services 2>/dev/null))
# Host port, only needed when the toolkit default (80) is taken locally;
# instance N listens on N0180
OVERLEAF_PORT ?= $(if $(INSTANCE),$(INSTANCE)0180)
# Runs only the cases whose full title (describe + it) contains this text
GREP ?=

.PHONY: setup test clean

setup:
	@if [[ -n "$(INSTANCE)" && ! "$(INSTANCE)" =~ ^[1-5]$$ ]]; then \
		echo "INSTANCE must be 1-5"; \
		exit 1; \
	fi
	@if [[ -e "$(TOOLKIT_DIR)" ]]; then \
		echo "$(TOOLKIT_DIR) already exists, run 'make clean' first"; \
		exit 1; \
	fi
	@if [[ -n "$(SUITE)" && ! -d "suites/$(SUITE)" ]]; then \
		echo "unknown suite '$(SUITE)'"; \
		exit 1; \
	fi
	git clone --quiet $(TOOLKIT_REPO) $(TOOLKIT_DIR)
	git -C $(TOOLKIT_DIR) checkout --quiet $(TOOLKIT_REF)
	@# Docker container names are global, the toolkit's are fixed
	@if [[ -n "$(INSTANCE)" ]]; then \
		sed -i 's/container_name: /&$(CONTAINER_PREFIX)/' $(TOOLKIT_DIR)/lib/docker-compose.*.yml; \
	fi
	$(TOOLKIT_DIR)/bin/init
	cp config/settings.cjs $(TOOLKIT_DIR)/config/
	@# A suite can replace the override with its own suites/<suite>/docker-compose.e2e.yml
	cp $(or $(wildcard suites/$(SUITE)/docker-compose.e2e.yml),config/docker-compose.e2e.yml) \
		$(TOOLKIT_DIR)/config/docker-compose.override.yml
	bin/apply-config $(TOOLKIT_DIR)/config/overleaf.rc config/overleaf.rc
	bin/apply-config $(TOOLKIT_DIR)/config/variables.env config/variables.env
	@for f in overleaf.rc variables.env; do \
		if [[ -n "$(SUITE)" && -f "suites/$(SUITE)/$$f" ]]; then \
			echo "Applying suites/$(SUITE)/$$f"; \
			bin/apply-config $(TOOLKIT_DIR)/config/$$f suites/$(SUITE)/$$f; \
		fi; \
	done
	@if [[ -n "$(OVERLEAF_PORT)" ]]; then \
		bin/apply-config $(TOOLKIT_DIR)/config/overleaf.rc <(echo "OVERLEAF_PORT=$(OVERLEAF_PORT)"); \
	fi
	@if [[ -n "$(INSTANCE)" ]]; then \
		bin/apply-config $(TOOLKIT_DIR)/config/overleaf.rc <(printf '%s\n' \
			"PROJECT_NAME=overleaf$(INSTANCE)" "OVERLEAF_IMAGE_NAME=$(OVERLEAF_IMAGE_NAME)"); \
	fi
	docker image inspect $(OVERLEAF_IMAGE) >/dev/null 2>&1 || docker pull $(OVERLEAF_IMAGE)
	docker tag $(OVERLEAF_IMAGE) $(OVERLEAF_IMAGE_NAME):$$(head -n 1 $(TOOLKIT_DIR)/config/version)
	docker build \
		--build-arg USER_UID=$$(id -u) \
		--build-arg USER_GID=$$(id -g) \
		--file Dockerfile.cypress \
		--tag $(CYPRESS_IMAGE) \
		$(MONOREPO)
	@for service in $(SERVICES); do \
		TOOLKIT_DIR=$(TOOLKIT_DIR) services/$$service/bin/prepare; \
	done
	$(TOOLKIT_DIR)/bin/up -d
	bin/wait-for-overleaf $(STARTUP_TIMEOUT)
	@for service in $(SERVICES); do \
		TOOLKIT_DIR=$(TOOLKIT_DIR) TOOLKIT_NETWORK=$(TOOLKIT_NETWORK) services/$$service/bin/up; \
	done

test:
	@if [[ ! -d "suites/$(SUITE)" ]]; then echo "unknown suite '$(SUITE)'"; exit 1; fi
	TOOLKIT_DIR=$(TOOLKIT_DIR) \
	TOOLKIT_NETWORK=$(TOOLKIT_NETWORK) \
	TEST_ROOT=$(TEST_ROOT) \
	CYPRESS_IMAGE=$(CYPRESS_IMAGE) \
	STARTUP_TIMEOUT=$(STARTUP_TIMEOUT) \
	GREP="$(GREP)" \
	INSTANCE=$(INSTANCE) \
		bin/run-suite $(SUITE)

# Shorthand for suites at the top level, e.g. make test_launchpad
test_%:
	$(MAKE) test SUITE=$*

clean:
	@for down in services/*/bin/down; do \
		TOOLKIT_NETWORK=$(TOOLKIT_NETWORK) $$down; \
	done
	@if [[ -d "$(TOOLKIT_DIR)" ]]; then \
		$(TOOLKIT_DIR)/bin/docker-compose down --volumes --remove-orphans --timeout 0; \
		docker run --rm --volume $(TOOLKIT_DIR):/toolkit --entrypoint rm $(OVERLEAF_IMAGE) -rf /toolkit/data; \
		rm -rf $(TOOLKIT_DIR); \
	fi
	rm -rf cypress/results$(INSTANCE_SUFFIX) cypress/downloads$(INSTANCE_SUFFIX)
