import { git, workingCopy } from '../../../helpers/git'
import { login } from '../../../helpers/login'
import {
  createProject,
  openProject,
  projectName,
} from '../../../helpers/project'
import { postWithCsrf, requestWithCsrf } from '../../../helpers/request'
import { shareProject } from '../../../helpers/sharing'
import {
  ADMIN_EMAIL,
  ensureAdminExists,
  ensureUserExists,
} from '../../../helpers/users'

// Gitea Sync against services/gitea, a real Gitea (by default the oldest
// version Gitea Sync supports) at http://gitea:3000 on the toolkit's network.
// The tests prepare and check repositories the way users do: over Gitea's
// API, with the git CLI of the Cypress container, and in Gitea's login page.
// Gitea's access tokens expire within Overleaf's refresh margin, so every
// request of Overleaf refreshes and rotates the token first.

const GITEA_URL = 'http://gitea:3000'
const GITEA_USER = 'e2e-tea'
// A second Gitea user, for the collaborator
const GITEA_COLLABORATOR = 'e2e-cup'
const GITEA_ORG = 'e2e-org'

// File contents for Gitea: text, binary (base64), or null to delete the file
type Change = string | { base64: string } | null

type GiteaCommit = {
  sha: string
  commit: { message: string }
  parents: { sha: string }[]
}

type GiteaPull = {
  number: number
  state: string
  merged: boolean
  head: { ref: string }
  base: { ref: string }
}

function giteaApi(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: object,
  user = GITEA_USER
) {
  return cy.request({
    method,
    url: `${GITEA_URL}/api/v1/${path}`,
    auth: { user, pass: Cypress.env('GITEA_PASSWORD') },
    body,
  })
}

function toBase64(change: Exclude<Change, null>) {
  return typeof change === 'string'
    ? Cypress.Buffer.from(change, 'utf8').toString('base64')
    : change.base64
}

function treePaths(fullName: string, ref: string): Cypress.Chainable<string[]> {
  return giteaApi('GET', `repos/${fullName}/git/trees/${encodeURIComponent(ref)}?recursive=true&per_page=1000`)
    .its('body.tree')
    .then((entries: { path: string; type: string }[]) =>
      entries.filter(e => e.type === 'blob').map(e => e.path)
    )
}

// A commit on a branch of Gitea, like an edit in Gitea's web editor
function commitOnGitea(
  fullName: string,
  changes: Record<string, Change>,
  message: string,
  branch = 'main'
) {
  return treePaths(fullName, branch).then(existing =>
    giteaApi('POST', `repos/${fullName}/contents`, {
      branch,
      message,
      files: Object.entries(changes).map(([path, change]) =>
        change === null
          ? { operation: 'delete', path }
          : {
              operation: existing.includes(path) ? 'update' : 'create',
              path,
              content: toBase64(change),
            }
      ),
    })
  )
}

// A repository of e2e-tea (or of an organization) with an initial commit
function seedRepo(
  name: string,
  files: Record<string, Change>,
  owner = GITEA_USER
) {
  const url = owner === GITEA_USER ? 'user/repos' : `orgs/${owner}/repos`
  giteaApi('POST', url, { name, private: true, auto_init: false })
  return giteaApi('POST', `repos/${owner}/${name}/contents`, {
    branch: 'main',
    message: 'Initial commit',
    files: Object.entries(files).map(([path, change]) => ({
      operation: 'create',
      path,
      content: toBase64(change!),
    })),
  })
}

function repoInfo(fullName: string) {
  return giteaApi('GET', `repos/${fullName}`).its('body')
}

// The files of a branch with their text
function repoFiles(
  fullName: string,
  ref = 'main'
): Cypress.Chainable<Record<string, string>> {
  const files: Record<string, string> = {}
  return treePaths(fullName, ref)
    .then(paths => {
      for (const path of paths) {
        cy.request({
          url: `${GITEA_URL}/api/v1/repos/${fullName}/raw/${path}?ref=${ref}`,
          auth: { user: GITEA_USER, pass: Cypress.env('GITEA_PASSWORD') },
        }).then(response => {
          files[path] = response.body
        })
      }
    })
    .then(() => files)
}

// Newest first
function repoCommits(fullName: string, ref = 'main'): Cypress.Chainable<GiteaCommit[]> {
  return giteaApi(
    'GET',
    `repos/${fullName}/commits?sha=${ref}&limit=50&stat=false&files=false&verification=false`
  ).its('body')
}

function repoBranches(fullName: string): Cypress.Chainable<string[]> {
  return giteaApi('GET', `repos/${fullName}/branches`)
    .its('body')
    .then((branches: { name: string }[]) => branches.map(b => b.name).sort())
}

function repoPulls(fullName: string): Cypress.Chainable<GiteaPull[]> {
  return giteaApi('GET', `repos/${fullName}/pulls?state=all`).its('body')
}

// Merges a pull request like the Merge button. Gitea answers 405 while it
// checks the pull request after a push to its branch: try again.
function mergePullOnGitea(
  fullName: string,
  number: number,
  style = 'merge',
  attempts = 20
) {
  cy.request({
    method: 'POST',
    url: `${GITEA_URL}/api/v1/repos/${fullName}/pulls/${number}/merge`,
    auth: { user: GITEA_USER, pass: Cypress.env('GITEA_PASSWORD') },
    body: { Do: style, delete_branch_after_merge: true },
    failOnStatusCode: false,
  }).then(response => {
    if (response.status === 200) return
    expect(response.status, 'merge answer').to.equal(405)
    expect(attempts, 'merge attempts').to.be.greaterThan(0)
    cy.wait(500)
    mergePullOnGitea(fullName, number, style, attempts - 1)
  })
}

function protectMain(fullName: string, rule: object) {
  return giteaApi('POST', `repos/${fullName}/branch_protections`, {
    rule_name: 'main',
    ...rule,
  })
}

function unprotectMain(fullName: string) {
  return giteaApi('DELETE', `repos/${fullName}/branch_protections/main`)
}

// A working copy of the repository, cloned with the git CLI over HTTP
function cloneRepo(fullName: string) {
  const dir = workingCopy(fullName.replace('/', '-'))
  const password = encodeURIComponent(Cypress.env('GITEA_PASSWORD'))
  return git(
    `git clone -q http://${GITEA_USER}:${password}@gitea:3000/${fullName}.git ${dir} && ` +
      `cd ${dir} && git config user.name 'E2E Tea' && git config user.email ${GITEA_USER}@gitea.test`
  ).then(result => {
    expect(result.exitCode, result.stderr).to.equal(0)
    return dir
  })
}

