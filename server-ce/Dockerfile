# syntax=docker/dockerfile:1-labs
# ---------------------------------------------
# Overleaf Community Edition (overleaf/overleaf)
# ---------------------------------------------

# Global build args (must be declared before any FROM to be usable in FROM).
ARG TYPST_REF=d101c2f507acd2e680a187735c5c201094e00077
ARG OVERLEAF_BASE_TAG=sharelatex/sharelatex-base:latest

# Typst compiler (forked, sourcemap sidecar) — shared by the main image and
# the clsi-typst service. Mirrors services/clsi-typst/Dockerfile.
FROM rust:alpine3.24 AS typst-build

ARG TYPST_REF

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

RUN git clone --single-branch --branch 0.15.1-with-extras \
        https://github.com/typst/typst.git /app \
    && git -C /app rev-parse HEAD | grep -q "^${TYPST_REF}\$" \
    && git -C /app checkout -q "$TYPST_REF"
WORKDIR /app

COPY services/clsi-typst/patches/0001-clsi-sourcemap.patch /tmp/sourcemap.patch
RUN git -C /app apply /tmp/sourcemap.patch \
    && rm /tmp/sourcemap.patch

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
    cargo build -p typst-cli --release

FROM $OVERLEAF_BASE_TAG

WORKDIR /overleaf

# Typst compiler binary for the clsi-typst service (static musl binary; the
# typst-build stage above is independent of the app layers so it can build in
# parallel). Kept before the app COPYs so a source change doesn't rebuild it.
COPY --from=typst-build /app/target/release/typst /usr/local/bin/typst
RUN chmod 0555 /usr/local/bin/typst

LABEL org.opencontainers.image.description="Overleaf Community Edition (with Typst support: typst fork 0.15.1 + CLSI sourcemap sidecar)"

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
