# syntax=docker/dockerfile:1-labs
# ---------------------------------------------
# Overleaf Community Edition (overleaf/overleaf)
# ---------------------------------------------

# Global build args (must be declared before any FROM to be usable in FROM).
# Compiler: tinymist (canonical Myriad-Dreamin/tinymist) at a pinned base SHA,
# with our VENDORed copy of the `--synctex` feature (patches/tinymist-synctex.patch,
# Max Horn's unmerged PR #2766, commit TINYMIST_REF) applied on top. Building from
# the canonical base + our own patch means we do NOT depend on the contributor's
# PR branch surviving. tinymist computes the source mapping in-process and writes
# it as a standard SyncTeX file (`output.synctex.gz`); clsi-typst adapts it to the
# `output.sourcemap.json` sidecar (app/js/SynctexAdapter.js) — no typst fork.
ARG TINYMIST_BASE_REF=73db58b8e2fd2cc6b85038594464b91684c79491
ARG TINYMIST_REF=4eef4a4c3929d27ac6444af447a1f78a0868f17b
ARG OVERLEAF_BASE_TAG=sharelatex/sharelatex-base:latest

# Typst compiler (tinymist + vendored --synctex) — shared by the main image and
# the clsi-typst service. Mirrors services/clsi-typst/Dockerfile.
FROM rust:alpine3.24 AS typst-build

ARG TINYMIST_BASE_REF
ARG TINYMIST_REF

# build-base = gcc, make, musl-dev; static linking -> no runtime shared deps.
RUN apk add --no-cache \
        build-base \
        pkgconf \
        cmake \
        git \
        ca-certificates \
        musl-dev \
        openssl-dev \
        openssl-libs-static \
        clang \
        lld

ENV CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse

# 1) Fetch the CANONICAL tinymist at the pinned base SHA. (GitHub allows
#    fetching a reachable SHA; the base is on main, so this is stable and does
#    not depend on any contributor branch.)
RUN git init /app \
    && git -C /app remote add origin https://github.com/Myriad-Dreamin/tinymist.git \
    && git -C /app fetch --depth 1 origin "${TINYMIST_BASE_REF}" \
    && git -C /app checkout -q FETCH_HEAD \
    && git -C /app rev-parse HEAD | grep -q "^${TINYMIST_BASE_REF}$"
WORKDIR /app

# 2) Apply our vendored copy of the --synctex feature (PR #2766, commit
#    ${TINYMIST_REF}), so the build is self-contained if that branch/PR vanishes.
COPY services/clsi-typst/patches/tinymist-synctex.patch /tmp/synctex.patch
RUN git -C /app apply --whitespace=nowarn /tmp/synctex.patch \
    && test -f /app/crates/tinymist-task/src/compute/synctex.rs \
    && rm /tmp/synctex.patch

RUN --mount=type=cache,target=/root/.cargo/git/db \
    --mount=type=cache,target=/root/.cargo/registry/cache \
    --mount=type=cache,target=/root/.cargo/registry/index \
    CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse \
    cargo fetch

RUN --mount=type=cache,target=/root/.cargo/git/db \
    --mount=type=cache,target=/root/.cargo/registry/cache \
    --mount=type=cache,target=/root/.cargo/registry/index \
    OPENSSL_NO_PKG_CONFIG=1 OPENSSL_STATIC=1 \
    OPENSSL_DIR="/usr" \
    cargo build --release -p tinymist-cli

# ---------------------------------------------------------------------------
# Standalone Typst runtime image (typst-runtime stage) — the sibling-container
# image for clsi-typst sandboxed compiles (`CLSI_TYPST_DOCKER_RUNNER=true`).
# Static musl binary on minimal alpine: no shared-library dependencies.
# `typst` user is uid/gid 33 to match www-data (33) in the Overleaf image so
# it can read/write the bind-mounted /compile dir (owned by the host service
# user). clsi-typst's DockerRunner drives it: Cmd = sh -c '... tinymist
# compile --synctex ...', User = typst, network disabled, CapDrop ALL.
FROM alpine:3.24 AS typst-runtime

RUN addgroup -g 33 typst && adduser -D -u 33 -G typst typst

COPY --from=typst-build /app/target/release/tinymist /usr/local/bin/tinymist
RUN chmod 0555 /usr/local/bin/tinymist

ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

LABEL org.opencontainers.image.source="https://github.com/Myriad-Dreamin/tinymist"
LABEL org.opencontainers.image.description="Typst compiler: tinymist base ${TINYMIST_BASE_REF} + vendored --synctex ${TINYMIST_REF}"

USER typst
ENTRYPOINT [ "/usr/local/bin/tinymist" ]
CMD [ "--version" ]

FROM $OVERLEAF_BASE_TAG

WORKDIR /overleaf

# Typst compiler binary for the clsi-typst service (static musl binary; the
# typst-build stage above is independent of the app layers so it can build in
# parallel). Kept before the app COPYs so a source change doesn't rebuild it.
COPY --from=typst-build /app/target/release/tinymist /usr/local/bin/tinymist
RUN chmod 0555 /usr/local/bin/tinymist

LABEL org.opencontainers.image.description="Overleaf Community Edition (with Typst support: tinymist synctex-branch compiler + CLSI sourcemap adapter)"

