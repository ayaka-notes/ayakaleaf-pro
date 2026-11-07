import { login } from '../../../helpers/login'
import { expectOwnAuditEntry, expectProjectAuditEntry } from '../../../helpers/auditLog'
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

// GitLab Sync against services/gitlab-mock, which answers as the self-managed
// GitLab gitlab.example.com on the toolkit's network. Its control API resets
// it, seeds projects and reads back what Overleaf pushed.

const GITLAB_URL = 'https://gitlab.example.com'
const GITLAB_USER = 'e2e-tanuki'
const GITLAB_GROUP = 'e2e-group'

// File contents for the mock: text, binary, generated random bytes, or null
// to delete the file
type Change =
  | string
  | { base64: string }
  | { randomBytes: number }
  | { lfs: string }
  | null

type MockCommit = {
  id: string
  message: string
  parent_ids: string[]
}

type MockRepo = {
  visibility: string
  description: string
  head: string
  branches: Record<string, string>
  files: Record<string, string>
  commits: MockCommit[]
  mergeRequests: { iid: number; state: string; sourceBranch: string }[]
}

type MockSettings = {
  push?: boolean
  owner?: boolean
  approvalsRequired?: boolean
  pipelineRequired?: boolean
}

function mock(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: object
) {
  return cy.request({
    method,
    url: `http://gitlab-mock:8080/_mock${path}`,
    body,
  })
}

function mockRepo(fullName: string): Cypress.Chainable<MockRepo> {
  return mock('GET', `/repos/${fullName}`).its('body')
}

// GitLab derives the project path from the name: lowercase
function seedRepo(name: string, files: Record<string, Change>) {
  return mock('POST', '/repos', { name, files })
}

function repoSettings(fullName: string, settings: MockSettings) {
  return mock('PUT', `/repos/${fullName}/settings`, settings)
}

function mockTokens(): Cypress.Chainable<{
  tokens: { revoked: boolean }[]
  refreshes: number
}> {
  return mock('GET', '/tokens').its('body')
}

// Retries until every token handed out was revoked. Overleaf revokes in the
// background after unlinking.
function expectTokensRevoked(attempts = 20) {
  mockTokens().then(({ tokens }) => {
    expect(tokens).to.have.length.greaterThan(0)
    if (tokens.every(token => token.revoked)) return
    expect(attempts, 'tokens revoked').to.be.greaterThan(0)
    cy.wait(500)
    expectTokensRevoked(attempts - 1)
  })
}

function gitlabWidget() {
  return cy.contains('.settings-widget-container', 'GitLab')
}

function connectionStatus() {
  return cy.request('/user/gitlab-sync/status').its('body')
}

function projectSyncState(projectId: string) {
  return cy.request(`/project/${projectId}/gitlab-sync/state`).its('body')
}

// The settings page's Link button runs the whole OAuth flow: Overleaf sends
// the browser to GitLab, which sends it back with a code.
function linkGitLabAccount() {
  cy.visit('/user/settings')
  gitlabWidget().findByRole('link', { name: 'Link' }).click()
  cy.location('search').should('contain', 'oauth-complete=gitlab')
  gitlabWidget().findByRole('button', { name: 'Unlink' }).should('exist')
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
  cy.findByRole('button', { name: /GitLab/ }).click()
  return syncModal().should('be.visible')
}

function openGitLabSyncModal(projectId: string) {
  openProject(projectId)
  return openSyncModalInEditor()
}

function syncModal() {
  return cy.contains('[role="dialog"]', 'Sync with GitLab')
}

before(function () {
  ensureAdminExists()
})

beforeEach(function () {
  mock('POST', '/reset')
  login(ADMIN_EMAIL)
})

