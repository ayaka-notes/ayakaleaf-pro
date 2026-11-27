# ============================================================================
# ollitex/golang-builder-amd64-alpine — Go 1.27.1 toolchain on alpine:3.24
# (musl). ALPINE SPIKE variant (owner-approved 2026-09-28), sibling of
# images/golang-builder-amd64 (glibc).
#
# The Go toolchain comes from the OFFICIAL static tarball (go.dev/dl
# go1.27.1.linux-amd64.tar.gz) — unlike COPY --from=golang:1.27.1-bookworm,
# which is glibc-linked and cannot run under musl. CGO builds (mattn/
# go-sqlite3 in cmd/web, cmd/configdb, gitbridge) compile against the host's
# musl + gcc via CGO_ENABLED=1 — proven: `go build ./cmd/configdb` on
# alpine:3.24 succeeds (spike probe, 2026-09-28).
#
# Repeated builds reuse host-persistent module + build caches (BuildKit),
# exactly like the glibc builder:
#     --mount=type=cache,target=/gocache/mod,id=ol-go-mod
#     --mount=type=cache,target=/gocache/build,id=ol-go-build
#
# Local tag: ollitex/golang-builder-amd64-alpine:1.27.1 (+ :latest)
# ============================================================================
FROM alpine:3.24

# cgo needs a C toolchain + libc headers; basic tools for source fetches.
RUN apk add --no-cache \
        ca-certificates curl git gcc musl-dev g++ make pkgconf linux-headers \
    && rm -rf /var/cache/apk/*

# Exact Go 1.27.1 toolchain from the official static tarball (musl-runnable,
# pinned to match go.mod's `go 1.27` exactly — no runtime toolchain swap).
RUN apk add --no-cache tar xz-libs brotli-libs \
    && curl -fsSL -o /tmp/go.tgz https://go.dev/dl/go1.27.1.linux-amd64.tar.gz \
    && tar -C /usr/local -xzf /tmp/go.tgz \
    && rm /tmp/go.tgz \
    && /usr/local/go/bin/go version

ENV PATH=/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    GOTOOLCHAIN=local \
    CGO_ENABLED=1 \
    GOMODCACHE=/gocache/mod \
    GOCACHE=/gocache/build \
    GOFLAGS=-mod=mod

# Conventional, host-cache-mountable locations (same ids as the glibc builder
# so build-images build steps work unchanged).
RUN mkdir -p /gocache/mod /gocache/build

WORKDIR /build
CMD ["sh"]
