FROM debian:trixie-slim

ARG SIMPLESAMLPHP_VERSION=2.5.3.1
ARG SIMPLESAMLPHP_SHA256=b199ebcba6e30220e7b5df2783ca42f8947dd9bdf046e9e6302fef3d3a438d01

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    php-cli php-xml php-mbstring php-curl php-intl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o /tmp/simplesamlphp.tar.gz \
    https://github.com/simplesamlphp/simplesamlphp/releases/download/v${SIMPLESAMLPHP_VERSION}/simplesamlphp-${SIMPLESAMLPHP_VERSION}-full.tar.gz \
  && echo "${SIMPLESAMLPHP_SHA256}  /tmp/simplesamlphp.tar.gz" | sha256sum -c - \
  && mkdir /var/simplesamlphp \
  && tar xzf /tmp/simplesamlphp.tar.gz -C /var/simplesamlphp --strip-components=1 \
  && rm /tmp/simplesamlphp.tar.gz \
  # Overleaf colors instead of the red theme: $neutral-90, $green-50, $green-60
  && sed -i \
    -e 's/linear-gradient(141deg, #b8002c 0%, #db0100 51%, #e8410c 75%)/#1b222c/g' \
    -e 's/#db0100/#098842/g; s/#e8410c/#1e6b41/g; s/#b8002c/#1e6b41/g' \
    /var/simplesamlphp/public/assets/base/css/stylesheet.css \
  && mkdir -p /srv/www /var/cache/simplesamlphp \
  && chown www-data /var/cache/simplesamlphp \
  && ln -s /var/simplesamlphp/public /srv/www/simplesaml

COPY config.php authsources.php /var/simplesamlphp/config/
COPY saml20-idp-hosted.php saml20-sp-remote.php /var/simplesamlphp/metadata/
COPY idp.crt idp.key /var/simplesamlphp/cert/

USER www-data
EXPOSE 4000
CMD ["php", "-S", "0.0.0.0:4000", "-t", "/srv/www"]