describe('linking the GitLab account', function () {
  it('links through the OAuth application and unlinks again', function () {
    cy.visit('/user/settings')
    gitlabWidget()
      .findByRole('link', { name: 'Link' })
      .should('have.attr', 'href', '/user/gitlab-sync/oauth2')
    gitlabWidget().should(
      'contain.text',
      'With GitLab Sync you can link your'
    )
    connectionStatus().should('equal', false)

    linkGitLabAccount()
    cy.contains('successfully linked your GitLab account').should('exist')
    connectionStatus().should('equal', true)

    gitlabWidget().findByRole('button', { name: 'Unlink' }).click()
    cy.findByRole('dialog')
      .should('contain.text', 'Unlink GitLab Account')
      .and('contain.text', 'relink your GitLab account')
      .findByRole('button', { name: 'Unlink' })
      .click()
    gitlabWidget().findByRole('link', { name: 'Link' }).should('exist')
    connectionStatus().should('equal', false)
    expectTokensRevoked()
    expectOwnAuditEntry(ADMIN_EMAIL, 'integration-account-linked')
      .its('info.integration')
      .should('equal', 'gitlab')
    expectOwnAuditEntry(ADMIN_EMAIL, 'integration-account-unlinked')
      .its('info.integration')
      .should('equal', 'gitlab')
  })

  it('sends the application id, callback, scope and a state to GitLab', function () {
    cy.visit('/user/settings')
    cy.request({ url: '/user/gitlab-sync/oauth2', followRedirect: false }).then(
      response => {
        expect(response.status).to.equal(302)
        const url = new URL(response.redirectedToUrl!)
        expect(url.origin + url.pathname).to.equal(
          `${GITLAB_URL}/oauth/authorize`
        )
        expect(url.searchParams.get('client_id')).to.equal('e2e-gitlab-client')
        expect(url.searchParams.get('redirect_uri')).to.equal(
          'http://sharelatex/user/gitlab-sync/oauth2/callback'
        )
        expect(url.searchParams.get('response_type')).to.equal('code')
        expect(url.searchParams.get('scope')).to.equal('api')
        expect(url.searchParams.get('state')).to.have.length.greaterThan(0)
      }
    )
  })

  it('refuses a callback without a valid state', function () {
    cy.request({
      url: '/user/gitlab-sync/oauth2/callback?code=anything&state=forged',
      failOnStatusCode: false,
    })
      .its('status')
      .should('equal', 403)
    connectionStatus().should('equal', false)
  })

  it('stays unlinked when the user does not authorize the application', function () {
    mock('POST', '/deny-next-authorize')
    cy.visit('/user/settings')
    gitlabWidget().findByRole('link', { name: 'Link' }).click()
    cy.location('pathname').should('equal', '/user/gitlab-sync/oauth2/callback')
    connectionStatus().should('equal', false)
    cy.visit('/user/settings')
    gitlabWidget().findByRole('link', { name: 'Link' }).should('exist')
  })

  it('shows the account as unlinked once its token was revoked on GitLab', function () {
    linkGitLabAccount()
    mock('POST', '/tokens/revoke')
    cy.visit('/user/settings')
    gitlabWidget().findByRole('link', { name: 'Link' }).should('exist')
    connectionStatus().should('equal', false)
  })

  it('refreshes an expiring access token with the refresh token', function () {
    // Tokens that expire within Overleaf's refresh margin get refreshed on
    // their next use
    mock('PUT', '/token-ttl', { seconds: 60 })
    linkGitLabAccount()
    // The settings page checked the connection with a refreshed token
    mockTokens().then(({ refreshes }) => {
      expect(refreshes).to.be.greaterThan(0)

      // The rotated refresh token keeps working
      connectionStatus().should('equal', true)
      mockTokens().then(after => {
        expect(after.refreshes).to.equal(refreshes + 1)
        // GitLab revoked every access token a refresh replaced
        expect(after.tokens.filter(token => !token.revoked)).to.have.length(1)
      })
    })
  })

  it('shows the account as unlinked once the refresh token was revoked', function () {
    mock('PUT', '/token-ttl', { seconds: 60 })
    linkGitLabAccount()
    mock('POST', '/tokens/revoke')
    connectionStatus().should('equal', false)
  })

  describe('when connecting to GitLab takes over a second', function () {
    afterEach(function () {
      mock('POST', '/connect-delay', { ms: 0 })
    })

    it('links the account and unlinks it again', function () {
      // fetch-utils' default agent gives up connecting after 1s
      mock('POST', '/connect-delay', { ms: 1200 })
      linkGitLabAccount()
      connectionStatus().should('equal', true)

      gitlabWidget().findByRole('button', { name: 'Unlink' }).click()
      cy.findByRole('dialog').findByRole('button', { name: 'Unlink' }).click()
      gitlabWidget().findByRole('link', { name: 'Link' }).should('exist')
      connectionStatus().should('equal', false)
    })
  })
})