function gitIn(dir: string, command: string) {
  return git(`cd ${dir} && ${command}`).then(result => {
    expect(result.exitCode, result.stderr).to.equal(0)
    return result
  })
}

function writeFiles(dir: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    gitIn(
      dir,
      `mkdir -p $(dirname ${path}) && printf '%s' '${content.replaceAll("'", "'\\''")}' > ${path}`
    )
  }
}

// Replaces the history of main with a single new root commit of the files
function forcePushOnGitea(fullName: string, files: Record<string, string>) {
  cloneRepo(fullName).then(dir => {
    gitIn(dir, 'git checkout -q --orphan rewritten && git rm -rqf .')
    writeFiles(dir, files)
    gitIn(
      dir,
      "git add -A && git commit -qm 'Rewritten history' && git push -qf origin rewritten:main"
    )
  })
}

// Merges the branch into main the way a user resolves a conflict in a
// working copy: a merge commit whose files are the resolved ones
function mergeOnGitea(
  fullName: string,
  branch: string,
  resolved: Record<string, string>
) {
  cloneRepo(fullName).then(dir => {
    gitIn(dir, `git merge -q --no-commit -s ours origin/${branch}`)
    writeFiles(dir, resolved)
    gitIn(dir, "git add -A && git commit -qm 'Merge Overleaf changes' && git push -q origin main")
  })
}

function giteaWidget() {
  return cy.contains('.settings-widget-container', 'Gitea')
}

function connectionStatus() {
  return cy.request('/user/gitea-sync/status').its('body')
}

function projectSyncState(projectId: string) {
  return cy.request(`/project/${projectId}/gitea-sync/state`).its('body')
}

// Gitea asks for its login unless the browser has a Gitea session already,
// then for the user's consent unless the user authorized the application
// before. Follows the browser until it is back on the settings page.
function giteaAuthorize(user: string) {
  cy.location()
    .should(loc => {
      expect(
        loc.origin === GITEA_URL || loc.search.includes('oauth-complete=gitea'),
        'on Gitea or back on the settings page'
      ).to.equal(true)
    })
    .then(loc => {
      if (loc.origin !== GITEA_URL) return
      if (loc.pathname === '/user/login') {
        cy.origin(
          GITEA_URL,
          { args: { user, password: Cypress.env('GITEA_PASSWORD') } },
          ({ user, password }) => {
            cy.get('#user_name').type(user)
            cy.get('#password').type(password, { log: false })
            cy.get('form button.primary').click()
          }
        )
        cy.location('pathname').should('not.equal', '/user/login')
        giteaAuthorize(user)
      } else {
        cy.origin(GITEA_URL, () => {
          cy.contains('button', 'Authorize Application').click()
        })
      }
    })
}

// Overleaf keeps the token of the logged in user across tests: start over
// from the unlinked account, on the settings page
function unlinkGiteaAccount() {
  cy.visit('/user/settings')
  postWithCsrf('/user/gitea-sync/unlink', {}).its('status').should('equal', 200)
  cy.visit('/user/settings')
}

// The settings page's Link button runs the whole OAuth flow: Overleaf sends
// the browser to Gitea, which sends it back with a code.
function linkGiteaAccount(user = GITEA_USER) {
  unlinkGiteaAccount()
  giteaWidget().findByRole('link', { name: 'Link' }).click()
  giteaAuthorize(user)
  cy.location('search').should('contain', 'oauth-complete=gitea')
  giteaWidget().findByRole('button', { name: 'Unlink' }).should('exist')
}

// Clicking the tab of the open rail panel would close it
function openRailTab(name: string) {
  cy.findByRole('tab', { name }).then(tab => {
    if (tab.attr('aria-selected') !== 'true') cy.wrap(tab).click()
  })
}

// Opens the modal from the Integrations panel of the open project
function openSyncModalInEditor() {
  openRailTab('Integrations')
  cy.findByRole('button', { name: /Gitea/ }).click()
  return syncModal().should('be.visible')
}

function openGiteaSyncModal(projectId: string) {
  openProject(projectId)
  return openSyncModalInEditor()
}

function syncModal() {
  return cy.contains('[role="dialog"]', 'Sync with Gitea')
}

before(function () {
  ensureAdminExists()
})

beforeEach(function () {
  login(ADMIN_EMAIL)
  unlinkGiteaAccount()
})

describe('linking the Gitea account', function () {
  it('links through the OAuth application and unlinks again', function () {
    cy.visit('/user/settings')
    giteaWidget()
      .findByRole('link', { name: 'Link' })
      .should('have.attr', 'href', '/user/gitea-sync/oauth2')
    giteaWidget().should('contain.text', 'With Gitea Sync you can link your')
    connectionStatus().should('equal', false)

    linkGiteaAccount()
    cy.contains('successfully linked your Gitea account').should('exist')
    connectionStatus().should('equal', true)

    giteaWidget().findByRole('button', { name: 'Unlink' }).click()
    cy.findByRole('dialog')
      .should('contain.text', 'Unlink Gitea Account')
      .and('contain.text', 'relink your Gitea account')
      .findByRole('button', { name: 'Unlink' })
      .click()
    giteaWidget().findByRole('link', { name: 'Link' }).should('exist')
    connectionStatus().should('equal', false)
  })

  it('sends the application id, callback, scopes and a state to Gitea', function () {
    cy.visit('/user/settings')
    cy.request({ url: '/user/gitea-sync/oauth2', followRedirect: false }).then(
      response => {
        expect(response.status).to.equal(302)
        const url = new URL(response.redirectedToUrl!)
        expect(url.origin + url.pathname).to.equal(
          `${GITEA_URL}/login/oauth/authorize`
        )
        expect(url.searchParams.get('client_id')).to.have.length.greaterThan(0)
        expect(url.searchParams.get('redirect_uri')).to.equal(
          'http://sharelatex/user/gitea-sync/oauth2/callback'
        )
        expect(url.searchParams.get('response_type')).to.equal('code')
        // Everything a sync needs, asked for once: the repositories with
        // their files, branches and pull requests (workflow files included),
        // and creating repositories of the user or of an organization
        expect(url.searchParams.get('scope')).to.equal(
          'write:user write:organization write:repository'
        )
        expect(url.searchParams.get('state')).to.have.length.greaterThan(0)
      }
    )
  })

  it('refuses a callback without a valid state', function () {
    cy.request({
      url: '/user/gitea-sync/oauth2/callback?code=anything&state=forged',
      failOnStatusCode: false,
    })
      .its('status')
      .should('equal', 403)
    connectionStatus().should('equal', false)
  })

  it('stays unlinked when the user does not authorize the application', function () {
    // What Gitea sends back when the user cancels on its consent page
    cy.visit('/user/settings')
    cy.get('meta[name="ol-csrfToken"]')
      .invoke('attr', 'content')
      .then(csrfToken => {
        cy.request({
          url: `/user/gitea-sync/oauth2/callback?error=access_denied&error_description=the+request+is+denied&state=${encodeURIComponent(csrfToken as string)}`,
          failOnStatusCode: false,
        })
          .its('status')
          .should('equal', 400)
      })
    connectionStatus().should('equal', false)
    cy.visit('/user/settings')
    giteaWidget().findByRole('link', { name: 'Link' }).should('exist')
  })

  it('refreshes the expiring access token on every use', function () {
    linkGiteaAccount()
    // Each check refreshes with the refresh token the previous one got;
    // Gitea spends a refresh token on use, so a stale one would fail
    for (let i = 0; i < 3; i++) {
      connectionStatus().should('equal', true)
    }
  })

  it('shows the account as unlinked once the user revoked the grant on Gitea', function () {
    linkGiteaAccount()
    // Revoke the grant in Gitea's settings, like a user
    cy.visit(`${GITEA_URL}/user/settings/applications`)
    cy.origin(GITEA_URL, () => {
      // The Revoke button of the only grant, in the markup of every version
      const revoke = 'button[data-url*="/revoke/"]'
      cy.contains('Authorized OAuth2 Applications')
      cy.get(revoke).should('contain.text', 'Revoke').click()
      // the confirmation, shown in place or as a copy depending on the version
      cy.contains('.ui.modal:visible', 'Revoke Access')
        .contains('button', 'Yes')
        .click()
      // Gitea reloads the page once the grant is gone
      cy.get(revoke).should('not.exist')
      cy.reload()
      cy.contains('Authorized OAuth2 Applications')
      cy.get(revoke).should('not.exist')
    })
    cy.visit('/user/settings')
    giteaWidget().findByRole('link', { name: 'Link' }).should('exist')
    connectionStatus().should('equal', false)
  })
})

