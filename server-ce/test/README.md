# E2E tests

These tests install Overleaf Pro the same way a user would (with the
[toolkit](https://github.com/ayaka-notes/toolkit)), then click through it in a
browser with Cypress.

CI runs them daily against the latest ops image, one suite per runner
(`.github/workflows/test_ops_image.yml`). It can also be started by hand with
another ops tag.

## How to run

Go to `server-ce/test/toolkit` and run:

```sh
make setup SUITE=launchpad   # install and start Overleaf
make test_launchpad          # run the launchpad tests
make clean                   # remove everything again
```

Run `make clean` before you set up for another suite, every suite starts
from an empty Overleaf.

If port 80 is already in use on your machine, add `OVERLEAF_PORT=8080` to
`make setup`. To test an image other than the latest ops image, add
`OVERLEAF_IMAGE=<image>`.

The E2E settings disable request rate limits. The login-register suite sets
`E2E_DISABLE_RATE_LIMITS=false` because it also tests registration rate limiting.

## Suites

One folder per module in `toolkit/suites/`, named and nested like
`services/web/modules`:

- `launchpad/` – creating the first admin, status checks, admin adds a user.
- `login-register/` – login, logout and public sign up with email and
  password. The `domain/` variant runs afterwards with sign up restricted to
  one email domain.
- `sandboxed-compiles/` – compiling in sibling containers, switching between
  two TeX Live images, XeLaTeX, errors, stopping a compile, SyncTeX.
- `symbol-palette/` – opening and closing the palette, switching categories
  by click and keyboard, searching by command, description and character,
  empty search results, inserting symbols by click and keyboard at the editor
  cursor, the tooltip. Draw mode: switching to the canvas and back,
  recognising drawn symbols with the bundled model, inserting a result and
  clearing the canvas.
- `track-changes/` – editing, reviewing and viewing modes, tracked insertions
  and deletions, accepting and rejecting them, comments (reply, edit, delete,
  resolve, re-open), and which routes owners, editors, reviewers, viewers,
  link viewers and other users may call.
- `git-bridge/` – git tokens in the settings, cloning, pushing and pulling
  with the git CLI: binary files, folders, renames, deletes, out-of-date
  pushes, and access for invited and link-shared editors, reviewers and
  viewers.
- `oauth2-server/` – the Git authentication tokens in the settings: generating,
  the token shown once, the table with its dates and last use, cancelling and
  deleting, the 10 token limit, and the API behind it: one year validity, no
  secrets in the list, `/oauth/token/info` for git-bridge, logins and other
  users' tokens. Git-bridge is on, the settings only show the tokens with it.
- `open-in-overleaf/` – the `/docs` endpoint: snippets, encoded snippets,
  data URLs with names, main document and engine, zips, refused and internal
  URLs, the login for signed-out visitors, and the `/devs` page. The
  `public-access/` variant tests `/devs` and parking a signed-out post until
  the login with `OVERLEAF_ALLOW_PUBLIC_ACCESS=true`.
- `learn/` – the wiki proxy under `/learn`: the home page and its contents
  sidebar, LaTeX and how-to pages, links and images in pages, redirects,
  missing pages, the login for signed-out visitors, and the Documentation
  links in the header, the welcome message and the editor's Help menu.
  Pages come from the public Overleaf wiki, so this suite needs internet
  access and starts slower.
- `python-runner/` – running `.py` files with the self-hosted Pyodide: output
  and the last value, stderr, Python and syntax errors, packages that are not
  built in, built-in packages from the instance, reading project files,
  unsaved edits, the 100-line output cap, stopping a script, an output per
  script, saving written and binary files, overwriting, the 50-file limit,
  and viewers.
- `reference-picker/` – the advanced reference search over the project's
  `.bib` files: the hint inside `\cite{}`, opening it with the hint and
  Ctrl+Space, searching every field, inserting, adding to and replacing cite
  keys, removing tags, the keyboard, cancelling, and the usual autocomplete
  outside a cite argument.
- `github-sync/` – GitHub Sync against `toolkit/services/github-mock`: linking
  and unlinking the GitHub account through the OAuth app, exporting a project
  into a new repository, importing a repository, unlinking a project, pulling,
  pushing, merging, conflicts and the manual merge, renames and deletes,
  binary files, force pushes, lost push access, and what collaborators may
  do. Git-bridge is on as the docs require.
- `tpr-webmodule/` – Zotero and Mendeley against `toolkit/services/tpr-mock`:
  linking and unlinking through OAuth 1.0a (Zotero, with its signatures
  checked) and OAuth 2.0 (Mendeley), cancelled and refused links, forged
  callbacks, importing a library or a group from every page, refreshing,
  the reference search, Mendeley's token refresh, revoked keys and tokens,
  API errors, and what editors and viewers may do.
- `workbench/` – the AI assistant against `toolkit/services/ai-mock`:
  answers with the instance's model and the editor context, reasoning,
  browser tools and their results, approving, rejecting and undoing edits,
  edits whose text changed, web search through Tavily, documentation search
  through MCP, images and the image model, the tool call limit, gateway
  errors, the consent prompt, the token quota and its reset by an admin, AI
  turned off for a user, and the chat endpoint's checks. The `disabled/`
  variant runs with `AI_ENABLED=false`.
- `error-assistant/` – Suggest fix on compile errors against
  `toolkit/services/ai-mock`: the prompt with the error and the source,
  applying a fix and the recompile, unsaved edits, changed lines, another
  fix, feedback, no fix, invalid tool calls, gateway errors, the consent
  prompt, the token quota, AI turned off for a user, and who may call the
  endpoint. The `disabled/` variant runs with `AI_ENABLED=false`.
- `instance-features/` – `/system/features` and the UI that hides itself
  with it: AI assistant, GitHub Sync, Zotero and Mendeley, all off on the
  default instance and all on in the `enabled/` variant, with git-bridge,
  which GitHub Sync needs.
- `admin-tools/` – the admin panel: who may open it, finding users by
  email and id, creating accounts and activating them with the link from
  Info, duplicate emails, changing names, emails, passwords and the admin
  flag, the collaborator limit, turning AI off and the token usage,
  disabling and enabling users one by one and in bulk, deleting accounts with
  and without giving their projects to another user, restoring and purging
  them, and the license tab. For projects: a user's projects and every
  project, search by name, id and owner, trashing, deleting, restoring,
  purging and downloading, and changing the owner of one or several projects,
  with the old owner kept as editor.
- `template-gallery/` – publishing a project as a template, the gallery
  (categories, search, sort, pages), editing, overwriting and deleting
  templates, creating projects from them, permissions.
- `authentication/ldap/`, `authentication/saml/`, `authentication/oidc/` –
  login through [goauthentik](https://goauthentik.io), admin mapping and its
  updates on login. LDAP and SAML start with the launchpad's email-only admin
  form on the empty instance. Each has a variant without admin mapping, OIDC
  one with allowed email domains too. These are separate suites, run them
  with `make setup SUITE=authentication/saml` and
  `make test SUITE=authentication/saml`.

Things that need email (activation mails, password reset) are not tested.

## What is where

- `toolkit/suites/` – the tests, see above.
- `toolkit/config/` – settings every suite uses, written into the toolkit's
  `config/overleaf.rc` and `config/variables.env`.
- `toolkit/suites/<name>/overleaf.rc`, `variables.env` – optional extra
  settings for just that suite, applied after `toolkit/config/`.
- `toolkit/suites/<name>/<variant>/` – optional second mode of the same
  module: its own specs plus the settings that differ. `make test_<name>`
  applies them, restarts Overleaf and runs the variant after the main specs.
- `helpers/` – small functions shared by tests, like logging in or creating
  a user or a project.
- `toolkit/services/` – extra containers a suite needs, e.g. `authentik/`, or
  the mocks of external services: `github-mock/` answers as github.com and
  api.github.com, `tpr-mock/` as Zotero and Mendeley, `ai-mock/` as the OpenAI-compatible
  gateway, Tavily and the documentation's MCP endpoint, on the toolkit's network
  with a throwaway CA that Overleaf is told to trust. `lib/` holds what the
  mocks share: the server plumbing, `make-tls` and `start-mock`.
  A suite lists them in its `services` file. `make setup` starts them next to
  Overleaf on the toolkit's network, `make clean` removes them. Their secrets
  are generated on every setup, none are stored in the repository.
- `toolkit/bin/` – scripts used by the Makefile.
- `toolkit/Makefile` – the `setup`, `test_<name>` and `clean` commands.
- Everything else (`Dockerfile.cypress`, `cypress.config.ts`,
  `package.json`, ...) is plumbing you normally don't touch.

## Adding tests for a new module

1. Make a folder `toolkit/suites/<name>/` and put `*.spec.ts` files in it.
2. Need special settings? Add `overleaf.rc` or `variables.env` in that folder
   with only the lines you want to change.
3. The tests must not rely on other suites, each one runs on its own fresh
   instance. Create users with `ensureUserExists` from `helpers/users.ts`.
4. `make setup SUITE=<name>`, then `make test_<name>`.
5. Add `<name>` to the `e2e-test` matrix in `test_ops_image.yml`.
