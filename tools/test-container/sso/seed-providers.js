// seed-providers.js — seed an ENABLED SSO provider pair (OIDC + SAML) for the
// live positive-leg proof (fedgap-2 closure; owner authorized the seeded provider,
// 2026-10-06). IdPs: tests/tools/sso-test (soluto OIDC :8081, boxyhq SAML :4100).
// Run:
//   docker cp tests/tools/sso-test/seed-providers.js ol-e2e-mongo-1:/tmp/seed.js
//   docker exec ol-e2e-mongo-1 mongosh sharelatex --quiet /tmp/seed.js
const cert = "-----BEGIN CERTIFICATE-----\nMIIDPTCCAiWgAwIBAgIUI50Zx2eCPqJN4aV972BPO7yvAPkwDQYJKoZIhvcNAQEL\nBQAwLjEZMBcGA1UEAwwQc2FtbC5leGFtcGxlLmNvbTERMA8GA1UECgwIT2xsaVRl\nc3QwHhcNMjYxMDAyMTIxMjMxWhcNMzYwOTI5MTIxMjMxWjAuMRkwFwYDVQQDDBBz\nYW1sLmV4YW1wbGUuY29tMREwDwYDVQQKDAhPbGxpVGVzdDCCASIwDQYJKoZIhvcN\nAQEBBQADggEPADCCAQoCggEBAMMA+opgaZFuJc2EIrHWDKknDWvO8trX4XipWKFH\nyn/RH0MHjvnebOgN18a0BMZAHIFt6faVhU0R6CUMCx40oCTZBAdogzgI9qijXKvT\nOPsSoqu/K0XG+88eKTAl41HZpoKcwJZ2AXT4Mge2TK+ZDpfHsPaaoqx9tZTksDHp\n6TzsfR5B+PBg9x3HGbmG0DlI1p4VLK8tO/dnInZK6b6h2xKAwC11QwfVc+xYT3VR\nlTyN4qVJSdt1PniRZMnrzsg68bndklCLyLXLmHFgwLDqi1nRgDk/1Wc0e5Gu3r0s\nhLhvchGVPSuxZsLSvlQhecqVIDigQWKE9dEwBvSctTof3wcCAwEAAaNTMFEwHQYD\nVR0OBBYEFOQtJKshVyOvwT7lwiJlENSTFeAMMB8GA1UdIwQYMBaAFOQtJKshVyOv\nwT7lwiJlENSTFeAMMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEB\nAHqSF2JUxPtAY5FCm2tR01ReWfnT31xTMYcqZnuIwLJVGVAz8gB0Hkw1NnhCoxCp\naFRj1lHA/tTcjSH4N4GKl3jYhPTowmLvihnHV+23aOy70OXx6ir58b3SkFlWkShp\nOCW34h6GE2ZFmT8f22eUFMsb2UJFQI53eDhMC5+Pv0xYEHwbI96+KMAgPEk834bS\nMJSizzmeVtV0Zj2qpeT9lTIeVrdy+DVk2CcFy1Hvl+Jx/ui0oBrqXlyFvG75vFmP\nO42gJ9R4G/ExHaHSAgpw/W/ZoB3DIFxuhHHb5hUL6MMYcoWIs1Wd1SoaM/wRQt9r\nhSpWwYCnosNyTC0FoLb1vJg=\n-----END CERTIFICATE-----\n";
const doc = {
  _id: 'sso-settings',
  updatedAt: Date.now(),
  providers: [
    {
      id: 'sso-oidc-e2e', name: 'OlliTeX OIDC (E2E)', type: 'oidc', enabled: true, order: 1,
      identityServiceName: 'OlliTeX E2E SSO',
      issuer: 'http://172.20.0.1:8081',
      authorizationURL: 'http://172.20.0.1:8081/connect/authorize',
      tokenURL: 'http://172.20.0.1:8081/connect/token',
      userInfoURL: 'http://172.20.0.1:8081/connect/userinfo',
      clientID: 'overleaf_test', clientSecret: 'SOMEPASSWORD', scope: 'openid email profile',
    },
    {
      id: 'sso-saml-e2e', name: 'OlliTeX SAML (E2E)', type: 'saml', enabled: true, order: 2,
      identityServiceName: 'OlliTeX SAML E2E',
      issuer: 'https://saml.example.com/entityid',
      entryPoint: 'http://172.20.0.1:4101/api/saml/sso',
      idpCert: cert,
      wantAssertionsSigned: false, wantAuthnResponseSigned: false,
    },
  ],
};
const r = db.ssoConfigs.updateOne({ _id: 'sso-settings' }, { $set: doc }, { upsert: true });
const cur = db.ssoConfigs.findOne({}, { providers: 1 });
print('seeded providers:', JSON.stringify(cur.providers.map(p => p.id)));