describe('linking a project to a repository', function () {
  it('asks to link the Gitea account first', function () {
    createProject(projectName('Gitea')).then(projectId => {
      openGiteaSyncModal(projectId)
      // The editor runs the OAuth flow in a popup
      cy.window().then(win => cy.stub(win, 'open').as('popup'))
      syncModal()
        .findByRole('button', { name: 'Link to your Gitea account' })
        .click()
      cy.get('@popup').should('have.been.calledWith', '/user/gitea-sync/oauth2')
    })
  })

  it('exports a project into a new private repository', function () {
    const name = projectName('Gitea')
    const fullName = `${GITEA_USER}/${name}`
    linkGiteaAccount()
    createProject(name).then(projectId => {
      openGiteaSyncModal(projectId)
      syncModal().within(() => {
        cy.findByText('Export Project to Gitea').should('exist')
        cy.findByLabelText('Owner').should('have.value', GITEA_USER)
        cy.findByLabelText('Repository Name').should('have.value', name)
        cy.findByLabelText('Description (Optional)').type('Exported in e2e')
        cy.findByRole('button', { name: 'Create a Gitea repository' }).click()
        cy.contains('This project is linked to')
          .findByRole('link', { name: fullName })
          .should('have.attr', 'href', `${GITEA_URL}/${fullName}`)
      })
      projectSyncState(projectId).should('deep.include', {
        mergeStatus: 'clean',
        repoFullName: fullName,
      })
      repoInfo(fullName).then(repo => {
        expect(repo.private).to.equal(true)
        expect(repo.description).to.equal('Exported in e2e')
        expect(repo.default_branch).to.equal('main')
      })
      repoFiles(fullName).then(files => {
        expect(Object.keys(files)).to.deep.equal(['main.tex'])
        expect(files['main.tex']).to.contain('\\section{Introduction}')
      })
      repoCommits(fullName)
        .then(commits => commits.map(c => c.commit.message.trim()))
        .should('deep.equal', ['Initial Overleaf import'])
      repoBranches(fullName).should('deep.equal', ['main'])
    })
  })

  it('exports into a public repository of an organization', function () {
    const name = projectName('Gitea')
    linkGiteaAccount()
    createProject(name).then(projectId => {
      openGiteaSyncModal(projectId)
      syncModal().within(() => {
        cy.findByLabelText('Owner').select(GITEA_ORG)
        cy.findByLabelText('Organization').should('have.value', GITEA_ORG)
        cy.findByLabelText(/Public/).check()
        cy.findByRole('button', { name: 'Create a Gitea repository' }).click()
        cy.findByRole('link', { name: `${GITEA_ORG}/${name}` }).should('exist')
      })
      repoInfo(`${GITEA_ORG}/${name}`).its('private').should('equal', false)
    })
  })

  it('does not export into a repository that exists', function () {
    const name = projectName('Gitea')
    const fullName = `${GITEA_USER}/${name}`
    seedRepo(name, { 'README.md': 'Taken' })
    linkGiteaAccount()
    createProject(name).then(projectId => {
      openGiteaSyncModal(projectId)
      syncModal().within(() => {
        cy.findByRole('button', { name: 'Create a Gitea repository' }).click()
        cy.findByRole('alert').should('exist')
        cy.findByText('Export Project to Gitea').should('exist')
      })
      projectSyncState(projectId)
        .its('mergeStatus')
        .should('equal', 'need-export')
      repoFiles(fullName).should('deep.equal', { 'README.md': 'Taken' })
    })
  })

  it('unlinks a project from its repository', function () {
    const name = projectName('Gitea')
    linkGiteaAccount()
    createProject(name).then(projectId => {
      openGiteaSyncModal(projectId)
      syncModal()
        .findByRole('button', { name: 'Create a Gitea repository' })
        .click()
      syncModal().findByRole('button', { name: 'Unlink' }).click()
      syncModal().within(() => {
        cy.contains('This project is linked to').should('exist')
        cy.findByRole('button', { name: 'Confirm' }).click()
        cy.findByText('Export Project to Gitea').should('exist')
      })
      projectSyncState(projectId)
        .its('mergeStatus')
        .should('equal', 'need-export')
      // The repository stays on Gitea
      repoFiles(`${GITEA_USER}/${name}`).should('have.property', 'main.tex')
    })
  })
})