# Add required source files for yarn install
# -------------------------------------------
COPY --parents libraries/*/package.json .yarn/patches/ services/*/package.json tools/migrations/ package.json yarn.lock .yarnrc.yml .pnp.register.mjs /overleaf/
COPY server-ce/genScript.js server-ce/services.js /overleaf/

# Pre-install yarn via corepack so it is available at runtime for all users
# -------------------------------------------------------------------------
# Corepack setup, shared between all the images.
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack install -g yarn@4.18.0
ENV COREPACK_ENABLE_NETWORK=0

# Install yarn dependencies
# -------------------------
RUN --mount=type=cache,target=/root/.cache \
    --mount=type=cache,target=/root/.yarn/berry/cache,id=server-ce-yarn-cache \
    --mount=type=cache,target=/usr/local/share/.cache/yarn,id=server-ce-yarn-fallback-cache \
    --mount=type=tmpfs,target=/tmp node genScript install | bash

# Add the actual source files
# ---------------------------
COPY --parents libraries/ services/ tools/migrations/ /overleaf/
RUN --mount=type=cache,target=/root/.cache \
    --mount=type=cache,target=/root/.yarn/berry/cache,id=server-ce-yarn-cache \
    --mount=type=cache,target=/usr/local/share/.cache/yarn,id=server-ce-yarn-fallback-cache \
    --mount=type=cache,target=/overleaf/services/web/.cache,id=server-ce-webpack-cache \
    --mount=type=tmpfs,target=/tmp \
    node genScript compile | bash

# Enable Yarn PnP resolution for all Node.js processes
# -----------------------------------------------------
ENV NODE_OPTIONS="--require /overleaf/.pnp.cjs --import /overleaf/.pnp.register.mjs"

# Copy runit service startup scripts to its location
# --------------------------------------------------
ADD server-ce/runit /etc/service

# Copy runit global settings to its location
# ------------------------------------------
ADD server-ce/config/env.sh /etc/overleaf/env.sh

# Configure nginx
# ---------------
ADD server-ce/nginx/nginx.conf.template /etc/nginx/templates/nginx.conf.template
ADD server-ce/nginx/overleaf.conf /etc/nginx/sites-enabled/overleaf.conf
ADD server-ce/nginx/clsi-nginx.conf /etc/nginx/sites-enabled/clsi-nginx.conf


# Configure log rotation
# ----------------------
ADD server-ce/logrotate/overleaf /etc/logrotate.d/overleaf
RUN chmod 644 /etc/logrotate.d/overleaf

# Configure cron tasks
# ----------------------
ADD server-ce/cron /overleaf/cron
ADD server-ce/config/crontab-history /etc/cron.d/crontab-history
RUN chmod 600 /etc/cron.d/crontab-history
ADD server-ce/config/crontab-deletion /etc/cron.d/crontab-deletion
RUN chmod 600 /etc/cron.d/crontab-deletion

# Copy Phusion Image startup and shutdown scripts to their locations
# ------------------------------------------------------------------
COPY server-ce/init_scripts/ /etc/my_init.d/
COPY server-ce/init_preshutdown_scripts/ /etc/my_init.pre_shutdown.d/

# Copy app settings files
# -----------------------
COPY server-ce/config/settings.js /etc/overleaf/settings.js

# Copy history-v1 files
# -----------------------
COPY server-ce/config/production.json /overleaf/services/history-v1/config/production.json
COPY server-ce/config/custom-environment-variables.json /overleaf/services/history-v1/config/custom-environment-variables.json

# Copy grunt thin wrapper
# -----------------------
ADD server-ce/bin/grunt /usr/local/bin/grunt
RUN chmod +x /usr/local/bin/grunt

# Copy history helper scripts
# ---------------------------
ADD server-ce/bin/flush-history-queues /overleaf/bin/flush-history-queues
RUN chmod +x /overleaf/bin/flush-history-queues
ADD server-ce/bin/force-history-resyncs /overleaf/bin/force-history-resyncs
RUN chmod +x /overleaf/bin/force-history-resyncs

# Copy Latexmkrc
# -----------------------
COPY server-ce/config/latexmkrc /usr/local/share/latexmk/LatexMk

# File that controls open|closed status of the site
# -------------------------------------------------
ENV SITE_MAINTENANCE_FILE="/etc/overleaf/site_status"
RUN touch $SITE_MAINTENANCE_FILE

# Set Environment Variables
# --------------------------------
ENV OVERLEAF_CONFIG=/etc/overleaf/settings.js

ENV WEB_API_USER="overleaf"
ENV ADMIN_PRIVILEGE_AVAILABLE="true"

ENV OVERLEAF_APP_NAME="Overleaf Community Edition"

ENV OPTIMISE_PDF="true"

ENV REQ_VALIDATION_MODE=enforce-log

# Phusion Image timeouts before sending SIGKILL to processes
# ----------------------------------------------------------
ENV KILL_PROCESS_TIMEOUT=55
ENV KILL_ALL_PROCESSES_TIMEOUT=55
ENV GRACEFUL_SHUTDOWN_DELAY_SECONDS=1

ENV NODE_ENV="production"
ENV LOG_LEVEL="info"


EXPOSE 80

ENTRYPOINT ["/sbin/my_init"]
