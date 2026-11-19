# CLSI-TYPST — the Typst compile service (sibling of services/clsi).
#
# Stages:
#   typst-build : tinymist (fingolfin/tinymist), branch `synctex` — Max Horn's
#                 unmerged `--synctex` feature — built as a fully static musl
#                 binary.
#   base/app    : the Node service (mirrors services/clsi/Dockerfile).
#   with-typst  : app + the static tinymist binary at /usr/local/bin/tinymist
#                 (the path clsi-typst expects; the compile command is driven
#                 by TypstRunner, which overrides the image ENTRYPOINT anyway).

# ---------------------------------------------------------------------------
# Typst compiler (tinymist, `synctex` branch: --synctex sidecar)
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

# Pin the compiler EXACTLY: a later branch move must not silently change the
# build. The --synctex feature lives on the `synctex` branch (not main); the
# SHA must be the branch tip (or an ancestor) at build time.
ARG TINYMIST_REF=4eef4a4c3929d27ac6444af447a1f78a0868f17b
RUN git clone --single-branch --branch synctex \
        https://github.com/fingolfin/tinymist.git /app \
    && git -C /app rev-parse HEAD | grep -q "^${TINYMIST_REF}\$" \
    && git -C /app checkout -q "$TINYMIST_REF"
WORKDIR /app

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
# Runtime: app + static tinymist binary
# ---------------------------------------------------------------------------
FROM app AS with-typst

# The static binary needs no shared libraries (musl, static).
COPY --from=typst-build /app/target/release/tinymist /usr/local/bin/tinymist
RUN chmod 0555 /usr/local/bin/tinymist \
    && mkdir -p cache compiles output \
    && chown -R node:node cache compiles output

LABEL org.opencontainers.image.description="Overleaf Typst compiler service (tinymist synctex branch + CLSI sourcemap adapter)"

CMD ["node", "--expose-gc", "--trace-warnings", "app.js"]

FROM app AS clsi-typst
COPY --from=typst-build /app/target/release/tinymist /usr/local/bin/tinymist
RUN chmod 0555 /usr/local/bin/tinymist \
    && mkdir -p cache compiles output \
    && chown -R node:node cache compiles output

CMD ["node", "--expose-gc", "--trace-warnings", "app.js"]