describe('importing a repository', function () {
  const files = {
    'main.tex': [
      '\\documentclass{article}',
      '\\begin{document}',
      '\\input{sections/intro}',
      '\\end{document}',
    ].join('\n'),
    'sections/intro.tex': '\\section{Introduction}\nImported from Gitea',
  }

  function openImportModal() {
    cy.visit('/project')
    cy.findAllByRole('button', { name: 'New project' }).first().click()
    cy.findByRole('menuitem', { name: 'Import from Gitea' }).click()
    return cy.contains('[role="dialog"]', 'Import from Gitea')
  }

  it('asks to link the Gitea account first', function () {
    openImportModal()
      .findByRole('link', { name: 'Link to your Gitea account' })
      .should('have.attr', 'href', '/user/gitea-sync/oauth2')
  })

  it('imports a repository into a linked project', function () {
    const name = projectName('Repo')
    const fullName = `${GITEA_USER}/${name}`
    seedRepo(name, files)
    linkGiteaAccount()
    openImportModal().within(() => {
      cy.findByText(
        'Select a Gitea repository to import into Our Overleaf Instance.'
      ).should('exist')
      cy.contains('tr', name)
        .findByRole('link', { name: fullName })
        .should('have.attr', 'href', `${GITEA_URL}/${fullName}`)
      cy.contains('tr', name)
        .findByRole('button', { name: 'Import to Overleaf' })
        .click()
    })
    cy.location('pathname').should('match', /^\/project\/[0-9a-f]{24}$/)
    cy.get('.cm-content').should('contain.text', '\\input{sections/intro}')
    cy.location('pathname').then(pathname => {
      const projectId = pathname.split('/').pop()!
      cy.request(`/project/${projectId}/entities`)
        .its('body.entities')
        .then((entities: { path: string }[]) => entities.map(e => e.path))
        .should('include.members', ['/main.tex', '/sections/intro.tex'])
      projectSyncState(projectId).should('deep.include', {
        mergeStatus: 'clean',
        repoFullName: fullName,
      })
    })
  })

  it('imports files tracked by Git LFS as their pointers, as syncs pull them', function () {
    const name = projectName('Lfs')
    const fullName = `${GITEA_USER}/${name}`
    seedRepo(name, {
      '.gitattributes': 'data.txt filter=lfs diff=lfs merge=lfs -text',
      'main.tex': [
        '\\documentclass{article}',
        '\\begin{document}',
        '\\section{Introduction}',
        '\\end{document}',
      ].join('\n'),
    })
    // Gitea stores the file in LFS, as the attributes ask
    commitOnGitea(fullName, { 'data.txt': 'Large data' }, 'Add data')
    repoFiles(fullName)
      .its('data.txt')
      .should('match', /^version https:\/\/git-lfs\.github\.com\/spec\/v1\n/)
    linkGiteaAccount()
    postWithCsrf('/project/new/gitea-sync', {
      name,
      fullName,
      defaultBranchName: 'main',
    }).then(response => {
      expect(response.status).to.equal(200)
      const projectId = response.body.projectId
      commitOnGitea(fullName, { 'notes.txt': 'Notes' }, 'Add notes')
      openProject(projectId)
      openRailTab('File tree')
      cy.findByRole('treeitem', { name: 'data.txt' }).click()
      cy.get('.cm-content').should('contain.text', 'oid sha256:')
      openSyncModalInEditor()
      syncModal().findByRole('button', { name: 'Sync' }).click()
      syncModal()
        .findByText('No new commits in Gitea since last merge.')
        .should('exist')
      // the pull left the pointer alone, so nothing went back to Gitea
      repoFiles(fullName)
        .its('data.txt')
        .should('match', /^version https:\/\/git-lfs\.github\.com\/spec\/v1\n/)
      repoCommits(fullName)
        .then(commits => commits.map(c => c.commit.message.trim()))
        .should('not.include', 'Updates from Overleaf')
    })
  })

  it('does not list empty repositories, which have nothing to import', function () {
    const name = projectName('Empty')
    giteaApi('POST', 'user/repos', { name, auto_init: false })
    linkGiteaAccount()
    cy.request('/user/gitea-sync/repos')
      .its('body.repos')
      .then((repos: { fullName: string }[]) => repos.map(r => r.fullName))
      .should('not.include', `${GITEA_USER}/${name}`)
  })
})

