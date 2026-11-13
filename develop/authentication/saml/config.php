<?php

// The upstream defaults, with the IdP and the test users turned on
require __DIR__ . '/config.php.dist';

$config = array_merge($config, [
    // Served under the dev site: webpack forwards /simplesaml to this service
    'baseurlpath' => rtrim(getenv('PUBLIC_URL') ?: 'http://127.0.0.1:3000', '/') . '/simplesaml/',
    'session.cookie.secure' => false,
    'session.cookie.samesite' => 'Lax',
    'secretsalt' => 'ayakaleaf-dev',
    'auth.adminpassword' => 'admin',
    'timezone' => 'UTC',
    'logging.handler' => 'errorlog',
    'logging.format' => '%level %msg',
    'enable.saml20-idp' => true,
    'module.enable' => [
        'core' => true,
        'admin' => true,
        'saml' => true,
        'exampleauth' => true,
    ],
]);
