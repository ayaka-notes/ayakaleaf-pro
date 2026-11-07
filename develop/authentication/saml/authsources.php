<?php

// The password is the username
$config = [
    'admin' => ['core:AdminPassword'],

    'example-userpass' => [
        'exampleauth:UserPass',
        'users' => [
            'saml_alice:saml_alice' => [
                'uid' => ['saml_alice'],
                'email' => ['saml_alice@example.com'],
                'givenName' => ['Alice'],
                'sn' => ['SAML'],
            ],
            'saml_bob:saml_bob' => [
                'uid' => ['saml_bob'],
                'email' => ['saml_bob@example.com'],
                'givenName' => ['Bob'],
                'sn' => ['SAML'],
            ],
            'saml_carol:saml_carol' => [
                'uid' => ['saml_carol'],
                'email' => ['saml_carol@example.com'],
                'givenName' => ['Carol'],
                'sn' => ['SAML'],
            ],
        ],
    ],
];