describe('syncing a linked project', function () {
  const main = [
    '\\documentclass{article}',
    '\\begin{document}',
    '\\section{Introduction}',
    'First line',
    '\\input{chapter}',
    '\\end{document}',
  ].join('\n')
  const workflow = [
    'on: [push]',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: latexmk -pdf main.tex',
  ].join('\n')
  const files = {
    'main.tex': main,
    'chapter.tex': 'Chapter text',
    'notes.txt': 'Notes',
    // not imported: Overleaf ignores dotfiles
    '.gitignore': '*.aux',
    '.gitea/workflows/build.yml': workflow,
  }

  let name: string
  let fullName: string
  let projectId: string

  // A repository imported over HTTP, the way the import modal does it
  beforeEach(function () {
    name = projectName('Sync')
    fullName = `${GITEA_USER}/${name}`
    seedRepo(name, files)
    linkGiteaAccount()
    postWithCsrf('/project/new/gitea-sync', {
      name,
      fullName,
      defaultBranchName: 'main',
    }).then(response => {
      expect(response.status).to.equal(200)
      projectId = response.body.projectId
    })
  })

  function mergeOverview() {
    return cy
      .request(`/project/${projectId}/gitea-sync/merge/overview`)
      .its('body')
  }

  // Edits reach the history asynchronously; the overview flushes it and
  // reports whether the project changed since the last sync.
  function waitForProjectUpdated(attempts = 20) {
    mergeOverview().then(overview => {
      if (overview.isProjectUpdated) return
      expect(attempts, 'project updated').to.be.greaterThan(0)
      cy.wait(500)
      waitForProjectUpdated(attempts - 1)
    })
  }

  // While a conflict is open the overview has nothing to say; the history
  // shows when an edit to the file arrived instead
  function waitForHistoryUpdate(path: string, attempts = 20) {
    cy.request(`/project/${projectId}/updates?min_count=1`).then(
      ({ body }: { body: { updates: { pathnames: string[] }[] } }) => {
        if (body.updates[0]?.pathnames.includes(path)) return
        expect(attempts, `history update of ${path}`).to.be.greaterThan(0)
        cy.wait(500)
        waitForHistoryUpdate(path, attempts - 1)
      }
    )
  }

  function editMainInOverleaf(text: string) {
    cy.findByRole('textbox', { name: 'Source Editor editing' }).within(() => {
      cy.findByText('First line').click()
      cy.findByText('First line').type(`{end}\n${text}`)
    })
    waitForProjectUpdated()
  }

  function syncNow() {
    syncModal().findByRole('button', { name: 'Sync' }).click()
  }

  function expectUpToDate() {
    syncModal()
      .findByText('No new commits in Gitea since last merge.', {
        timeout: 30_000,
      })
      .should('exist')
  }

  function expectManualMerge() {
    cy.contains('[role="dialog"]', 'could not be automatically merged', {
      timeout: 30_000,
    })
    syncModal()
      .should(
        'contain.text',
        'Your changes in Our Overleaf Instance and Gitea could not be automatically merged.'
      )
      .and('contain.text', 'Please manually merge the')
  }

  function openFile(path: string) {
    openRailTab('File tree')
    cy.findByRole('treeitem', { name: path }).click()
  }

  function entityPaths() {
    return cy
      .request(`/project/${projectId}/entities`)
      .its('body.entities')
      .then((entities: { path: string }[]) => entities.map(e => e.path))
  }

  it('pulls commits made on Gitea into the project', function () {
    commitOnGitea(
      fullName,
      {
        'chapter.tex': 'Chapter text edited on Gitea',
        'appendix.tex': 'Appendix from Gitea',
        'notes.txt': null,
      },
      'Edit on Gitea'
    )
    openGiteaSyncModal(projectId)
    syncModal().within(() => {
      cy.findByText('Recent commits in Gitea').should('exist')
      cy.findAllByRole('link', { name: 'Edit on Gitea' })
        .first()
        .should('have.attr', 'href')
        .and('match', new RegExp(`^${GITEA_URL}/${fullName}/commit/[0-9a-f]{40}$`))
      cy.findByText(`by ${GITEA_USER} <${GITEA_USER}@gitea.test>`).should(
        'exist'
      )
      // Nothing to commit from Overleaf
      cy.findByPlaceholderText(/Commit message for changes made in/).should(
        'not.exist'
      )
    })
    syncNow()
    expectUpToDate()
    entityPaths()
      .should('include.members', ['/main.tex', '/chapter.tex', '/appendix.tex'])
      .and('not.include', '/notes.txt')
    syncModal().findByRole('button', { name: 'Close' }).click()
    openFile('chapter.tex')
    cy.get('.cm-content').should('contain.text', 'Chapter text edited on Gitea')
    projectSyncState(projectId).its('mergeStatus').should('equal', 'clean')
  })

  it('lists the new commits oldest first', function () {
    commitOnGitea(fullName, { 'chapter.tex': 'One' }, 'First on Gitea')
    commitOnGitea(fullName, { 'chapter.tex': 'Two' }, 'Second on Gitea')
    mergeOverview().then(overview => {
      expect(overview.diverged).to.equal(false)
      expect(overview.commits.map((c: { message: string }) => c.message)).to.deep.equal([
        'First on Gitea',
        'Second on Gitea',
      ])
    })
  })

  it('pushes changes made in Overleaf to Gitea', function () {
    openProject(projectId)
    editMainInOverleaf('Written in Overleaf')
    openSyncModalInEditor()
    syncModal()
      .findByPlaceholderText(/Commit message for changes made in/)
      .type('Edit in Overleaf')
    syncNow()
    expectUpToDate()
    repoFiles(fullName).then(repoFiles => {
      expect(repoFiles['main.tex']).to.contain('First line\nWritten in Overleaf')
      expect(repoFiles['chapter.tex']).to.equal('Chapter text')
      // Files Overleaf does not show are left alone
      expect(repoFiles['.gitea/workflows/build.yml']).to.equal(workflow)
    })
    repoCommits(fullName).then(commits => {
      expect(commits[0].commit.message.trim()).to.equal('Edit in Overleaf')
      // A fast forward: no merge commit, no pull request
      expect(commits[0].parents).to.have.length(1)
    })
    repoPulls(fullName).should('deep.equal', [])
    repoBranches(fullName).should('deep.equal', ['main'])
    // Syncing again finds nothing to do
    mergeOverview().should('deep.include', {
      commits: [],
      isProjectUpdated: false,
    })
  })

  it('keeps a CI workflow changed on Gitea while merging Overleaf changes', function () {
    const newWorkflow = workflow.replace('latexmk -pdf', 'latexmk -xelatex')
    commitOnGitea(
      fullName,
      { '.gitea/workflows/build.yml': newWorkflow },
      'Build with XeLaTeX'
    )
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncNow()
    expectUpToDate()
    repoFiles(fullName).then(repoFiles => {
      expect(repoFiles['.gitea/workflows/build.yml']).to.equal(newWorkflow)
      expect(repoFiles['main.tex']).to.contain('Main from Overleaf')
    })
    // A second round does not take the workflow back either
    syncModal().findByRole('button', { name: 'Close' }).click()
    editMainInOverleaf('More from Overleaf')
    openSyncModalInEditor()
    syncNow()
    expectUpToDate()
    repoFiles(fullName)
      .its('.gitea/workflows/build.yml')
      .should('equal', newWorkflow)
  })

  it('merges changes made on both sides through a pull request', function () {
    commitOnGitea(fullName, { 'chapter.tex': 'Chapter from Gitea' }, 'Chapter on Gitea')
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncModal().findAllByRole('link', { name: 'Chapter on Gitea' }).should('exist')
    syncNow()
    expectUpToDate()
    repoFiles(fullName).then(repoFiles => {
      expect(repoFiles['main.tex']).to.contain('Main from Overleaf')
      expect(repoFiles['chapter.tex']).to.equal('Chapter from Gitea')
    })
    repoCommits(fullName).then(commits => {
      expect(commits[0].parents, 'merge commit').to.have.length(2)
    })
    // The temporary branch is gone again, its pull request stays as a record
    repoBranches(fullName).should('deep.equal', ['main'])
    repoPulls(fullName).then(pulls => {
      expect(pulls).to.have.length(1)
      expect(pulls[0]).to.deep.include({ state: 'closed', merged: true })
      expect(pulls[0].title).to.match(
        /^Overleaf sync: merge overleaf-\d{4}-\d{2}-\d{2}-\d{6} into main$/
      )
    })
    syncModal().findByRole('button', { name: 'Close' }).click()
    openFile('chapter.tex')
    cy.get('.cm-content').should('contain.text', 'Chapter from Gitea')
  })

  it('merges with the merge style the repository sets', function () {
    giteaApi('PATCH', `repos/${fullName}`, { default_merge_style: 'squash' })
    commitOnGitea(fullName, { 'chapter.tex': 'Chapter from Gitea' }, 'Chapter on Gitea')
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncNow()
    expectUpToDate()
    repoCommits(fullName).then(commits => {
      // A squash commit, no merge commit
      expect(commits[0].parents).to.have.length(1)
    })
    repoFiles(fullName).its('main.tex').should('contain', 'Main from Overleaf')
    projectSyncState(projectId).its('mergeStatus').should('equal', 'clean')
    // The next sync starts from the squashed head
    mergeOverview().should('deep.include', { commits: [], diverged: false })
  })

  it('stops on a conflict and continues after a manual merge', function () {
    commitOnGitea(
      fullName,
      { 'main.tex': main.replace('First line', 'First line from Gitea') },
      'Main on Gitea'
    )
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncNow()
    expectManualMerge()
    projectSyncState(projectId).then(state => {
      cy.wrap(state.unmergedBranchName).as('unmergedBranch')
      expect(state.mergeStatus).to.equal('conflict')
      expect(state.unmergedBranchName).to.match(/^overleaf-\d{4}-\d{2}-\d{2}-\d{6}$/)
      // Overleaf's side waits on its own branch, with its pull request left
      // open for the user
      repoBranches(fullName).should('include', state.unmergedBranchName)
      repoFiles(fullName).then(repoFiles => {
        expect(repoFiles['main.tex']).to.contain('First line from Gitea')
        expect(repoFiles['main.tex']).not.to.contain('Main from Overleaf')
      })
      repoPulls(fullName).then(pulls => {
        expect(pulls).to.have.length(1)
        expect(pulls[0]).to.deep.include({ state: 'open', merged: false })
        expect(pulls[0].head.ref).to.equal(state.unmergedBranchName)
        expect(pulls[0].base.ref).to.equal('main')
      })
    })

    // Reopening the modal shows the conflict until it is resolved
    syncModal().findByRole('button', { name: 'Close' }).click()
    openSyncModalInEditor()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .should('exist')

    // The user merges Overleaf's branch in a working copy, then continues
    cy.get<string>('@unmergedBranch').then(branch => {
      mergeOnGitea(fullName, branch, {
        'main.tex': main.replace('First line', 'First line from Gitea\nMain from Overleaf'),
      })
    })
    syncModal()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .click()
    expectUpToDate()
    projectSyncState(projectId).should('deep.include', {
      mergeStatus: 'clean',
      repoFullName: fullName,
    })
    cy.get('.cm-content')
      .should('contain.text', 'First line from Gitea')
      .and('contain.text', 'Main from Overleaf')
  })

  function continueAfterSquashMerge(base: string) {
    commitOnGitea(
      fullName,
      { 'main.tex': main.replace('First line', 'First line from Gitea') },
      'Main on Gitea',
      base
    )
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncNow()
    expectManualMerge()
    // The user resolves the conflict on the branch, then squash merges the
    // pull request: main does not contain the branch's commits
    projectSyncState(projectId).then(state => {
      const branch = state.unmergedBranchName
      cloneRepo(fullName).then(dir => {
        gitIn(dir, `git checkout -q ${branch} && git merge -q -s ours origin/${base}`)
        writeFiles(dir, {
          'main.tex': main.replace('First line', 'First line from Gitea\nMain from Overleaf'),
        })
        gitIn(dir, `git add -A && git commit -q --amend --no-edit && git push -q origin ${branch}`)
      })
      repoPulls(fullName).then(pulls => {
        mergePullOnGitea(fullName, pulls[0].number, 'squash')
      })
    })
    syncModal()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .click()
    expectUpToDate()
    projectSyncState(projectId).its('mergeStatus').should('equal', 'clean')
    cy.get('.cm-content')
      .should('contain.text', 'First line from Gitea')
      .and('contain.text', 'Main from Overleaf')
  }

  it('continues after the pull request was squash merged on Gitea', function () {
    continueAfterSquashMerge('main')
  })

  it('continues after a squash merge into a default branch with a slash', function () {
    // Gitea reads the base of pulls/{base}/{head} as one path segment
    name = projectName('Slash')
    fullName = `${GITEA_USER}/${name}`
    seedRepo(name, files)
    giteaApi('POST', `repos/${fullName}/branches`, {
      new_branch_name: 'release/main',
      old_branch_name: 'main',
    })
    giteaApi('PATCH', `repos/${fullName}`, { default_branch: 'release/main' })
    postWithCsrf('/project/new/gitea-sync', {
      name,
      fullName,
      defaultBranchName: 'release/main',
    }).then(response => {
      expect(response.status).to.equal(200)
      projectId = response.body.projectId
      continueAfterSquashMerge('release/main')
    })
  })

  it('leaves the merge to the user when Gitea requires an approval', function () {
    protectMain(fullName, { enable_push: true, required_approvals: 1 })
    commitOnGitea(fullName, { 'chapter.tex': 'Chapter from Gitea' }, 'Chapter on Gitea')
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncNow()
    expectManualMerge()
    projectSyncState(projectId).its('mergeStatus').should('equal', 'conflict')
    // Nothing was merged behind the rule's back
    repoFiles(fullName).its('main.tex').should('not.contain', 'Main from Overleaf')
    repoPulls(fullName).then(pulls => {
      expect(pulls).to.have.length(1)
      expect(pulls[0]).to.deep.include({ state: 'open', merged: false })
      // Once the rule is met, the user merges the pull request on Gitea
      unprotectMain(fullName)
      mergePullOnGitea(fullName, pulls[0].number)
    })
    syncModal()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .click()
    expectUpToDate()
    projectSyncState(projectId).its('mergeStatus').should('equal', 'clean')
    repoFiles(fullName).then(repoFiles => {
      expect(repoFiles['main.tex']).to.contain('Main from Overleaf')
      expect(repoFiles['chapter.tex']).to.equal('Chapter from Gitea')
    })
  })

  it('leaves the merge to the user when Gitea requires a passing status check', function () {
    protectMain(fullName, {
      enable_push: true,
      enable_status_check: true,
      status_check_contexts: ['ci/build'],
    })
    commitOnGitea(fullName, { 'chapter.tex': 'Chapter from Gitea' }, 'Chapter on Gitea')
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncNow()
    expectManualMerge()
    repoPulls(fullName).then(pulls => {
      expect(pulls[0]).to.deep.include({ state: 'open', merged: false })
      // The CI reports success on the branch, then the user merges
      giteaApi('GET', `repos/${fullName}/pulls/${pulls[0].number}`).then(({ body }) => {
        giteaApi('POST', `repos/${fullName}/statuses/${body.head.sha}`, {
          state: 'success',
          context: 'ci/build',
        })
      })
      mergePullOnGitea(fullName, pulls[0].number)
    })
    syncModal()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .click()
    expectUpToDate()
    repoFiles(fullName).its('main.tex').should('contain', 'Main from Overleaf')
  })

  it('keeps the conflict when the user continues without merging', function () {
    commitOnGitea(
      fullName,
      { 'main.tex': main.replace('First line', 'First line from Gitea') },
      'Main on Gitea'
    )
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncNow()
    expectManualMerge()
    projectSyncState(projectId).then(state => {
      cy.wrap(state.unmergedBranchName).as('unmergedBranch')
    })

    // The pull request is not merged on Gitea: Gitea's side must not
    // replace Overleaf's changes
    syncModal()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .click()
    expectManualMerge()
    cy.get<string>('@unmergedBranch').then(branch => {
      projectSyncState(projectId).should('deep.include', {
        mergeStatus: 'conflict',
        unmergedBranchName: branch,
      })
      repoBranches(fullName).should('include', branch)
      repoFiles(fullName).its('main.tex').should('not.contain', 'Main from Overleaf')
    })
    openProject(projectId)
    cy.get('.cm-content')
      .should('contain.text', 'Main from Overleaf')
      .and('not.contain.text', 'First line from Gitea')
  })

  it('rebuilds a branch deleted without merging', function () {
    commitOnGitea(
      fullName,
      { 'main.tex': main.replace('First line', 'First line from Gitea') },
      'Main on Gitea'
    )
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncNow()
    expectManualMerge()
    projectSyncState(projectId).then(state => {
      // Closing the pull request first, as Gitea keeps the branch of an
      // open one
      repoPulls(fullName).then(pulls => {
        giteaApi('PATCH', `repos/${fullName}/pulls/${pulls[0].number}`, {
          state: 'closed',
        })
      })
      giteaApi('DELETE', `repos/${fullName}/branches/${state.unmergedBranchName}`)
    })

    // Nothing is left to merge: the branch is rebuilt from the Overleaf
    // history and the conflict stays, Gitea's side replaces nothing
    syncModal()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .click()
    expectManualMerge()
    projectSyncState(projectId).then(state => {
      expect(state.mergeStatus).to.equal('conflict')
      cy.wrap(state.unmergedBranchName).as('rebuiltBranch')
      repoBranches(fullName).should('include', state.unmergedBranchName)
      repoFiles(fullName).its('main.tex').should('not.contain', 'Main from Overleaf')
    })
    openProject(projectId)
    cy.get('.cm-content')
      .should('contain.text', 'Main from Overleaf')
      .and('not.contain.text', 'First line from Gitea')

    // The user merges the rebuilt branch, then continues
    cy.get<string>('@rebuiltBranch').then(branch => {
      mergeOnGitea(fullName, branch, {
        'main.tex': main.replace('First line', 'First line from Gitea\nMain from Overleaf'),
      })
    })
    openSyncModalInEditor()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .click()
    expectUpToDate()
    projectSyncState(projectId).its('mergeStatus').should('equal', 'clean')
    cy.get('.cm-content')
      .should('contain.text', 'First line from Gitea')
      .and('contain.text', 'Main from Overleaf')
  })

  it('keeps edits made in Overleaf while a conflict is open', function () {
    commitOnGitea(
      fullName,
      { 'main.tex': main.replace('First line', 'First line from Gitea') },
      'Main on Gitea'
    )
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncNow()
    syncModal().should('contain.text', 'could not be automatically merged')
    syncModal().findByRole('button', { name: 'Close' }).click()

    // More work in Overleaf before the conflict is resolved
    openFile('chapter.tex')
    cy.findByRole('textbox', { name: 'Source Editor editing' }).within(() => {
      cy.findByText('Chapter text').click()
      cy.findByText('Chapter text').type('{end} written during the conflict')
    })
    waitForHistoryUpdate('chapter.tex')

    projectSyncState(projectId).then(state => {
      mergeOnGitea(fullName, state.unmergedBranchName, {
        'main.tex': main.replace('First line', 'First line from Gitea\nMain from Overleaf'),
      })
    })
    openSyncModalInEditor()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .click()
    expectUpToDate()
    projectSyncState(projectId).its('mergeStatus').should('equal', 'clean')
    repoFiles(fullName).then(repoFiles => {
      expect(repoFiles['chapter.tex']).to.equal('Chapter text written during the conflict')
      expect(repoFiles['main.tex']).to.contain('First line from Gitea')
      expect(repoFiles['main.tex']).to.contain('Main from Overleaf')
    })
  })

  it('pushes files renamed and deleted in Overleaf', function () {
    openProject(projectId)
    openRailTab('File tree')
    cy.findByRole('treeitem', { name: 'chapter.tex' }).click()
    cy.findByRole('button', { name: 'Open chapter.tex action menu' }).click()
    cy.findByRole('menuitem', { name: 'Rename' }).click()
    cy.get('.rename-input input').clear().type('part.tex{enter}')
    cy.findByRole('treeitem', { name: 'part.tex' }).should('exist')
    cy.findByRole('treeitem', { name: 'notes.txt' }).click()
    cy.findByRole('button', { name: 'Open notes.txt action menu' }).click()
    cy.findByRole('menuitem', { name: 'Delete' }).click()
    cy.findByRole('dialog').findByRole('button', { name: 'Delete' }).click()
    cy.findByRole('treeitem', { name: 'notes.txt' }).should('not.exist')
    waitForProjectUpdated()

    openSyncModalInEditor()
    syncNow()
    expectUpToDate()
    repoFiles(fullName).then(repoFiles => {
      expect(Object.keys(repoFiles).sort()).to.deep.equal([
        '.gitea/workflows/build.yml',
        '.gitignore',
        'main.tex',
        'part.tex',
      ])
      expect(repoFiles['part.tex']).to.equal('Chapter text')
    })
    // The default message when none was given
    repoCommits(fullName)
      .its('0.commit.message')
      .invoke('trim')
      .should('equal', 'Updates from Overleaf')
  })

  it('pulls binary files from Gitea', function () {
    // A 1x1 PNG
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    commitOnGitea(fullName, { 'figures/dot.png': { base64: png } }, 'Add a figure')
    openGiteaSyncModal(projectId)
    syncNow()
    expectUpToDate()
    cy.request(`/project/${projectId}/entities`)
      .its('body.entities')
      .should('deep.include', { path: '/figures/dot.png', type: 'file' })
  })

  it('warns about a force push and takes over the rewritten branch', function () {
    forcePushOnGitea(fullName, {
      'main.tex': main.replace('First line', 'Rewritten history'),
    })
    openGiteaSyncModal(projectId)
    syncModal().should('contain.text', 'has been force-pushed')
    syncNow()
    expectUpToDate()
    cy.get('.cm-content').should('contain.text', 'Rewritten history')
    entityPaths().should('deep.equal', ['/main.tex'])
  })

  it('merges Overleaf edits into a force-pushed branch', function () {
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    forcePushOnGitea(fullName, {
      'main.tex': main,
      'chapter.tex': 'Chapter rewritten on Gitea',
    })
    openSyncModalInEditor()
    syncModal().should('contain.text', 'has been force-pushed')
    syncNow()
    expectUpToDate()
    repoFiles(fullName).then(repoFiles => {
      expect(repoFiles['main.tex']).to.contain('Main from Overleaf')
      expect(repoFiles['chapter.tex']).to.equal('Chapter rewritten on Gitea')
    })
    projectSyncState(projectId).its('mergeStatus').should('equal', 'clean')
  })

  it('pushes an empty file created in Overleaf into a force-pushed branch', function () {
    openProject(projectId)
    openRailTab('File tree')
    cy.findByRole('button', { name: 'New file' }).click()
    cy.findByRole('dialog').within(() => {
      cy.findByLabelText(/^File name$/i).clear().type('empty.tex')
      cy.findByRole('button', { name: 'Create' }).click()
    })
    cy.findByRole('treeitem', { name: 'empty.tex' }).should('exist')
    waitForProjectUpdated()
    forcePushOnGitea(fullName, {
      'main.tex': main,
      'chapter.tex': 'Chapter rewritten on Gitea',
    })
    openSyncModalInEditor()
    syncModal().should('contain.text', 'has been force-pushed')
    syncNow()
    expectUpToDate()
    repoFiles(fullName).should('have.property', 'empty.tex', '')
  })

  it('offers to unlink a repository the user can no longer push to', function () {
    protectMain(fullName, { enable_push: false })
    openGiteaSyncModal(projectId)
    syncModal()
      .should('contain.text', 'you no longer have access to it')
      .findByRole('button', { name: 'Unlink Gitea repository' })
      .click()
    projectSyncState(projectId).its('mergeStatus').should('equal', 'need-export')
  })
})

