/**
 * The Site Settings page — one section per tab, in the order of the
 * backend's SECTION_ORDER (services/web/app/src/Features/SiteSettings/
 * SiteSettingsManager.mjs). Every key below must exist in the backend's
 * SECTION_ENV_FIELDS (checked by the unit test
 * site-settings-consistency.test.mjs), and the mirrored environment
 * variable is shown under each field by the backend's `envFields`.
 *
 * Field types:
 *  - switch     boolean
 *  - text       string
 *  - password   secret string (masked; empty = keep the stored value)
 *  - number     integer (or ms/s as the field name says)
 *  - textarea   long string (regexes, PEM material, flags)
 *  - stringlist comma-separated list (stored as an array)
 *  - images     rows of { image, name }
 */

export type FieldType =
  | 'switch'
  | 'text'
  | 'password'
  | 'number'
  | 'textarea'
  | 'stringlist'
  | 'images'

export type FieldSpec = {
  key: string
  label: string
  type: FieldType
  hint?: string
  required?: boolean
  placeholder?: string
}

export type SectionMeta = {
  title: string
  description: string
  fields: FieldSpec[]
}

export const SECTIONS_META: Record<string, SectionMeta> = {
  'sandboxed-compiles': {
    title: 'Sandboxed compiles',
    description:
      'Docker-based compilation (the docker-runner inside CLSI). Applies to the web and clsi services.',
    fields: [
      {
        key: 'enabled',
        label: 'Enable sandboxed compiles',
        type: 'switch',
      },
      {
        key: 'dockerRunner',
        label: 'Use the docker runner',
        type: 'switch',
      },
      {
        key: 'defaultImage',
        label: 'Default TeX Live image',
        type: 'text',
        hint: 'The image used for compiles when a project has no override.',
        placeholder: 'texlive/texlive:latest-full',
      },
      {
        key: 'images',
        label: 'Available images',
        type: 'images',
        hint: 'The table of images offered to projects.',
      },
      {
        key: 'imageUser',
        label: 'Image user',
        type: 'text',
        hint: 'The user the compile runs as inside the image (empty = the image default).',
      },
      {
        key: 'hostDir',
        label: 'Compile host directory',
        type: 'text',
        hint: 'Mounted into the container for compiles (SANDBOXED_COMPILES_HOST_DIR).',
      },
      {
        key: 'socketPath',
        label: 'Docker socket path',
        type: 'text',
        hint: 'The docker socket sibling containers connect to (DOCKER_SOCKET_PATH).',
      },
      {
        key: 'extraFlags',
        label: 'Extra docker flags',
        type: 'text',
        hint: 'Additional flags passed to the compile containers (TEX_COMPILER_EXTRA_FLAGS).',
      },
      {
        key: 'compileBodySizeLimitMb',
        label: 'Compile body size limit (MB)',
        type: 'number',
        hint: 'Maximum request body size of compile submissions (COMPILE_BODY_SIZE_LIMIT_MB).',
      },
      {
        key: 'compileSizeLimit',
        label: 'Compile size limit',
        type: 'text',
        hint: 'Maximum total size of a compile (COMPILE_SIZE_LIMIT, e.g. 7mb).',
      },
      {
        key: 'texliveOpenoutAny',
        label: 'Allow \\openout to any file',
        type: 'switch',
        hint: 'TEXLIVE_OPENOUT_ANY — relaxes the TeX \\openout restriction.',
      },
      {
        key: 'texliveMaxPrintLine',
        label: 'TeX \\showmaxprint line limit',
        type: 'number',
        hint: 'TEXLIVE_MAX_PRINT_LINE — caps the length of \\showoutput lines.',
      },
    ],
  },

  conversions: {
    title: 'Conversions',
    description:
      'Document conversion engines (pandoc, PDF, PNG→PDF) in CLSI / the document updater.',
    fields: [
      {
        key: 'pandocEnabled',
        label: 'Enable pandoc conversions',
        type: 'switch',
        hint: 'Word/Markdown download and new-project import (ENABLE_PANDOC_CONVERSIONS).',
      },
      {
        key: 'pdfConversions',
        label: 'Enable PDF conversions',
        type: 'switch',
        hint: 'ENABLE_PDF_CONVERSIONS (CLSI).',
      },
      {
        key: 'png2pdfConversions',
        label: 'Enable PNG→PDF conversion',
        type: 'switch',
        hint: 'ENABLE_PNG2PDF_CONVERSIONS (CLSI).',
      },
      {
        key: 'conversionTimeoutSeconds',
        label: 'Conversion timeout (seconds)',
        type: 'number',
        hint: 'CLSI_CONVERSION_TIMEOUT_SECONDS.',
      },
    ],
  },

  'git-integration': {
    title: 'Git integration',
    description: 'The git-bridge service: git push/pull for projects.',
    fields: [
      { key: 'enabled', label: 'Enable git integration', type: 'switch' },
      {
        key: 'host',
        label: 'Git bridge host',
        type: 'text',
        hint: 'GIT_BRIDGE_HOST (compose service name or address).',
      },
      { key: 'port', label: 'Git bridge port', type: 'number' },
    ],
  },

  'github-sync': {
    title: 'GitHub sync',
    description: 'The GitHub OAuth app behind the GitHub sync integration.',
    fields: [
      { key: 'enabled', label: 'Enable GitHub sync', type: 'switch' },
      {
        key: 'clientId',
        label: 'OAuth client ID',
        type: 'text',
        hint: 'GITHUB_SYNC_CLIENT_ID.',
      },
      {
        key: 'clientSecret',
        label: 'OAuth client secret',
        type: 'password',
        hint: 'Encrypted at rest. Leave empty to keep the stored secret.',
      },
      {
        key: 'cipherFile',
        label: 'Token cipher file',
        type: 'text',
        hint: 'GITHUB_TOKEN_CIPHER_FILE.',
      },
      {
        key: 'cipherLabel',
        label: 'Token cipher label',
        type: 'text',
        hint: 'GITHUB_TOKEN_CIPHER_LABEL.',
      },
    ],
  },

  dropbox: {
    title: 'Dropbox',
    description: 'The Dropbox connector (linked files and sync).',
    fields: [
      { key: 'enabled', label: 'Enable Dropbox', type: 'switch' },
      { key: 'appKey', label: 'App key', type: 'text', hint: 'DROPBOX_APP_KEY.' },
      {
        key: 'appSecret',
        label: 'App secret',
        type: 'password',
        hint: 'Encrypted at rest. Leave empty to keep the stored secret.',
      },
      {
        key: 'apiDomain',
        label: 'API domain',
        type: 'text',
        hint: 'DROPBOX_API_DOMAIN (the Dropbox API endpoint).',
      },
    ],
  },

  email: {
    title: 'Email',
    description:
      'SMTP/SES transport and the site mail addresses (the web + notifications services).',
    fields: [
      {
        key: 'enableOnboardingEmails',
        label: 'Send onboarding emails',
        type: 'switch',
        hint: 'ENABLE_ONBOARDING_EMAILS.',
      },
      {
        key: 'skipConfirmation',
        label: 'Skip email confirmation',
        type: 'switch',
        hint: 'New accounts work without a confirmation email (EMAIL_CONFIRMATION_DISABLED).',
      },
      {
        key: 'driver',
        label: 'Driver',
        type: 'text',
        hint: '"smtp" or "ses".',
      },
      { key: 'host', label: 'SMTP host', type: 'text', hint: 'OVERLEAF_EMAIL_SMTP_HOST.' },
      { key: 'port', label: 'SMTP port', type: 'number', hint: 'OVERLEAF_EMAIL_SMTP_PORT.' },
      { key: 'secure', label: 'TLS (secure)', type: 'switch', hint: 'OVERLEAF_EMAIL_SMTP_SECURE.' },
      { key: 'ignoreTLS', label: 'Ignore TLS issues', type: 'switch', hint: 'OVERLEAF_EMAIL_SMTP_IGNORE_TLS.' },
      { key: 'name', label: 'Sender name', type: 'text', hint: 'OVERLEAF_EMAIL_SMTP_NAME.' },
      { key: 'user', label: 'SMTP user', type: 'text', hint: 'OVERLEAF_EMAIL_SMTP_USER.' },
      {
        key: 'pass',
        label: 'SMTP password',
        type: 'password',
        hint: 'Encrypted at rest. Leave empty to keep the stored password.',
      },
      { key: 'accessKeyId', label: 'SES access key ID', type: 'text' },
      {
        key: 'sesSecret',
        label: 'SES secret key',
        type: 'password',
        hint: 'Encrypted at rest. Leave empty to keep the stored key.',
      },
      { key: 'sesRegion', label: 'SES region', type: 'text' },
      {
        key: 'fromAddress',
        label: 'From address',
        type: 'text',
        hint: 'OVERLEAF_EMAIL_FROM_ADDRESS.',
      },
      { key: 'replyTo', label: 'Reply-to address', type: 'text' },
      { key: 'adminEmail', label: 'Admin contact email', type: 'text' },
      { key: 'customFooter', label: 'Custom email footer', type: 'textarea' },
    ],
  },

  'linked-file-types': {
    title: 'Linked file types',
    description:
      'Which file types can be attached as links (core + the modules present in this build).',
    fields: [
      {
        key: 'enabledTypes',
        label: 'Enabled types',
        type: 'stringlist',
        hint:
          'Comma-separated. project_file and project_output_file are always on. Known here: project_file, project_output_file, url, dropbox.',
      },
    ],
  },

  externalUrl: {
    title: 'External URLs',
    description: 'The linked-URL proxy (import and open of external URLs).',
    fields: [
      {
        key: 'blockedNetworks',
        label: 'Blocked networks',
        type: 'stringlist',
        hint:
          'Comma-separated IPs / CIDRs the proxy must never reach (private ranges by default).',
      },
      {
        key: 'allowedResourcesRegex',
        label: 'Allowed resources regex',
        type: 'textarea',
        hint: 'OVERLEAF_LINKED_URL_ALLOWED_RESOURCES — a regex over the target URL ("" = default policy).',
      },
    ],
  },

  templates: {
    title: 'Templates',
    description: 'The template gallery.',
    fields: [
      { key: 'enabled', label: 'Enable the template gallery', type: 'switch' },
      {
        key: 'nonAdminCanPublishTemplates',
        label: 'Non-admins can publish templates',
        type: 'switch',
      },
    ],
  },

  'sso-saml': {
    title: 'SSO · SAML',
    description:
      'SAML single sign-on parameters (the authentication module). Enabling the provider itself is a deployment decision (EXTERNAL_AUTH); here you manage the values it reads.',
    fields: [
      { key: 'issuer', label: 'Issuer', type: 'text', hint: 'The IdP issuer URL.' },
      { key: 'entryPoint', label: 'Entry point', type: 'text', hint: 'OVERLEAF_SAML_ENTRYPOINT — the IdP login URL.' },
      {
        key: 'idpCert',
        label: 'IdP certificate (PEM)',
        type: 'textarea',
        hint: 'Encrypted at rest. Required to enable SAML unless OVERLEAF_SAML_IDP_CERT is set.',
      },
      {
        key: 'privateKey',
        label: 'SP private key (PEM)',
        type: 'textarea',
        hint: 'Encrypted at rest.',
      },
      {
        key: 'decryptionPvk',
        label: 'Assertion decryption key (PEM)',
        type: 'textarea',
        hint: 'Encrypted at rest. Only when encrypted assertions are used.',
      },
    ],
  },

  'sso-oidc': {
    title: 'SSO · OIDC',
    description:
      'OpenID Connect single sign-on parameters (the authentication module). Enabling the provider itself is a deployment decision (EXTERNAL_AUTH); here you manage the values it reads.',
    fields: [
      { key: 'issuer', label: 'Issuer', type: 'text' },
      { key: 'clientID', label: 'Client ID', type: 'text', hint: 'OVERLEAF_OIDC_CLIENT_ID.' },
      {
        key: 'clientSecret',
        label: 'Client secret',
        type: 'password',
        hint: 'Encrypted at rest. Leave empty to keep the stored secret.',
      },
      { key: 'authorizationURL', label: 'Authorization URL', type: 'text' },
      { key: 'tokenURL', label: 'Token URL', type: 'text' },
    ],
  },

  'sso-ldap': {
    title: 'SSO · LDAP',
    description:
      'LDAP authentication parameters (the authentication module). Enabling the provider itself is a deployment decision (EXTERNAL_AUTH); here you manage the values it reads.',
    fields: [
      { key: 'url', label: 'Server URL', type: 'text', hint: 'ldapi(s)://… (OVERLEAF_LDAP_URL).' },
      { key: 'searchBase', label: 'Search base (base DN)', type: 'text' },
      { key: 'bindDN', label: 'Bind DN', type: 'text' },
      {
        key: 'bindCredentials',
        label: 'Bind credentials',
        type: 'password',
        hint: 'Encrypted at rest. Leave empty to keep the stored credentials.',
      },
      { key: 'searchFilter', label: 'Search filter', type: 'text' },
    ],
  },

  editor: {
    title: 'Editor limits',
    description:
      'Size and pattern limits across the web, docstore, real-time and CLSI services.',
    fields: [
      {
        key: 'additionalTextExtensions',
        label: 'Additional text extensions',
        type: 'stringlist',
        hint: 'Comma-separated file extensions treated as text (ADDITIONAL_TEXT_EXTENSIONS).',
      },
      {
        key: 'fileIgnorePattern',
        label: 'File ignore pattern',
        type: 'text',
        hint: 'FILE_IGNORE_PATTERN (web) — files matching this are ignored by some operations.',
      },
      {
        key: 'preciousFilePattern',
        label: 'Precious file pattern',
        type: 'text',
        hint: 'PRECIOUS_FILE_PATTERN (CLSI) — files that must never be deleted by compiles.',
      },
      {
        key: 'maxDocLength',
        label: 'Maximum document length (chars)',
        type: 'number',
        hint: 'MAX_DOC_LENGTH (docstore).',
      },
      {
        key: 'maxJsonRequestSize',
        label: 'Maximum JSON request size (bytes)',
        type: 'number',
        hint: 'MAX_JSON_REQUEST_SIZE (web).',
      },
      {
        key: 'maxUpdateSize',
        label: 'Maximum update size (bytes)',
        type: 'number',
        hint: 'MAX_UPDATE_SIZE (real-time).',
      },
      {
        key: 'commentMentionDelayMs',
        label: 'Comment mention delay (ms)',
        type: 'number',
        hint: 'COMMENT_MENTION_DELAY_MS (web).',
      },
    ],
  },

  security: {
    title: 'Security',
    description: 'Login, cross-origin and CSP behavior of the web + real-time services.',
    fields: [
      {
        key: 'adminOnlyLogin',
        label: 'Admins-only login',
        type: 'switch',
        hint: 'ADMIN_ONLY_LOGIN — only site admins can log in (maintenance mode).',
      },
      {
        key: 'blockCrossOriginRequests',
        label: 'Block cross-origin requests',
        type: 'switch',
        hint: 'BLOCK_CROSS_ORIGIN_REQUESTS (web).',
      },
      {
        key: 'allowedOrigins',
        label: 'Allowed origins',
        type: 'text',
        hint: 'ALLOWED_ORIGINS (web) — comma-separated origins.',
      },
      {
        key: 'realTimeAllowedCorsOrigins',
        label: 'Real-time CORS origins',
        type: 'text',
        hint: 'REAL_TIME_ALLOWED_CORS_ORIGINS (the real-time service).',
      },
      { key: 'cspEnabled', label: 'Enable CSP', type: 'switch', hint: 'CSP_ENABLED (web).' },
      {
        key: 'cspReportOnly',
        label: 'CSP report-only mode',
        type: 'switch',
        hint: 'CSP_REPORT_ONLY (web).',
      },
      { key: 'cspReportUri', label: 'CSP report URI', type: 'text', hint: 'CSP_REPORT_URI (web).' },
      {
        key: 'elevatedAccountSecurityAfterFailedLoginMs',
        label: 'Elevated security after failed logins (ms)',
        type: 'number',
        hint: 'ELEVATED_ACCOUNT_SECURITY_AFTER_FAILED_LOGIN_MS (web) — 0 = off.',
      },
    ],
  },

  sharing: {
    title: 'Sharing & access',
    description: 'Who can see what, and for how long (web + filestore services).',
    fields: [
      {
        key: 'allowPublicAccess',
        label: 'Allow public access',
        type: 'switch',
        hint: 'OVERLEAF_ALLOW_PUBLIC_ACCESS — projects can be shared publicly.',
      },
      {
        key: 'allowAnonymousReadWriteSharing',
        label: 'Anonymous read/write sharing',
        type: 'switch',
        hint: 'OVERLEAF_ALLOW_ANONYMOUS_READ_AND_WRITE_SHARING.',
      },
      {
        key: 'disableLinkSharing',
        label: 'Disable link sharing',
        type: 'switch',
        hint: 'OVERLEAF_DISABLE_LINK_SHARING.',
      },
      { key: 'disableChat', label: 'Disable chat', type: 'switch', hint: 'OVERLEAF_DISABLE_CHAT.' },
      {
        key: 'linkExpiryTimeout',
        label: 'Link expiry timeout (ms)',
        type: 'number',
        hint: 'LINK_EXPIRY_TIMEOUT (filestore) — shared-link lifetime; 0 = no expiry.',
      },
    ],
  },

  misc: {
    title: 'Miscellaneous',
    description: 'App name, deletion delays, caches and the rest of the site behavior.',
    fields: [
      { key: 'appName', label: 'App name', type: 'text', hint: 'APP_NAME — the name shown to users.' },
      {
        key: 'navHidePoweredBy',
        label: 'Hide "Powered by" in the nav',
        type: 'switch',
        hint: 'NAV_HIDE_POWERED_BY.',
      },
      { key: 'robotsNoindex', label: 'Noindex for robots', type: 'switch', hint: 'ROBOTS_NOINDEX.' },
      {
        key: 'projectHardDeletionDelayMs',
        label: 'Project hard-deletion delay (ms)',
        type: 'number',
        hint: 'OVERLEAF_PROJECT_HARD_DELETION_DELAY (90 days = 7776000000).',
      },
      {
        key: 'userHardDeletionDelayMs',
        label: 'User hard-deletion delay (ms)',
        type: 'number',
        hint: 'OVERLEAF_USER_HARD_DELETION_DELAY (90 days = 7776000000).',
      },
      {
        key: 'historyRestore',
        label: 'Allow history restore',
        type: 'switch',
        hint: 'OVERLEAF_HISTORY_RESTORE.',
      },
      {
        key: 'enablePdfCaching',
        label: 'Enable PDF caching',
        type: 'switch',
        hint: 'ENABLE_PDF_CACHING.',
      },
      {
        key: 'maxUploadSizeMb',
        label: 'Maximum upload size (MB)',
        type: 'number',
        hint: 'MAX_UPLOAD_SIZE.',
      },
      {
        key: 'maxEntitiesPerProject',
        label: 'Maximum entities per project',
        type: 'number',
        hint: 'MAX_ENTITIES_PER_PROJECT.',
      },
      {
        key: 'defaultLatexCompiler',
        label: 'Default LaTeX compiler',
        type: 'text',
        hint: 'DEFAULT_LATEX_COMPILER (e.g. pdflatex, lualatexmk).',
      },
      {
        key: 'projectChangeNotificationDelayMs',
        label: 'Project-change notification delay (ms)',
        type: 'number',
        hint: 'PROJECT_CHANGE_NOTIFICATION_MIN_DELAY_MS.',
      },
      {
        key: 'archiveOnSoftDelete',
        label: 'Archive on soft delete',
        type: 'switch',
        hint: 'ARCHIVE_ON_SOFT_DELETE (docstore).',
      },
      {
        key: 'keepSoftDeletedDocsArchived',
        label: 'Keep soft-deleted docs archived',
        type: 'switch',
        hint: 'KEEP_SOFT_DELETED_DOCS_ARCHIVED (docstore).',
      },
    ],
  },

  services: {
    title: 'Service URLs',
    description: 'Where the web reaches the supporting services.',
    fields: [
      { key: 'v1HistoryUrl', label: 'v1 history service URL', type: 'text', hint: 'V1_HISTORY_URL (web).' },
      { key: 'wikiUrl', label: 'Wiki URL', type: 'text', hint: 'WIKI_URL (web).' },
    ],
  },
}
