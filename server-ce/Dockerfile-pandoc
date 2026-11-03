# Custom Pandoc image for clsi sandboxed conversions
# (import/export: docx / markdown / html, via ENABLE_PANDOC_CONVERSIONS).
#
# Why this exists:
#   The official quay.io/sharelatex/pandoc:3.9 image is private (401, can't pull).
#   clsi invokes pandoc generically (no custom templates/filters/reference-doc), so a
#   stock pandoc image works — it just needs three runtime essentials that clsi assumes:
#
#   1. No `pandoc` ENTRYPOINT — clsi runs Cmd ["pandoc", ...]; with the default
#      entrypoint that would become `pandoc pandoc ...`.
#   2. `zip` — the import conversion's second step runs `zip -r` to package the output.
#   3. Users matching how clsi runs the conversion container (User=$TEXLIVE_IMAGE_USER):
#        - `tex` at UID 1000 — dev / microservices default.
#        - `www-data` at UID 33 — Server Pro sandboxed *sibling* containers set
#          TEXLIVE_IMAGE_USER=www-data (see /etc/overleaf/env.sh). clsi (running as
#          www-data) creates the conversion dir owned by 33:33, so the container must run
#          as www-data(33) to write into it — otherwise pandoc fails with either
#          "unable to find user www-data" or "permission denied".
#      Alpine already ships a `www-data` group at GID 82, so we move it to GID 33 to
#      match the host/texlive image.
#
# Build (tag must match PANDOC_IMAGE in develop/dev.env):
#   docker build -t overleaf-pandoc:local develop/pandoc
#
# Note: pinned to `latest` (pandoc 3.10 at time of writing). Pin to a specific
# pandoc/core tag for fully reproducible builds.
FROM pandoc/core:latest

ENTRYPOINT []

RUN apk add --no-cache zip \
 && adduser -D -u 1000 tex \
 && (delgroup www-data 2>/dev/null || true) \
 && addgroup -g 33 www-data \
 && adduser -D -u 33 -G www-data www-data