describe('collaborators', function () {
  const collaborator = `gitea-collaborator-${Date.now()}@example.com`

  before(function () {
    ensureUserExists(collaborator)
  })

  it('only lets the owner link a project', function () {
    createProject(projectName('Shared')).then(projectId => {
      shareProject(projectId, collaborator, 'readAndWrite')
      linkGiteaAccount(GITEA_COLLABORATOR)
      openGiteaSyncModal(projectId)
      syncModal().should(
        'contain.text',
        'Only the project owner can link this project to a Gitea repository.'
      )
      syncModal()
        .findByRole('button', { name: 'Create a Gitea repository' })
        .should('not.exist')
      // Nor through the API: no repository is created or linked
      const name = projectName('FromEditor')
      postWithCsrf(`/project/${projectId}/gitea-sync/export`, { name })
        .its('status')
        .should('equal', 403)
      projectSyncState(projectId).its('mergeStatus').should('equal', 'need-export')
      cy.request({
        url: `${GITEA_URL}/api/v1/repos/${GITEA_COLLABORATOR}/${name}`,
        auth: { user: GITEA_COLLABORATOR, pass: Cypress.env('GITEA_PASSWORD') },
        failOnStatusCode: false,
      })
        .its('status')
        .should('equal', 404)
    })
  })

  it('lets an editor with push access sync a linked project but not unlink it', function () {
    const name = projectName('Shared')
    const fullName = `${GITEA_USER}/${name}`
    // A full document, so that Overleaf picks it as the main document
    seedRepo(name, {
      'main.tex': [
        '\\documentclass{article}',
        '\\begin{document}',
        '\\section{Introduction}',
        '\\end{document}',
      ].join('\n'),
    })
    giteaApi('PUT', `repos/${fullName}/collaborators/${GITEA_COLLABORATOR}`, {
      permission: 'write',
    })
    linkGiteaAccount()
    postWithCsrf('/project/new/gitea-sync', {
      name,
      fullName,
      defaultBranchName: 'main',
    }).then(response => {
      const projectId = response.body.projectId as string
      shareProject(projectId, collaborator, 'readAndWrite')
      linkGiteaAccount(GITEA_COLLABORATOR)
      commitOnGitea(fullName, { 'notes.txt': 'From Gitea' }, 'Notes on Gitea')
      openGiteaSyncModal(projectId)
      syncModal().findByText('Recent commits in Gitea').should('exist')
      syncModal().findByRole('button', { name: 'Sync' }).click()
      syncModal()
        .findByText('No new commits in Gitea since last merge.')
        .should('exist')
      // Unlinking is the owner's call
      requestWithCsrf('DELETE', `/project/${projectId}/gitea-sync`).then(response => {
        expect(response.status).to.equal(403)
        expect(response.body.ownerEmail).to.equal(ADMIN_EMAIL)
      })
      projectSyncState(projectId).its('mergeStatus').should('equal', 'clean')
    })
  })

  it('asks an editor without push access to get it from the owner', function () {
    const name = projectName('Shared')
    seedRepo(name, {
      'main.tex': [
        '\\documentclass{article}',
        '\\begin{document}',
        '\\section{Introduction}',
        '\\end{document}',
      ].join('\n'),
    })
    linkGiteaAccount()
    postWithCsrf('/project/new/gitea-sync', {
      name,
      fullName: `${GITEA_USER}/${name}`,
      defaultBranchName: 'main',
    }).then(response => {
      const projectId = response.body.projectId as string
      shareProject(projectId, collaborator, 'readAndWrite')
      linkGiteaAccount(GITEA_COLLABORATOR)
      projectSyncState(projectId).should('deep.include', {
        mergeStatus: 'need-permission',
        ownerEmail: ADMIN_EMAIL,
      })
    })
  })

  it('keeps viewers out of the project routes', function () {
    createProject(projectName('Shared')).then(projectId => {
      shareProject(projectId, collaborator, 'readOnly')
      cy.visit('/project')
      for (const url of [
        `/project/${projectId}/gitea-sync/state`,
        `/project/${projectId}/gitea-sync/merge/overview`,
      ]) {
        cy.request({ url, failOnStatusCode: false })
          .its('status')
          .should('equal', 403)
      }
      postWithCsrf(`/project/${projectId}/gitea-sync/export`, {
        name: 'from-a-viewer',
      })
        .its('status')
        .should('equal', 403)
    })
  })
})
