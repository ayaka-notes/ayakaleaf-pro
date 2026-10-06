import { v4 as uuid } from 'uuid'
import {
  createGitToken,
  git,
  gitClone,
  gitCommitAllAndPush,
  gitCommitAndPush,
  workingCopy,
} from '../../../helpers/git'
import { login } from '../../../helpers/login'
import {
  createProject,
  openProject,
  projectName,
} from '../../../helpers/project'
import { requestWithCsrf } from '../../../helpers/request'
import { shareProject, shareProjectByLink } from '../../../helpers/sharing'
import { ensureUserExists } from '../../../helpers/users'

// git-bridge module with the git-bridge container of the toolkit, built from
// this checkout (services/git-bridge). Projects are cloned and pushed with
// the git CLI, authenticated with personal access tokens.

const owner = `owner-${uuid()}@example.com`
const editor = `editor-${uuid()}@example.com`
const viewer = `viewer-${uuid()}@example.com`
const reviewer = `reviewer-${uuid()}@example.com`
const linkEditor = `link-editor-${uuid()}@example.com`
const linkViewer = `link-viewer-${uuid()}@example.com`
const stranger = `stranger-${uuid()}@example.com`

const MAIN_TEX = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\section{Introduction}',
  'Hello from git',
  '\\end{document}',
  '',
].join('\n')

before(function () {
  for (const email of [
    owner,
    editor,
    viewer,
    reviewer,
    linkEditor,
    linkViewer,
    stranger,
  ]) {
    ensureUserExists(email)
  }
})

type Entity = { path: string; type: 'doc' | 'file' }

function projectEntities(projectId: string): Cypress.Chainable<Entity[]> {
  return cy.request(`/project/${projectId}/entities`).its('body.entities')
}

describe('git tokens in the account settings', function () {
  it('generates, lists and deletes a token', function () {
    login(owner)
    cy.visit('/user/settings')
    cy.findByRole('heading', { name: 'Git integration' })
    cy.findByRole('button', {
      name: /Generate token|Add another token/,
    }).click()
    cy.findByRole('dialog')
      .contains(/olp_[a-zA-Z0-9]+/)
      .invoke('text')
      .then(text => {
        const token = text.match(/olp_[a-zA-Z0-9]+/)![0]
        // The header close button is called Close too, use the footer one
        cy.findByRole('dialog')
          .findAllByRole('button', { name: 'Close' })
          .last()
          .click()
        // Only the start of the token is shown afterwards
        cy.contains(`${token.slice(0, 8)}************`)
      })

    cy.get('.linking-git-bridge-revoke-button').first().click()
    cy.findByRole('dialog').within(() => {
      cy.findByText('Delete Authentication token')
      cy.findByRole('button', { name: 'Delete' }).click()
    })
    cy.findByRole('dialog').should('not.exist')
  })
})

