# CLSI-TYPST — the Typst compile service (sibling of services/clsi).
#
# Stages:
#   typst-build : the typst fork (0.15.1-with-extras @ d101c2f5) + the CLSI
#                 sourcemap-sidecar patch (patches/0001-clsi-sourcemap.patch,
#                 D21) — built as a fully static musl binary. Ported from the
#                 OlliTeX `images/typst-amd64/Dockerfile`.
#   base/app    : the Node service (mirrors services/clsi/Dockerfile).
#   with-typst  : app + the static typst binary at /usr/local/bin/typst (the
#                 path clsi-typst expects; the compile command is driven by
#                 TypstRunner, which overrides the image ENTRYPOINT anyway).

# ---------------------------------------------------------------------------
# Typst compiler (forked, sourcemap sidecar extension)
# ---------------------------------------------------------------------------
FROM rust:alpine3.24 AS typst-build

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

# Pin the fork base (0.15.1-with-extras tip) EXACTLY: a later upstream branch
# move must not silently change the build. Clone by SHA from the branch (the
# ref must exist first; the SHA is then verified below and checked out).
ARG TYPST_REF=d101c2f507acd2e680a187735c5c201094e00077
RUN git clone --single-branch --branch 0.15.1-with-extras \
        https://github.com/typst/typst.git /app \
    && git -C /app rev-parse HEAD | grep -q "^${TYPST_REF}\$" \
    && git -C /app checkout -q "$TYPST_REF"
WORKDIR /app

# CLSI fork: apply the sourcemap-sidecar patch before building.
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

# ---------------------------------------------------------------------------
# Node base
# ---------------------------------------------------------------------------
FROM node:24.18.1 AS base

# Corepack setup, shared between all the images.
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack install -g yarn@4.18.0
ENV COREPACK_ENABLE_NETWORK=0

WORKDIR /overleaf/services/clsi-typst
COPY services/clsi-typst/install_deps.sh /overleaf/services/clsi-typst/
RUN chmod 0755 ./install_deps.sh && ./install_deps.sh
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
COPY services/clsi-typst/entrypoint.sh /

# Google Cloud Storage needs a writable $HOME/.config for resumable uploads
# (see https://cloud.google.com/storage/docs/resumable-uploads)
RUN mkdir /home/node/.config && chown node:node /home/node/.config

FROM base AS app

COPY package.json yarn.lock .yarnrc.yml .pnp.register.mjs /overleaf/
COPY libraries/eslint-plugin/package.json /overleaf/libraries/eslint-plugin/package.json
COPY libraries/fetch-utils/package.json /overleaf/libraries/fetch-utils/package.json
COPY libraries/logger/package.json /overleaf/libraries/logger/package.json
COPY libraries/metrics/package.json /overleaf/libraries/metrics/package.json
COPY libraries/o-error/package.json /overleaf/libraries/o-error/package.json
COPY libraries/overleaf-editor-core/package.json /overleaf/libraries/overleaf-editor-core/package.json
COPY libraries/promise-utils/package.json /overleaf/libraries/promise-utils/package.json
COPY libraries/settings/package.json /overleaf/libraries/settings/package.json
COPY libraries/stream-utils/package.json /overleaf/libraries/stream-utils/package.json
COPY libraries/validation-tools/package.json /overleaf/libraries/validation-tools/package.json
COPY services/clsi-typst/package.json /overleaf/services/clsi-typst/package.json
COPY .yarn/patches/ /overleaf/.yarn/patches/

RUN cd /overleaf && yarn workspaces focus @overleaf/clsi-typst overleaf
COPY libraries/eslint-plugin/ /overleaf/libraries/eslint-plugin/
COPY libraries/fetch-utils/ /overleaf/libraries/fetch-utils/
COPY libraries/logger/ /overleaf/libraries/logger/
COPY libraries/metrics/ /overleaf/libraries/metrics/
COPY libraries/o-error/ /overleaf/libraries/o-error/
COPY libraries/overleaf-editor-core/ /overleaf/libraries/overleaf-editor-core/
COPY libraries/promise-utils/ /overleaf/libraries/promise-utils/
COPY libraries/settings/ /overleaf/libraries/settings/
COPY libraries/stream-utils/ /overleaf/libraries/stream-utils/
COPY libraries/validation-tools/ /overleaf/libraries/validation-tools/
COPY services/clsi-typst/ /overleaf/services/clsi-typst/

ENV NODE_OPTIONS="--require /overleaf/.pnp.cjs --import /overleaf/.pnp.register.mjs"

# ---------------------------------------------------------------------------
# Runtime: app + static typst binary
# ---------------------------------------------------------------------------
FROM app AS with-typst

# The static binary needs no shared libraries (musl, static).
COPY --from=typst-build /app/target/release/typst /usr/local/bin/typst
RUN chmod 0555 /usr/local/bin/typst \
    && mkdir -p cache compiles output \
    && chown -R node:node cache compiles output

LABEL org.opencontainers.image.description="Overleaf Typst compiler service (typst fork 0.15.1 + CLSI sourcemap sidecar)"

CMD ["node", "--expose-gc", "--trace-warnings", "app.js"]

FROM app AS clsi-typst
COPY --from=typst-build /app/target/release/typst /usr/local/bin/typst
RUN chmod 0555 /usr/local/bin/typst \
    && mkdir -p cache compiles output \
    && chown -R node:node cache compiles output

CMD ["node", "--expose-gc", "--trace-warnings", "app.js"]
