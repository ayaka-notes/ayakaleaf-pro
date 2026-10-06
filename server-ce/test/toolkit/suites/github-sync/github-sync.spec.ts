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

// GitHub Sync against services/github-mock, which answers as github.com and
// api.github.com on the toolkit's network. Its control API resets it, seeds
// repositories and reads back what Overleaf pushed.

const GITHUB_USER = 'e2e-octocat'
const GITHUB_ORG = 'e2e-org'

// File contents for the mock: text, binary, generated random bytes, or null
// to delete the file
type Change = string | { base64: string } | { randomBytes: number } | null

type MockCommit = {
  sha: string
  commit: { message: string }
  parents: { sha: string }[]
}

type MockRepo = {
  private: boolean
  description: string
  head: string
  branches: Record<string, string>
  files: Record<string, string>
  commits: MockCommit[]
}

function mock(method: 'GET' | 'POST' | 'PUT', path: string, body?: object) {
  return cy.request({
    method,
    url: `http://github-mock:8080/_mock${path}`,
    body,
  })
}

function mockRepo(fullName: string): Cypress.Chainable<MockRepo> {
  return mock('GET', `/repos/${fullName}`).its('body')
}

function seedRepo(name: string, files: Record<string, Change>) {
  return mock('POST', '/repos', { name, files })
}

// Retries until every token handed out was revoked. Overleaf revokes in the
// background after unlinking.
function expectTokensRevoked(attempts = 20) {
  mock('GET', '/tokens').then(({ body }: { body: { revoked: boolean }[] }) => {
    expect(body).to.have.length.greaterThan(0)
    if (body.every(token => token.revoked)) return
    expect(attempts, 'tokens revoked').to.be.greaterThan(0)
    cy.wait(500)
    expectTokensRevoked(attempts - 1)
  })
}

function githubWidget() {
  return cy.contains('.settings-widget-container', 'GitHub')
}

function connectionStatus() {
  return cy.request('/user/github-sync/status').its('body')
}

function projectSyncState(projectId: string) {
  return cy.request(`/project/${projectId}/github-sync/state`).its('body')
}

// The settings page's Link button runs the whole OAuth app flow: Overleaf
// sends the browser to github.com, which sends it back with a code.
function linkGitHubAccount() {
  cy.visit('/user/settings')
  githubWidget().findByRole('link', { name: 'Link' }).click()
  cy.location('search').should('contain', 'oauth-complete=github')
  githubWidget().findByRole('button', { name: 'Unlink' }).should('exist')
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
  cy.findByRole('button', { name: /GitHub/ }).click()
  return syncModal().should('be.visible')
}

function openGitHubSyncModal(projectId: string) {
  openProject(projectId)
  return openSyncModalInEditor()
}

function syncModal() {
  return cy.contains('[role="dialog"]', 'Sync with GitHub')
}

before(function () {
  ensureAdminExists()
})

beforeEach(function () {
  mock('POST', '/reset')
  login(ADMIN_EMAIL)
})

describe('linking the GitHub account', function () {
  it('links through the OAuth app and unlinks again', function () {
    cy.visit('/user/settings')
    githubWidget()
      .findByRole('link', { name: 'Link' })
      .should('have.attr', 'href', '/user/github-sync/oauth2')
    connectionStatus().should('equal', false)

    linkGitHubAccount()
    connectionStatus().should('equal', true)

    githubWidget().findByRole('button', { name: 'Unlink' }).click()
    cy.findByRole('dialog')
      .should('contain.text', 'Unlink GitHub Account')
      .findByRole('button', { name: 'Unlink' })
      .click()
    githubWidget().findByRole('link', { name: 'Link' }).should('exist')
    connectionStatus().should('equal', false)
    expectTokensRevoked()
  })

  it('sends the app id, callback, scopes and a state to GitHub', function () {
    cy.visit('/user/settings')
    cy.request({ url: '/user/github-sync/oauth2', followRedirect: false }).then(
      response => {
        expect(response.status).to.equal(302)
        const url = new URL(response.redirectedToUrl!)
        expect(url.origin + url.pathname).to.equal(
          'https://github.com/login/oauth/authorize'
        )
        expect(url.searchParams.get('client_id')).to.equal('e2e-github-client')
        expect(url.searchParams.get('redirect_uri')).to.equal(
          'http://sharelatex/user/github-sync/oauth2/callback'
        )
        expect(url.searchParams.get('scope')).to.equal('read:org,repo,workflow')
        expect(url.searchParams.get('state')).to.have.length.greaterThan(0)
      }
    )
  })

  it('refuses a callback without a valid state', function () {
    cy.request({
      url: '/user/github-sync/oauth2/callback?code=anything&state=forged',
      failOnStatusCode: false,
    })
      .its('status')
      .should('equal', 403)
    connectionStatus().should('equal', false)
  })

  it('stays unlinked when the user does not authorize the app', function () {
    mock('POST', '/deny-next-authorize')
    cy.visit('/user/settings')
    githubWidget().findByRole('link', { name: 'Link' }).click()
    cy.location('pathname').should('equal', '/user/github-sync/oauth2/callback')
    connectionStatus().should('equal', false)
    cy.visit('/user/settings')
    githubWidget().findByRole('link', { name: 'Link' }).should('exist')
  })

  it('shows the account as unlinked once its token was revoked on GitHub', function () {
    linkGitHubAccount()
    mock('POST', '/tokens/revoke')
    cy.visit('/user/settings')
    githubWidget().findByRole('link', { name: 'Link' }).should('exist')
    connectionStatus().should('equal', false)
  })
})