describe('git access to a project', function () {
  let projectId: string

  before(function () {
    login(owner)
    createProject(projectName('Git')).then(id => {
      projectId = id
    })
    cy.then(() => {
      shareProject(projectId, editor, 'readAndWrite')
      login(owner)
      shareProject(projectId, viewer, 'readOnly')
      login(owner)
      shareProject(projectId, reviewer, 'review')
      login(owner)
      shareProjectByLink(projectId, linkEditor, 'readAndWrite')
      login(owner)
      shareProjectByLink(projectId, linkViewer, 'readOnly')
    })
  })

  it('shows the clone command in the editor', function () {
    login(owner)
    openProject(projectId)
    cy.findByRole('tab', { name: 'Integrations' }).click()
    cy.findByText('Git clone this project.').click()
    cy.findByRole('dialog').within(() => {
      cy.findByText('Clone with Git')
      cy.contains('code', `git clone http://git@sharelatex/git/${projectId}`)
    })
  })

  it('clones the files of the project', function () {
    login(owner)
    const dir = workingCopy('owner')
    createGitToken().then(token => {
      gitClone(projectId, token, dir).its('exitCode').should('equal', 0)
    })
    git(`cat ${dir}/main.tex`)
      .its('stdout')
      .should('contain', '\\documentclass')
  })

  it('pushes a change that shows in the editor and in the history', function () {
    login(owner)
    const dir = workingCopy('push')
    createGitToken().then(token => {
      gitClone(projectId, token, dir)
      gitCommitAndPush(dir, 'main.tex', MAIN_TEX, 'Change from git')
        .its('exitCode')
        .should('equal', 0)
    })

    openProject(projectId)
    cy.get('.cm-content').should('contain.text', 'Hello from git')
    cy.findByRole('button', { name: 'History' }).click()
    // Shown as "You (via Git)"
    cy.findAllByText(/via Git/, { timeout: 30_000 }).should('exist')
  })

  it('adds a file that is pushed through git', function () {
    login(owner)
    const dir = workingCopy('new-file')
    createGitToken().then(token => {
      gitClone(projectId, token, dir)
      gitCommitAndPush(dir, 'from-git.tex', 'Added through git', 'Add a file')
        .its('exitCode')
        .should('equal', 0)
    })
    projectEntities(projectId).should('deep.include', {
      path: '/from-git.tex',
      type: 'doc',
    })
  })

  it('pulls a change made in Overleaf', function () {
    login(owner)
    const dir = workingCopy('pull')
    createGitToken().then(token => {
      gitClone(projectId, token, dir)
    })

    openProject(projectId)
    cy.findByRole('textbox', { name: 'Source Editor editing' }).within(() => {
      cy.findByText('Hello from git').click()
      cy.findByText('Hello from git').type('{end} and from Overleaf')
    })

    // The change reaches git-bridge once Overleaf has flushed it to history
    function pullUntilChanged(attempt = 1) {
      git(`cd ${dir} && git pull -q && cat main.tex`).then(result => {
        if (!result.stdout.includes('and from Overleaf') && attempt < 20) {
          cy.wait(3_000)
          pullUntilChanged(attempt + 1)
        } else {
          expect(result.stdout).to.contain('Hello from git and from Overleaf')
        }
      })
    }
    pullUntilChanged()
  })

  it('keeps binary files and folders when pushing and cloning', function () {
    login(owner)
    const dir = workingCopy('binary')
    const clone = workingCopy('binary-clone')
    createGitToken().then(token => {
      gitClone(projectId, token, dir)
      git(
        `cd ${dir} && mkdir -p figures chapters && ` +
          'head -c 4096 /dev/urandom > figures/plot.png && ' +
          "printf '%s' 'In a folder' > chapters/intro.tex"
      )
      gitCommitAllAndPush(dir, 'Add a figure and a chapter')
        .its('exitCode')
        .should('equal', 0)

      projectEntities(projectId).should(entities => {
        expect(entities).to.deep.include({
          path: '/figures/plot.png',
          type: 'file',
        })
        expect(entities).to.deep.include({
          path: '/chapters/intro.tex',
          type: 'doc',
        })
      })

      // A fresh clone gets the figure back byte for byte
      gitClone(projectId, token, clone).its('exitCode').should('equal', 0)
      git(`cd ${dir} && sha1sum figures/plot.png`).then(original => {
        git(`cd ${clone} && sha1sum figures/plot.png`)
          .its('stdout')
          .should('equal', original.stdout)
      })
      git(`cat ${clone}/chapters/intro.tex`)
        .its('stdout')
        .should('equal', 'In a folder')
    })
  })

  it('renames and deletes files pushed through git', function () {
    login(owner)
    const dir = workingCopy('rename')
    createGitToken().then(token => {
      gitClone(projectId, token, dir)
      git(
        `cd ${dir} && printf '%s' 'Renamed through git' > old-name.tex && ` +
          "printf '%s' 'Deleted through git' > obsolete.tex"
      )
      gitCommitAllAndPush(dir, 'Add two files')
        .its('exitCode')
        .should('equal', 0)
      projectEntities(projectId).should(entities => {
        expect(entities).to.deep.include({
          path: '/old-name.tex',
          type: 'doc',
        })
        expect(entities).to.deep.include({
          path: '/obsolete.tex',
          type: 'doc',
        })
      })

      git(
        `cd ${dir} && mkdir -p moved && git mv old-name.tex moved/new-name.tex && ` +
          'git rm -q obsolete.tex'
      )
      gitCommitAllAndPush(dir, 'Rename and delete')
        .its('exitCode')
        .should('equal', 0)
    })

    projectEntities(projectId).should(entities => {
      const paths = entities.map(entity => entity.path)
      expect(paths).to.include('/moved/new-name.tex')
      expect(paths).not.to.include('/old-name.tex')
      expect(paths).not.to.include('/obsolete.tex')
    })
    openProject(projectId)
    cy.findByRole('treeitem', { name: 'moved' }).click()
    cy.findByRole('treeitem', { name: 'new-name.tex' }).click()
    cy.get('.cm-content').should('contain.text', 'Renamed through git')
  })

  it('rejects a push from an out-of-date clone until it pulls', function () {
    login(owner)
    const first = workingCopy('first')
    const second = workingCopy('second')
    createGitToken().then(token => {
      gitClone(projectId, token, first)
      gitClone(projectId, token, second)
    })
    gitCommitAndPush(first, 'first.tex', 'First clone', 'First clone')
      .its('exitCode')
      .should('equal', 0)

    gitCommitAndPush(second, 'second.tex', 'Second clone', 'Second clone').then(
      result => {
        expect(result.exitCode).not.to.equal(0)
        expect(result.stderr).to.match(/rejected/)
      }
    )
    git(
      `cd ${second} && ` +
        'git -c user.name=e2e -c user.email=e2e@example.com pull -q --rebase && ' +
        'git push'
    )
      .its('exitCode')
      .should('equal', 0)

    projectEntities(projectId).should(entities => {
      expect(entities).to.deep.include({ path: '/first.tex', type: 'doc' })
      expect(entities).to.deep.include({ path: '/second.tex', type: 'doc' })
    })
  })

  for (const { role, email } of [
    { role: 'an invited editor', email: () => editor },
    { role: 'an editor through the link', email: () => linkEditor },
  ]) {
    it(`lets ${role} clone and push`, function () {
      login(email())
      const dir = workingCopy('can-push')
      createGitToken().then(token => {
        gitClone(projectId, token, dir).its('exitCode').should('equal', 0)
        gitCommitAndPush(dir, `push-${Date.now()}.tex`, 'Pushed', 'Push')
          .its('exitCode')
          .should('equal', 0)
      })
    })
  }

  for (const { role, email } of [
    { role: 'an invited viewer', email: () => viewer },
    { role: 'a reviewer', email: () => reviewer },
    { role: 'a viewer through the link', email: () => linkViewer },
  ]) {
    it(`lets ${role} clone but not push`, function () {
      login(email())
      const dir = workingCopy('cannot-push')
      createGitToken().then(token => {
        gitClone(projectId, token, dir).its('exitCode').should('equal', 0)
        gitCommitAndPush(dir, 'not-pushed.tex', 'Not pushed', 'Push').then(
          result => {
            expect(result.exitCode).not.to.equal(0)
            expect(result.stderr).to.match(/forbidden|403|not allowed/i)
          }
        )
      })
    })
  }

  it('refuses a user without access to the project', function () {
    login(stranger)
    createGitToken().then(token => {
      gitClone(projectId, token, workingCopy('stranger'))
        .its('exitCode')
        .should('not.equal', 0)
    })
  })

  it('refuses a wrong token and a deleted one', function () {
    gitClone(projectId, 'olp_not-a-real-token', workingCopy('wrong'))
      .its('exitCode')
      .should('not.equal', 0)

    login(owner)
    createGitToken().then(token => {
      cy.request('/oauth/personal-access-tokens').then(response => {
        const created = response.body.find(
          (t: { accessTokenPartial: string }) =>
            token.startsWith(t.accessTokenPartial)
        )
        cy.visit('/user/settings')
        requestWithCsrf(
          'DELETE',
          `/oauth/personal-access-tokens/${created._id}`
        )
          .its('status')
          .should('be.lessThan', 400)
      })
      gitClone(projectId, token, workingCopy('deleted'))
        .its('exitCode')
        .should('not.equal', 0)
    })
  })
})
