# WebDAV fixture — Ubuntu 26.04 packaged Apache 2 (2.4.66, dav_fs + dav_lock).
#
# Verified 2026-10-03 against the product-contract gates (curl battery +
# 15/15 Go-client contract run + 20/20 stable mixed-operation loops):
#   anon -> 401
#   MKCOL new -> 201 | existing (noslash AND slash) -> 405
#   MKCOL missing parent -> 409
#   PUT new -> 201 | overwrite -> 204 | GET -> 200 roundtrip + weak ETag
#   PROPFIND Depth:1 -> 207 (self + children, D:resourcetype present)
#   stale If-Match -> 412 (RFC 7232) | DELETE -> 204 | GET after -> 404
#
# Why this (server selection record, all measured on this host — README.md):
#   nginx-dav      noslash MKCOL -> 301/409 (trac #1966); Go net/http folds
#                  non-GET 301s into GET -> structurally broken for the client
#   mogeko/rshs    ignores PROPFIND Depth:1 -> list() degenerate
#   httpd:2.4-alpine dav_lock undefined apr_dbm_* (stock apr 1.6 lacks the DBM API)
#   Debian apache2 (bookworm/trixie): dav DBD lock-DB wiring dead end
#   apachewebdav   2.4.43; protocol-gate clean, but non-deterministic Basic-auth
#                  windows under repeated probes -> not a deterministic oracle
#   Ubuntu 26.04 ships apr-util 1.6.3 WITH the apr_dbm API and Apache 2.4.66
#   where dav_lock = DAVGenericLockDB (DBM store) — packaged, stable, current
#
# Ubuntu 26.04 specifics (each one bit us during bring-up):
#   * dav_lock uses `DAVGenericLockDB` (NOT `DavLockDB` / `DBDSetup` — invalid
#     in 2.4.66; `DBDMinConn`-era wiring is gone)
#   * authz provider spelling is `Require valid-user` (hyphen)
#   * vhost DocumentRoot must be the DAV root or all ops are 405
#   * `apachectl -DFOREGROUND` is the container entrypoint (verified)
#
# The fixture bakes the test identity (oltest) at build time — no runtime
# env/mounts needed for auth. Data dir: named volume (docker-compose.yml).
# Digest-pin this image; Ubuntu base pinned by digest below.

FROM ubuntu:26.04@sha256:3595d7fc4286a33fad0fd853a4063e654287a9c3787437d7937c94ca3f7a804e

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      apache2 apache2-utils curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && a2enmod dav dav_fs dav_lock \
    && echo "ServerName webdav-test" > /etc/apache2/conf-available/servername.conf \
    && a2enconf servername \
    && mkdir -p /var/www/dav /var/lib/webdav \
    && chown -R www-data:www-data /var/www/dav /var/lib/webdav

# Vhost DocumentRoot -> the DAV root (without this every op is 405)
RUN sed -i 's|DocumentRoot /var/www/html|DocumentRoot /var/www/dav|' \
      /etc/apache2/sites-available/000-default.conf

COPY dav-site.conf /etc/apache2/conf-available/webdav-fixture.conf
RUN a2enconf webdav-fixture

# Fixture identity, baked at build time — user oltest / Ol-Fixture-Wd7q.
# (bcrypt via htpasswd -cb; verified by the 401/207 gate matrix.)
RUN htpasswd -cb /etc/apache2/webdav.passwd oltest 'Ol-Fixture-Wd7q' \
 && chown www-data:www-data /etc/apache2/webdav.passwd \
 && chmod 640 /etc/apache2/webdav.passwd

# BUILD GATE: full config must parse against this exact package set
RUN apache2ctl configtest

USER root
VOLUME ["/var/www/dav"]

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD curl -fsS -o /dev/null -u oltest:Ol-Fixture-Wd7q -X PROPFIND -H 'Depth: 0' http://127.0.0.1/ || exit 1

CMD ["apachectl", "-DFOREGROUND"]
