# OIDC IdP — the standard soluto/oidc-server-mock (dotnet, IdentityServer4-based), with a test
# client (overleaf_test/SOMEPASSWORD) + test users baked in via *_CONFIGURATION_PATH (baking the
# JSON avoids the fragile runtime docker -e). Standard identity resources (openid/email/profile)
# are built-in. Endpoints: /connect/authorize, /connect/token, /connect/userinfo,
# /connect/endsession, discovery /.well-known/openid-configuration, jwks /.well-known/openid-configuration.
FROM soluto/oidc-server-mock:latest
ENV ASPNETCORE_ENVIRONMENT=Development \
    SERVER_OPTIONS_PATH=/config/server-options.json \
    CLIENTS_CONFIGURATION_PATH=/config/clients.json \
    USERS_CONFIGURATION_PATH=/config/users.json
COPY config/ /config/
