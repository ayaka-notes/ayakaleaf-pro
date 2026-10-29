<?php

// Overleaf in the dev env; its site URL is PUBLIC_URL from dev.env
$siteUrl = rtrim(getenv('PUBLIC_URL') ?: 'http://127.0.0.1:3000', '/');

$metadata['ayakaleaf-dev'] = [
    'AssertionConsumerService' => [
        [
            'index' => 0,
            'Binding' => 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
            'Location' => $siteUrl . '/saml/login/callback',
        ],
    ],
    'SingleLogoutService' => [
        [
            'Binding' => 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
            'Location' => $siteUrl . '/saml/logout/callback',
        ],
    ],
    'NameIDFormat' => 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    'saml20.sign.response' => true,
    'authproc' => [
        10 => [
            'class' => 'saml:AttributeNameID',
            'identifyingAttribute' => 'email',
            'Format' => 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        ],
    ],
];