describe('linking a project to a repository', function () {
  it('asks to link the GitLab account first', function () {
    createProject(projectName('GitLab')).then(projectId => {
      openGitLabSyncModal(projectId)
      // The editor runs the OAuth flow in a popup
      cy.window().then(win => cy.stub(win, 'open').as('popup'))
      syncModal()
        .findByRole('button', { name: 'Link to your GitLab account' })
        .click()
      cy.get('@popup').should(
        'have.been.calledWith',
        '/user/gitlab-sync/oauth2'
      )
    })
  })

  it('exports a project into a new private project', function () {
    const name = projectName('GitLab')
    const fullName = `${GITLAB_USER}/${name.toLowerCase()}`
    linkGitLabAccount()
    createProject(name).then(projectId => {
      openGitLabSyncModal(projectId)
      syncModal().within(() => {
        cy.findByText('Export Project to GitLab').should('exist')
        cy.findByLabelText('Owner').should('have.value', GITLAB_USER)
        cy.findByLabelText('Repository Name').should('have.value', name)
        cy.findByLabelText('Description (Optional)').type('Exported in e2e')
        cy.findByRole('button', { name: 'Create a GitLab repository' }).click()
        cy.contains('This project is linked to')
          .findByRole('link', { name: fullName })
          .should('have.attr', 'href', `${GITLAB_URL}/${fullName}`)
      })
      projectSyncState(projectId).should('deep.include', {
        mergeStatus: 'clean',
        repoFullName: fullName,
      })
      mockRepo(fullName).then(repo => {
        expect(repo.visibility).to.equal('private')
        expect(repo.description).to.equal('Exported in e2e')
        expect(Object.keys(repo.files)).to.deep.equal(['main.tex'])
        expect(repo.files['main.tex']).to.contain('\\section{Introduction}')
        expect(repo.commits.map(c => c.message)).to.deep.equal([
          'Initial Overleaf import',
        ])
        expect(Object.keys(repo.branches)).to.deep.equal(['main'])
      })
      expectProjectAuditEntry(projectId, 'integration-repo-linked', ADMIN_EMAIL)
        .its('info.integration')
        .should('equal', 'gitlab')
    })
  })

  it('exports into a public project of a group', function () {
    const name = projectName('GitLab')
    linkGitLabAccount()
    createProject(name).then(projectId => {
      openGitLabSyncModal(projectId)
      syncModal().within(() => {
        cy.findByLabelText('Owner').select(GITLAB_GROUP)
        cy.findByLabelText('Organization').should('have.value', GITLAB_GROUP)
        cy.findByLabelText(/Public/).check()
        cy.findByRole('button', { name: 'Create a GitLab repository' }).click()
        cy.findByRole('link', {
          name: `${GITLAB_GROUP}/${name.toLowerCase()}`,
        }).should('exist')
      })
      mockRepo(`${GITLAB_GROUP}/${name.toLowerCase()}`)
        .its('visibility')
        .should('equal', 'public')
    })
  })

  it('does not export into a project that exists', function () {
    const name = projectName('GitLab')
    const fullName = `${GITLAB_USER}/${name.toLowerCase()}`
    seedRepo(name, { 'README.md': 'Taken' })
    linkGitLabAccount()
    createProject(name).then(projectId => {
      openGitLabSyncModal(projectId)
      syncModal().within(() => {
        cy.findByRole('button', { name: 'Create a GitLab repository' }).click()
        cy.findByRole('alert').should('exist')
        cy.findByText('Export Project to GitLab').should('exist')
      })
      projectSyncState(projectId)
        .its('mergeStatus')
        .should('equal', 'need-export')
      mockRepo(fullName)
        .its('files')
        .should('deep.equal', { 'README.md': 'Taken' })
    })
  })

  it('unlinks a project from its repository', function () {
    const name = projectName('GitLab')
    linkGitLabAccount()
    createProject(name).then(projectId => {
      openGitLabSyncModal(projectId)
      syncModal()
        .findByRole('button', { name: 'Create a GitLab repository' })
        .click()
      syncModal().findByRole('button', { name: 'Unlink' }).click()
      syncModal().within(() => {
        cy.contains('This project is linked to').should('exist')
        cy.findByRole('button', { name: 'Confirm' }).click()
        cy.findByText('Export Project to GitLab').should('exist')
      })
      projectSyncState(projectId)
        .its('mergeStatus')
        .should('equal', 'need-export')
      // The project stays on GitLab
      mockRepo(`${GITLAB_USER}/${name.toLowerCase()}`)
        .its('files')
        .should('have.property', 'main.tex')
      expectProjectAuditEntry(projectId, 'integration-repo-unlinked', ADMIN_EMAIL)
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
    'sections/intro.tex': '\\section{Introduction}\nImported from GitLab',
  }

  function openImportModal() {
    cy.visit('/project')
    cy.findAllByRole('button', { name: 'New project' }).first().click()
    cy.findByRole('menuitem', { name: 'Import from GitLab' }).click()
    return cy.contains('[role="dialog"]', 'Import from GitLab')
  }

  it('asks to link the GitLab account first', function () {
    openImportModal()
      .findByRole('link', { name: 'Link to your GitLab account' })
      .should('have.attr', 'href', '/user/gitlab-sync/oauth2')
  })

  it('refuses a repository archive larger than the upload limit', function () {
    const name = projectName('Huge')
    // Just above the default MAX_UPLOAD_SIZE of 50 MB; random bytes do not
    // compress, so the archive is that large too
    seedRepo(name, {
      'main.tex': files['main.tex'],
      'data.bin': { randomBytes: 51 * 1024 * 1024 },
    })
    linkGitLabAccount()
    postWithCsrf('/project/new/gitlab-sync', {
      name,
      fullName: `${GITLAB_USER}/${name.toLowerCase()}`,
      defaultBranchName: 'main',
    }).then(response => {
      expect(response.status).to.equal(422)
      expect(response.body.message).to.equal('File too large')
    })
    cy.request('/user/projects')
      .its('body.projects')
      .then((projects: { name: string }[]) => projects.map(p => p.name))
      .should('not.include', name)
  })

  it('imports a repository into a linked project', function () {
    const name = projectName('Repo')
    const fullName = `${GITLAB_USER}/${name.toLowerCase()}`
    seedRepo(name, files)
    linkGitLabAccount()
    openImportModal().within(() => {
      cy.findByText(
        'Select a GitLab repository to import into Our Overleaf Instance.'
      ).should('exist')
      cy.contains('tr', name)
        .findByRole('link', { name: fullName })
        .should('have.attr', 'href', `${GITLAB_URL}/${fullName}`)
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
    const fullName = `${GITLAB_USER}/${name.toLowerCase()}`
    seedRepo(name, {
      'main.tex': [
        '\\documentclass{article}',
        '\\begin{document}',
        '\\section{Introduction}',
        '\\end{document}',
      ].join('\n'),
      'data.txt': { lfs: 'Large data' },
    })
    linkGitLabAccount()
    postWithCsrf('/project/new/gitlab-sync', {
      name,
      fullName,
      defaultBranchName: 'main',
    }).then(response => {
      expect(response.status).to.equal(200)
      const projectId = response.body.projectId
      mock('POST', `/repos/${fullName}/commits`, {
        files: { 'notes.txt': 'Notes' },
        message: 'Add notes',
      })
      openProject(projectId)
      openRailTab('File tree')
      cy.findByRole('treeitem', { name: 'data.txt' }).click()
      cy.get('.cm-content').should('contain.text', 'oid sha256:')
      openSyncModalInEditor()
      syncModal().findByRole('button', { name: 'Sync' }).click()
      syncModal()
        .findByText('No new commits in GitLab since last merge.')
        .should('exist')
      // the pull left the pointer alone, so nothing went back to GitLab
      mockRepo(fullName).then(repo => {
        expect(repo.files['data.txt']).to.match(/^version https:\/\/git-lfs\.github\.com\/spec\/v1\n/)
        expect(repo.commits.map(c => c.message)).not.to.include('Updates from Overleaf')
      })
    })
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
  const files = {
    'main.tex': main,
    'chapter.tex': 'Chapter text',
    'notes.txt': 'Notes',
    // not imported: Overleaf ignores dotfiles
    '.gitignore': '*.aux',
    '.gitlab-ci.yml': 'build:\n  script: latexmk',
  }

  let name: string
  let fullName: string
  let projectId: string

  // A repository imported over HTTP, the way the import modal does it
  beforeEach(function () {
    name = projectName('Sync')
    fullName = `${GITLAB_USER}/${name.toLowerCase()}`
    seedRepo(name, files)
    linkGitLabAccount()
    postWithCsrf('/project/new/gitlab-sync', {
      name,
      fullName,
      defaultBranchName: 'main',
    }).then(response => {
      expect(response.status).to.equal(200)
      projectId = response.body.projectId
    })
  })

  // A push to main on GitLab; with merge, a merge commit of that branch
  function commitOnGitLab(
    changes: Record<string, Change>,
    message: string,
    merge?: string
  ) {
    return mock('POST', `/repos/${fullName}/commits`, {
      files: changes,
      message,
      merge,
    })
  }

  // With gc, the commits only the branch reached are cleaned up too
  function deleteBranchOnGitLab(branch: string, gc = false) {
    return mock(
      'DELETE',
      `/repos/${fullName}/branches/${branch}${gc ? '?gc=true' : ''}`
    )
  }

  function mergeOverview() {
    return cy
      .request(`/project/${projectId}/gitlab-sync/merge/overview`)
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
      .findByText('No new commits in GitLab since last merge.')
      .should('exist')
  }

  function expectManualMerge() {
    syncModal()
      .should(
        'contain.text',
        'Your changes in Our Overleaf Instance and GitLab could not be automatically merged.'
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

  it('pulls commits made on GitLab into the project', function () {
    commitOnGitLab(
      {
        'chapter.tex': 'Chapter text edited on GitLab',
        'appendix.tex': 'Appendix from GitLab',
        'notes.txt': null,
      },
      'Edit on GitLab'
    )
    openGitLabSyncModal(projectId)
    syncModal().within(() => {
      cy.findByText('Recent commits in GitLab').should('exist')
      cy.findAllByRole('link', { name: 'Edit on GitLab' })
        .first()
        .should('have.attr', 'href')
        .and('match', new RegExp(`^${GITLAB_URL}/${fullName}/-/commit/[0-9a-f]{40}$`))
      cy.findByText(`by E2E Tanuki <${GITLAB_USER}@example.com>`).should(
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
    cy.get('.cm-content').should(
      'contain.text',
      'Chapter text edited on GitLab'
    )
    projectSyncState(projectId).its('mergeStatus').should('equal', 'clean')
  })

  it('pushes changes made in Overleaf to GitLab', function () {
    openProject(projectId)
    editMainInOverleaf('Written in Overleaf')
    openSyncModalInEditor()
    syncModal()
      .findByPlaceholderText(/Commit message for changes made in/)
      .type('Edit in Overleaf')
    syncNow()
    expectUpToDate()
    mockRepo(fullName).then(repo => {
      expect(repo.files['main.tex']).to.contain(
        'First line\nWritten in Overleaf'
      )
      expect(repo.files['chapter.tex']).to.equal('Chapter text')
      const head = repo.commits[repo.commits.length - 1]
      expect(head.message).to.equal('Edit in Overleaf')
      // A fast forward: no merge commit, no merge request
      expect(head.parent_ids).to.have.length(1)
      expect(repo.mergeRequests).to.deep.equal([])
      expect(Object.keys(repo.branches)).to.deep.equal(['main'])
    })
    // Syncing again finds nothing to do
    mergeOverview().should('deep.include', {
      commits: [],
      isProjectUpdated: false,
    })
  })

  it('does not overwrite a push to GitLab made while syncing', function () {
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    // Lands after Overleaf saw an unchanged main, before it commits
    mock('POST', `/repos/${fullName}/push-before-next-commit`, {
      files: { 'main.tex': main.replace('First line', 'First line from GitLab') },
      message: 'Main on GitLab',
    })
    openSyncModalInEditor()
    syncNow()
    syncModal().should('contain.text', 'Sorry, something went wrong')
    mockRepo(fullName).then(repo => {
      expect(repo.files['main.tex']).to.contain('First line from GitLab')
      expect(repo.files['main.tex']).not.to.contain('Main from Overleaf')
    })
    // The next sync sees the push and merges both sides
    syncModal().findByRole('button', { name: 'Close' }).click()
    openSyncModalInEditor()
    syncNow()
    expectManualMerge()
    projectSyncState(projectId).its('mergeStatus').should('equal', 'conflict')
  })

  // Syncs, typing in main.tex while the pull downloads the first file
  function pullWhileEditing() {
    // The pull waits on that download; the page's own request is not
    // awaited so that the edit below lands in the middle of it
    mock('POST', '/delay-next-download', { ms: 8000 })
    cy.get('meta[name="ol-csrfToken"]')
      .invoke('attr', 'content')
      .then(csrfToken => {
        cy.window().then(win => {
          // a promise on the window, cy.wrap would wait for it right away
          ;(win as any).pull = win
            .fetch(`/project/${projectId}/gitlab-sync/merge`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Csrf-Token': csrfToken as string,
              },
              body: JSON.stringify({ message: '', claimConflictIsResolved: false }),
            })
            .then(response => response.json())
        })
      })
    cy.findByRole('textbox', { name: 'Source Editor editing' }).within(() => {
      cy.findByText('First line').click()
      cy.findByText('First line').type('{end}\nWritten while pulling')
    })
    cy.window()
      .then(win => cy.wrap((win as any).pull, { timeout: 30000 }))
      .its('mergeStatus')
      .should('equal', 'clean')
  }

  it('keeps edits made in Overleaf while pulling for the next sync', function () {
    commitOnGitLab({ 'chapter.tex': 'Chapter from GitLab' }, 'Chapter on GitLab')
    openProject(projectId)
    pullWhileEditing()
    mockRepo(fullName).then(repo => {
      expect(repo.files['main.tex']).not.to.contain('Written while pulling')
      expect(repo.files['chapter.tex']).to.equal('Chapter from GitLab')
    })
    // The edit is still pending and goes out with the next sync
    waitForProjectUpdated()
    openSyncModalInEditor()
    syncNow()
    expectUpToDate()
    mockRepo(fullName).then(repo => {
      expect(repo.files['main.tex']).to.contain('First line\nWritten while pulling')
      expect(repo.files['chapter.tex']).to.equal('Chapter from GitLab')
    })
  })

  it('pushes a file pulled while editing, then deleted in Overleaf', function () {
    commitOnGitLab({ 'appendix.tex': 'Appendix from GitLab' }, 'Add appendix')
    openProject(projectId)
    pullWhileEditing()
    openFile('appendix.tex')
    cy.findByRole('button', { name: 'Open appendix.tex action menu' }).click()
    cy.findByRole('menuitem', { name: 'Delete' }).click()
    cy.findByRole('dialog').findByRole('button', { name: 'Delete' }).click()
    cy.findByRole('treeitem', { name: 'appendix.tex' }).should('not.exist')
    waitForProjectUpdated()

    openSyncModalInEditor()
    syncNow()
    expectUpToDate()
    mockRepo(fullName).then(repo => {
      expect(Object.keys(repo.files).sort()).to.deep.equal([
        '.gitignore',
        '.gitlab-ci.yml',
        'chapter.tex',
        'main.tex',
        'notes.txt',
      ])
      expect(repo.files['main.tex']).to.contain('Written while pulling')
    })
    entityPaths().should('not.include', '/appendix.tex')
  })

  it('merges changes made on both sides through a merge request', function () {
    commitOnGitLab(
      { 'chapter.tex': 'Chapter from GitLab' },
      'Chapter on GitLab'
    )
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncModal()
      .findAllByRole('link', { name: 'Chapter on GitLab' })
      .should('exist')
    syncNow()
    expectUpToDate()
    mockRepo(fullName).then(repo => {
      expect(repo.files['main.tex']).to.contain('Main from Overleaf')
      expect(repo.files['chapter.tex']).to.equal('Chapter from GitLab')
      const head = repo.commits.find(c => c.id === repo.head)!
      expect(head.parent_ids, 'merge commit').to.have.length(2)
      // The temporary branch is gone again, and so is the merge request,
      // which the project owner may delete
      expect(Object.keys(repo.branches)).to.deep.equal(['main'])
      expect(repo.mergeRequests).to.deep.equal([])
    })
    syncModal().findByRole('button', { name: 'Close' }).click()
    openFile('chapter.tex')
    cy.get('.cm-content').should('contain.text', 'Chapter from GitLab')
  })

  it('keeps the merged merge request when the user may not delete it', function () {
    // A maintainer, not the owner, of the project
    repoSettings(fullName, { owner: false })
    commitOnGitLab({ 'chapter.tex': 'Chapter from GitLab' }, 'Chapter on GitLab')
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncNow()
    expectUpToDate()
    mockRepo(fullName).then(repo => {
      expect(repo.files['main.tex']).to.contain('Main from Overleaf')
      expect(Object.keys(repo.branches)).to.deep.equal(['main'])
      expect(repo.mergeRequests).to.have.length(1)
      expect(repo.mergeRequests[0].state).to.equal('merged')
    })
    projectSyncState(projectId).its('mergeStatus').should('equal', 'clean')
  })

  it('stops on a conflict and continues after a manual merge', function () {
    commitOnGitLab(
      { 'main.tex': main.replace('First line', 'First line from GitLab') },
      'Main on GitLab'
    )
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncNow()
    expectManualMerge()
    projectSyncState(projectId).then(state => {
      cy.wrap(state.unmergedBranchName).as('unmergedBranch')
      expect(state.mergeStatus).to.equal('conflict')
      expect(state.unmergedBranchName).to.match(
        /^overleaf-\d{4}-\d{2}-\d{2}-\d{6}$/
      )
      // Overleaf's side waits on its own branch, with its merge request
      // left open for the user
      mockRepo(fullName).then(repo => {
        expect(repo.branches).to.have.property(state.unmergedBranchName)
        expect(repo.files['main.tex']).to.contain('First line from GitLab')
        expect(repo.files['main.tex']).not.to.contain('Main from Overleaf')
        expect(repo.mergeRequests).to.deep.equal([
          {
            iid: 1,
            state: 'opened',
            sourceBranch: state.unmergedBranchName,
            targetBranch: 'main',
          },
        ])
      })
    })

    // Reopening the modal shows the conflict until it is resolved
    syncModal().findByRole('button', { name: 'Close' }).click()
    openSyncModalInEditor()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .should('exist')

    // The user merges Overleaf's branch on GitLab, then continues
    const resolved = main.replace(
      'First line',
      'First line from GitLab\nMain from Overleaf'
    )
    cy.get<string>('@unmergedBranch').then(branch => {
      commitOnGitLab({ 'main.tex': resolved }, 'Merge Overleaf changes', branch)
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
      .should('contain.text', 'First line from GitLab')
      .and('contain.text', 'Main from Overleaf')
  })

  for (const [rule, settings] of [
    ['an approval', { approvalsRequired: true }],
    ['a passing pipeline', { pipelineRequired: true }],
  ] as const) {
    it(`leaves the merge to the user when GitLab requires ${rule}`, function () {
      repoSettings(fullName, settings)
      commitOnGitLab({ 'chapter.tex': 'Chapter from GitLab' }, 'Chapter on GitLab')
      openProject(projectId)
      editMainInOverleaf('Main from Overleaf')
      openSyncModalInEditor()
      syncNow()
      expectManualMerge()
      projectSyncState(projectId).then(state => {
        expect(state.mergeStatus).to.equal('conflict')
        mockRepo(fullName).then(repo => {
          // Nothing was merged behind the rule's back
          expect(repo.files['main.tex']).not.to.contain('Main from Overleaf')
          expect(repo.mergeRequests).to.have.length(1)
          expect(repo.mergeRequests[0]).to.deep.include({
            state: 'opened',
            sourceBranch: state.unmergedBranchName,
          })
        })
        // Once the rule is met, the user merges the merge request on GitLab
        commitOnGitLab(
          {
            'main.tex': main.replace(
              'First line',
              'First line\nMain from Overleaf'
            ),
          },
          'Merge Overleaf changes',
          state.unmergedBranchName
        )
      })
      syncModal()
        .findByRole('button', { name: 'I have manually merged. Continue' })
        .click()
      expectUpToDate()
      projectSyncState(projectId).its('mergeStatus').should('equal', 'clean')
      mockRepo(fullName).then(repo => {
        expect(repo.files['main.tex']).to.contain('Main from Overleaf')
        expect(repo.files['chapter.tex']).to.equal('Chapter from GitLab')
        expect(repo.mergeRequests.map(mr => mr.state)).to.deep.equal([
          'merged',
        ])
      })
    })
  }

  it('keeps the conflict when the user continues without merging', function () {
    commitOnGitLab(
      { 'main.tex': main.replace('First line', 'First line from GitLab') },
      'Main on GitLab'
    )
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncNow()
    expectManualMerge()
    projectSyncState(projectId).then(state => {
      cy.wrap(state.unmergedBranchName).as('unmergedBranch')
    })

    // The merge request is not merged on GitLab: GitLab's side must not
    // replace Overleaf's changes
    syncModal()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .click()
    expectManualMerge()
    syncModal()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .should('exist')
    cy.get<string>('@unmergedBranch').then(branch => {
      projectSyncState(projectId).should('deep.include', {
        mergeStatus: 'conflict',
        unmergedBranchName: branch,
      })
      mockRepo(fullName).then(repo => {
        expect(repo.branches).to.have.property(branch)
        expect(repo.files['main.tex']).not.to.contain('Main from Overleaf')
        expect(repo.mergeRequests).to.deep.equal([
          {
            iid: 1,
            state: 'opened',
            sourceBranch: branch,
            targetBranch: 'main',
          },
        ])
      })
    })
    openProject(projectId)
    cy.get('.cm-content')
      .should('contain.text', 'Main from Overleaf')
      .and('not.contain.text', 'First line from GitLab')
  })

  it('rebuilds a branch deleted without merging', function () {
    commitOnGitLab(
      { 'main.tex': main.replace('First line', 'First line from GitLab') },
      'Main on GitLab'
    )
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncNow()
    expectManualMerge()
    // The branch is deleted and its commit cleaned up on GitLab
    projectSyncState(projectId).then(state => {
      deleteBranchOnGitLab(state.unmergedBranchName, true)
    })

    // Nothing is left to merge: the branch is rebuilt from the Overleaf
    // history and the conflict stays, GitLab's side replaces nothing
    syncModal()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .click()
    expectManualMerge()
    projectSyncState(projectId).then(state => {
      expect(state.mergeStatus).to.equal('conflict')
      cy.wrap(state.unmergedBranchName).as('rebuiltBranch')
      mockRepo(fullName).then(repo => {
        expect(repo.branches).to.have.property(state.unmergedBranchName)
        expect(repo.files['main.tex']).to.contain('First line from GitLab')
        expect(repo.files['main.tex']).not.to.contain('Main from Overleaf')
      })
    })
    openProject(projectId)
    cy.get('.cm-content')
      .should('contain.text', 'Main from Overleaf')
      .and('not.contain.text', 'First line from GitLab')

    // The user merges the rebuilt branch, then continues
    cy.get<string>('@rebuiltBranch').then(branch => {
      commitOnGitLab(
        {
          'main.tex': main.replace(
            'First line',
            'First line from GitLab\nMain from Overleaf'
          ),
        },
        'Merge Overleaf changes',
        branch
      )
    })
    openSyncModalInEditor()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .click()
    expectUpToDate()
    projectSyncState(projectId).its('mergeStatus').should('equal', 'clean')
    cy.get('.cm-content')
      .should('contain.text', 'First line from GitLab')
      .and('contain.text', 'Main from Overleaf')
  })

  it('continues when the branch was deleted after merging', function () {
    commitOnGitLab(
      { 'main.tex': main.replace('First line', 'First line from GitLab') },
      'Main on GitLab'
    )
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncNow()
    expectManualMerge()
    projectSyncState(projectId).then(state => {
      cy.wrap(state.unmergedBranchName).as('unmergedBranch')
      commitOnGitLab(
        {
          'main.tex': main.replace(
            'First line',
            'First line from GitLab\nMain from Overleaf'
          ),
        },
        'Merge Overleaf changes',
        state.unmergedBranchName
      )
      deleteBranchOnGitLab(state.unmergedBranchName, true)
    })
    syncModal()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .click()
    expectUpToDate()
    projectSyncState(projectId).its('mergeStatus').should('equal', 'clean')
    cy.get('.cm-content')
      .should('contain.text', 'First line from GitLab')
      .and('contain.text', 'Main from Overleaf')
    cy.get<string>('@unmergedBranch').then(branch => {
      // the merged branch is not brought back
      mockRepo(fullName).its('branches').should('not.have.property', branch)
    })
  })

  it('keeps edits made in Overleaf while a conflict is open', function () {
    commitOnGitLab(
      { 'main.tex': main.replace('First line', 'First line from GitLab') },
      'Main on GitLab'
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
      commitOnGitLab(
        {
          'main.tex': main.replace(
            'First line',
            'First line from GitLab\nMain from Overleaf'
          ),
        },
        'Merge Overleaf changes',
        state.unmergedBranchName
      )
    })
    openSyncModalInEditor()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .click()
    expectUpToDate()
    projectSyncState(projectId).its('mergeStatus').should('equal', 'clean')
    mockRepo(fullName).then(repo => {
      expect(repo.files['chapter.tex']).to.equal(
        'Chapter text written during the conflict'
      )
      expect(repo.files['main.tex']).to.contain('First line from GitLab')
      expect(repo.files['main.tex']).to.contain('Main from Overleaf')
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
    mockRepo(fullName).then(repo => {
      expect(Object.keys(repo.files).sort()).to.deep.equal([
        '.gitignore',
        '.gitlab-ci.yml',
        'main.tex',
        'part.tex',
      ])
      expect(repo.files['part.tex']).to.equal('Chapter text')
      // The default message when none was given
      expect(repo.commits[repo.commits.length - 1].message).to.equal(
        'Updates from Overleaf'
      )
    })
  })

  it('pulls binary files from GitLab', function () {
    // A 1x1 PNG
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    commitOnGitLab({ 'figures/dot.png': { base64: png } }, 'Add a figure')
    openGitLabSyncModal(projectId)
    syncNow()
    expectUpToDate()
    cy.request(`/project/${projectId}/entities`)
      .its('body.entities')
      .should('deep.include', { path: '/figures/dot.png', type: 'file' })
  })

  it('warns about a force push and takes over the rewritten branch', function () {
    mock('POST', `/repos/${fullName}/force-push`, {
      files: { 'main.tex': main.replace('First line', 'Rewritten history') },
    })
    openGitLabSyncModal(projectId)
    syncModal().should('contain.text', 'has been force-pushed')
    syncNow()
    expectUpToDate()
    cy.get('.cm-content').should('contain.text', 'Rewritten history')
    entityPaths().should('deep.equal', ['/main.tex'])
  })

  it('merges Overleaf edits into a force-pushed branch', function () {
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    mock('POST', `/repos/${fullName}/force-push`, {
      files: {
        'main.tex': main,
        'chapter.tex': 'Chapter rewritten on GitLab',
      },
    })
    openSyncModalInEditor()
    syncModal().should('contain.text', 'has been force-pushed')
    syncNow()
    expectUpToDate()
    mockRepo(fullName).then(repo => {
      expect(repo.files['main.tex']).to.contain('Main from Overleaf')
      expect(repo.files['chapter.tex']).to.equal('Chapter rewritten on GitLab')
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
    mock('POST', `/repos/${fullName}/force-push`, {
      files: { 'main.tex': main, 'chapter.tex': 'Chapter rewritten on GitLab' },
    })
    openSyncModalInEditor()
    syncModal().should('contain.text', 'has been force-pushed')
    syncNow()
    expectUpToDate()
    mockRepo(fullName).its('files').should('have.property', 'empty.tex', '')
  })

  it('offers to unlink a repository the user can no longer push to', function () {
    repoSettings(fullName, { push: false })
    openGitLabSyncModal(projectId)
    syncModal()
      .should('contain.text', 'you no longer have access to it')
      .findByRole('button', { name: 'Unlink GitLab repository' })
      .click()
    projectSyncState(projectId)
      .its('mergeStatus')
      .should('equal', 'need-export')
  })
})

describe('collaborators', function () {
  const collaborator = `gitlab-collaborator-${Date.now()}@example.com`

  before(function () {
    ensureUserExists(collaborator)
  })

  it('only lets the owner link a project', function () {
    createProject(projectName('Shared')).then(projectId => {
      shareProject(projectId, collaborator, 'readAndWrite')
      linkGitLabAccount()
      openGitLabSyncModal(projectId)
      syncModal().should(
        'contain.text',
        'Only the project owner can link this project to a GitLab repository.'
      )
      syncModal()
        .findByRole('button', { name: 'Create a GitLab repository' })
        .should('not.exist')
      // Nor through the API: no repository is created or linked
      const name = projectName('FromEditor')
      postWithCsrf(`/project/${projectId}/gitlab-sync/export`, { name })
        .its('status')
        .should('equal', 403)
      projectSyncState(projectId)
        .its('mergeStatus')
        .should('equal', 'need-export')
      cy.request({
        url: `http://gitlab-mock:8080/_mock/repos/${GITLAB_USER}/${name.toLowerCase()}`,
        failOnStatusCode: false,
      })
        .its('status')
        .should('equal', 404)
    })
  })

  it('lets an editor sync a linked project but not unlink it', function () {
    const name = projectName('Shared')
    // A full document, so that Overleaf picks it as the main document
    seedRepo(name, {
      'main.tex': [
        '\\documentclass{article}',
        '\\begin{document}',
        '\\section{Introduction}',
        '\\end{document}',
      ].join('\n'),
    })
    linkGitLabAccount()
    postWithCsrf('/project/new/gitlab-sync', {
      name,
      fullName: `${GITLAB_USER}/${name.toLowerCase()}`,
      defaultBranchName: 'main',
    }).then(response => {
      const projectId = response.body.projectId as string
      shareProject(projectId, collaborator, 'readAndWrite')
      linkGitLabAccount()
      openGitLabSyncModal(projectId)
      syncModal().findByText('Recent commits in GitLab').should('exist')
      // Unlinking is the owner's call
      requestWithCsrf('DELETE', `/project/${projectId}/gitlab-sync`).then(
        response => {
          expect(response.status).to.equal(403)
          expect(response.body.ownerEmail).to.equal(ADMIN_EMAIL)
        }
      )
      projectSyncState(projectId).its('mergeStatus').should('equal', 'clean')
    })
  })

  it('keeps viewers out of the project routes', function () {
    createProject(projectName('Shared')).then(projectId => {
      shareProject(projectId, collaborator, 'readOnly')
      cy.visit('/project')
      for (const url of [
        `/project/${projectId}/gitlab-sync/state`,
        `/project/${projectId}/gitlab-sync/merge/overview`,
      ]) {
        cy.request({ url, failOnStatusCode: false })
          .its('status')
          .should('equal', 403)
      }
      postWithCsrf(`/project/${projectId}/gitlab-sync/export`, {
        name: 'from-a-viewer',
      })
        .its('status')
        .should('equal', 403)
    })
  })
})