describe('linking a project to a repository', function () {
  it('asks to link the GitHub account first', function () {
    createProject(projectName('GitHub')).then(projectId => {
      openGitHubSyncModal(projectId)
      // The editor runs the OAuth flow in a popup
      cy.window().then(win => cy.stub(win, 'open').as('popup'))
      syncModal()
        .findByRole('button', { name: 'Link to your GitHub account' })
        .click()
      cy.get('@popup').should(
        'have.been.calledWith',
        '/user/github-sync/oauth2'
      )
    })
  })

  it('exports a project into a new private repository', function () {
    const name = projectName('GitHub')
    linkGitHubAccount()
    createProject(name).then(projectId => {
      openGitHubSyncModal(projectId)
      syncModal().within(() => {
        cy.findByText('Export Project to GitHub').should('exist')
        cy.findByLabelText('Owner').should('have.value', GITHUB_USER)
        cy.findByLabelText('Repository Name').should('have.value', name)
        cy.findByLabelText('Description (Optional)').type('Exported in e2e')
        cy.findByRole('button', { name: 'Create a GitHub repository' }).click()
        cy.contains('This project is linked to')
          .findByRole('link', { name: `${GITHUB_USER}/${name}` })
          .should(
            'have.attr',
            'href',
            `https://github.com/${GITHUB_USER}/${name}`
          )
      })
      projectSyncState(projectId).should('deep.include', {
        mergeStatus: 'clean',
        repoFullName: `${GITHUB_USER}/${name}`,
      })
      mockRepo(`${GITHUB_USER}/${name}`).then(repo => {
        expect(repo.private).to.equal(true)
        expect(repo.description).to.equal('Exported in e2e')
        // The project replaces the README GitHub created
        expect(Object.keys(repo.files)).to.deep.equal(['main.tex'])
        expect(repo.files['main.tex']).to.contain('\\section{Introduction}')
        expect(repo.commits.map(c => c.commit.message)).to.deep.equal([
          'Initial Overleaf import',
        ])
      })
    })
  })

  it('exports into a public repository of an organization', function () {
    const name = projectName('GitHub')
    linkGitHubAccount()
    createProject(name).then(projectId => {
      openGitHubSyncModal(projectId)
      syncModal().within(() => {
        cy.findByLabelText('Owner').select(GITHUB_ORG)
        cy.findByLabelText('Organization').should('have.value', GITHUB_ORG)
        cy.findByLabelText(/Public/).check()
        cy.findByRole('button', { name: 'Create a GitHub repository' }).click()
        cy.findByRole('link', { name: `${GITHUB_ORG}/${name}` }).should('exist')
      })
      mockRepo(`${GITHUB_ORG}/${name}`).its('private').should('equal', false)
    })
  })

  it('does not export into a repository that exists', function () {
    const name = projectName('GitHub')
    seedRepo(name, { 'README.md': 'Taken' })
    linkGitHubAccount()
    createProject(name).then(projectId => {
      openGitHubSyncModal(projectId)
      syncModal().within(() => {
        cy.findByRole('button', { name: 'Create a GitHub repository' }).click()
        cy.findByRole('alert').should('exist')
        cy.findByText('Export Project to GitHub').should('exist')
      })
      projectSyncState(projectId)
        .its('mergeStatus')
        .should('equal', 'need-export')
      mockRepo(`${GITHUB_USER}/${name}`)
        .its('files')
        .should('deep.equal', { 'README.md': 'Taken' })
    })
  })

  it('unlinks a project from its repository', function () {
    const name = projectName('GitHub')
    linkGitHubAccount()
    createProject(name).then(projectId => {
      openGitHubSyncModal(projectId)
      syncModal()
        .findByRole('button', { name: 'Create a GitHub repository' })
        .click()
      syncModal().findByRole('button', { name: 'Unlink' }).click()
      syncModal().within(() => {
        cy.contains('This project is linked to').should('exist')
        cy.findByRole('button', { name: 'Confirm' }).click()
        cy.findByText('Export Project to GitHub').should('exist')
      })
      projectSyncState(projectId)
        .its('mergeStatus')
        .should('equal', 'need-export')
      // The repository stays on GitHub
      mockRepo(`${GITHUB_USER}/${name}`)
        .its('files')
        .should('have.property', 'main.tex')
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
    'sections/intro.tex': '\\section{Introduction}\nImported from GitHub',
  }

  function openImportModal() {
    cy.visit('/project')
    cy.findAllByRole('button', { name: 'New project' }).first().click()
    cy.findByRole('menuitem', { name: 'Import from GitHub' }).click()
    return cy.contains('[role="dialog"]', 'Import from GitHub')
  }

  it('asks to link the GitHub account first', function () {
    openImportModal()
      .findByRole('link', { name: 'Link to your GitHub account' })
      .should('have.attr', 'href', '/user/github-sync/oauth2')
  })

  it('refuses a repository archive larger than the upload limit', function () {
    const name = projectName('Huge')
    // Just above the default MAX_UPLOAD_SIZE of 50 MB; random bytes do not
    // compress, so the zipball is that large too
    seedRepo(name, {
      'main.tex': files['main.tex'],
      'data.bin': { randomBytes: 51 * 1024 * 1024 },
    })
    linkGitHubAccount()
    postWithCsrf('/project/new/github-sync', {
      name,
      fullName: `${GITHUB_USER}/${name}`,
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
    seedRepo(name, files)
    linkGitHubAccount()
    openImportModal().within(() => {
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
        repoFullName: `${GITHUB_USER}/${name}`,
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
  }

  let name: string
  let fullName: string
  let projectId: string

  // A repository imported over HTTP, the way the import modal does it
  beforeEach(function () {
    name = projectName('Sync')
    fullName = `${GITHUB_USER}/${name}`
    seedRepo(name, files)
    linkGitHubAccount()
    postWithCsrf('/project/new/github-sync', {
      name,
      fullName,
      defaultBranchName: 'main',
    }).then(response => {
      expect(response.status).to.equal(200)
      projectId = response.body.projectId
    })
  })

  // A push to main on GitHub; with merge, a merge commit of that branch
  function commitOnGitHub(
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

  function mergeOverview() {
    return cy
      .request(`/project/${projectId}/github-sync/merge/overview`)
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
      .findByText('No new commits in GitHub since last merge.')
      .should('exist')
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

  it('pulls commits made on GitHub into the project', function () {
    commitOnGitHub(
      {
        'chapter.tex': 'Chapter text edited on GitHub',
        'appendix.tex': 'Appendix from GitHub',
        'notes.txt': null,
      },
      'Edit on GitHub'
    )
    openGitHubSyncModal(projectId)
    syncModal().within(() => {
      cy.findByText('Recent commits in GitHub').should('exist')
      cy.findByRole('link', { name: 'Edit on GitHub' }).should('exist')
      cy.findByText(`by E2E Octocat <${GITHUB_USER}@example.com>`).should(
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
      'Chapter text edited on GitHub'
    )
    projectSyncState(projectId).its('mergeStatus').should('equal', 'clean')
  })

  it('pushes changes made in Overleaf to GitHub', function () {
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
      expect(head.commit.message).to.equal('Edit in Overleaf')
      // A fast forward, no merge commit
      expect(head.parents).to.have.length(1)
    })
    // Syncing again finds nothing to do
    mergeOverview().should('deep.include', {
      commits: [],
      isProjectUpdated: false,
    })
  })

  it('merges changes made on both sides to different files', function () {
    commitOnGitHub(
      { 'chapter.tex': 'Chapter from GitHub' },
      'Chapter on GitHub'
    )
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncModal()
      .findByRole('link', { name: 'Chapter on GitHub' })
      .should('exist')
    syncNow()
    expectUpToDate()
    mockRepo(fullName).then(repo => {
      expect(repo.files['main.tex']).to.contain('Main from Overleaf')
      expect(repo.files['chapter.tex']).to.equal('Chapter from GitHub')
      const head = repo.commits.find(c => c.sha === repo.head)!
      expect(head.parents, 'merge commit').to.have.length(2)
      // The temporary branch is gone again
      expect(Object.keys(repo.branches)).to.deep.equal(['main'])
    })
    syncModal().findByRole('button', { name: 'Close' }).click()
    openFile('chapter.tex')
    cy.get('.cm-content').should('contain.text', 'Chapter from GitHub')
  })

  it('stops on a conflict and continues after a manual merge', function () {
    commitOnGitHub(
      { 'main.tex': main.replace('First line', 'First line from GitHub') },
      'Main on GitHub'
    )
    openProject(projectId)
    editMainInOverleaf('Main from Overleaf')
    openSyncModalInEditor()
    syncNow()
    syncModal()
      .should(
        'contain.text',
        'Your changes in Our Overleaf Instance and GitHub could not be automatically merged.'
      )
      .and('contain.text', 'Please manually merge the')
    projectSyncState(projectId).then(state => {
      cy.wrap(state.unmergedBranchName).as('unmergedBranch')
      expect(state.mergeStatus).to.equal('conflict')
      expect(state.unmergedBranchName).to.match(
        /^overleaf-\d{4}-\d{2}-\d{2}-\d{6}$/
      )
      // Overleaf's side waits on its own branch on GitHub
      mockRepo(fullName).then(repo => {
        expect(repo.branches).to.have.property(state.unmergedBranchName)
        expect(repo.files['main.tex']).to.contain('First line from GitHub')
        expect(repo.files['main.tex']).not.to.contain('Main from Overleaf')
      })
    })

    // Reopening the modal shows the conflict until it is resolved
    syncModal().findByRole('button', { name: 'Close' }).click()
    openSyncModalInEditor()
      .findByRole('button', { name: 'I have manually merged. Continue' })
      .should('exist')

    // The user merges Overleaf's branch on GitHub, then continues
    const resolved = main.replace(
      'First line',
      'First line from GitHub\nMain from Overleaf'
    )
    cy.get<string>('@unmergedBranch').then(branch => {
      commitOnGitHub({ 'main.tex': resolved }, 'Merge Overleaf changes', branch)
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
      .should('contain.text', 'First line from GitHub')
      .and('contain.text', 'Main from Overleaf')
  })

  it('keeps edits made in Overleaf while a conflict is open', function () {
    commitOnGitHub(
      { 'main.tex': main.replace('First line', 'First line from GitHub') },
      'Main on GitHub'
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
      commitOnGitHub(
        {
          'main.tex': main.replace(
            'First line',
            'First line from GitHub\nMain from Overleaf'
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
      expect(repo.files['main.tex']).to.contain('First line from GitHub')
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
        'main.tex',
        'part.tex',
      ])
      expect(repo.files['part.tex']).to.equal('Chapter text')
      // The default message when none was given
      expect(repo.commits[repo.commits.length - 1].commit.message).to.equal(
        'Updates from Overleaf'
      )
    })
  })

  it('pulls binary files from GitHub', function () {
    // A 1x1 PNG
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    commitOnGitHub({ 'figures/dot.png': { base64: png } }, 'Add a figure')
    openGitHubSyncModal(projectId)
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
    openGitHubSyncModal(projectId)
    syncModal().should('contain.text', 'has been force-pushed')
    syncNow()
    expectUpToDate()
    cy.get('.cm-content').should('contain.text', 'Rewritten history')
    entityPaths().should('deep.equal', ['/main.tex'])
  })

  it('offers to unlink a repository the user can no longer push to', function () {
    mock('PUT', `/repos/${fullName}/permissions`, { push: false })
    openGitHubSyncModal(projectId)
    syncModal()
      .should('contain.text', 'you no longer have access to it')
      .findByRole('button', { name: /Unlink/ })
      .click()
    projectSyncState(projectId)
      .its('mergeStatus')
      .should('equal', 'need-export')
  })
})

describe('collaborators', function () {
  const collaborator = `github-collaborator-${Date.now()}@example.com`

  before(function () {
    ensureUserExists(collaborator)
  })

  it('only lets the owner link a project', function () {
    createProject(projectName('Shared')).then(projectId => {
      shareProject(projectId, collaborator, 'readAndWrite')
      linkGitHubAccount()
      openGitHubSyncModal(projectId)
      syncModal().should(
        'contain.text',
        'Only the project owner can link this project to a GitHub repository.'
      )
      syncModal()
        .findByRole('button', { name: 'Create a GitHub repository' })
        .should('not.exist')
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
    linkGitHubAccount()
    postWithCsrf('/project/new/github-sync', {
      name,
      fullName: `${GITHUB_USER}/${name}`,
      defaultBranchName: 'main',
    }).then(response => {
      const projectId = response.body.projectId as string
      shareProject(projectId, collaborator, 'readAndWrite')
      linkGitHubAccount()
      openGitHubSyncModal(projectId)
      syncModal().findByText('Recent commits in GitHub').should('exist')
      // Unlinking is the owner's call
      requestWithCsrf('DELETE', `/project/${projectId}/github-sync`).then(
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
        `/project/${projectId}/github-sync/state`,
        `/project/${projectId}/github-sync/merge/overview`,
      ]) {
        cy.request({ url, failOnStatusCode: false })
          .its('status')
          .should('equal', 403)
      }
      postWithCsrf(`/project/${projectId}/github-sync/export`, {
        name: 'from-a-viewer',
      })
        .its('status')
        .should('equal', 403)
    })
  })
})
