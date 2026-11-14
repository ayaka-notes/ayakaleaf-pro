# IdP config for the OIDF conformance stack only

Pinned `Issuer` = `https://oidc-idp-tls:8446` (the self-signed TLS front in
`../nginx/nginx.conf`). The suite + its HTMLUnit must reach the IdP by that
exact hostname; IdentityServer would otherwise derive the issuer from the
request's Host/scheme (plain http in the docker network → rejected by the
suite's required-https check).

clients.json/users.json mirror `../oidc/config/` (test user ssoe2e /
SsoE2ePass123, admin claim user ssoadm / SsoAdmPass123).
