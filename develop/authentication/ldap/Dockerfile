FROM debian:bookworm-slim

RUN echo "slapd slapd/domain string planetexpress.com" | debconf-set-selections \
  && echo "slapd shared/organization string Planet Express, Inc." | debconf-set-selections \
  && echo "slapd slapd/password1 password admin" | debconf-set-selections \
  && echo "slapd slapd/password2 password admin" | debconf-set-selections \
  && apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends slapd ldap-utils \
  && rm -rf /var/lib/apt/lists/*

COPY users.ldif /tmp/users.ldif
RUN slapadd -n 1 -l /tmp/users.ldif && chown -R openldap:openldap /var/lib/ldap

EXPOSE 389
CMD ["slapd", "-d", "0", "-h", "ldap:///", "-u", "openldap", "-g", "openldap"]
