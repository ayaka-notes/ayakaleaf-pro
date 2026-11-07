import { v4 as uuid } from 'uuid'
import { DEFAULT_PASSWORD, login } from '../../../helpers/login'
import {
  dataUrl,
  formBody,
  openInOverleaf,
  Params,
  submitDocs,
} from '../../../helpers/openInOverleaf'
import { postWithCsrf } from '../../../helpers/request'
import { ensureUserExists } from '../../../helpers/users'

// open-in-overleaf module: the /docs endpoint other sites post LaTeX to, and
// the /devs page documenting it. Submissions are plain form posts without a
// CSRF token, the way an external site sends them.

const user = `user-${uuid()}@example.com`

function expectRefused(params: Params, message: string | RegExp) {
  submitDocs(params).then(response => {
    expect(response.status).to.equal(422)
    expect(response.body).to.match(
      typeof message === 'string' ? new RegExp(message) : message
    )
  })
}

function entityPaths(projectId: string): Cypress.Chainable<string[]> {
  return cy
    .request(`/project/${projectId}/entities`)
    .its('body.entities')
    .then((entities: { path: string }[]) => entities.map(e => e.path))
}

function projectName(projectId: string): Cypress.Chainable<string> {
  return cy
    .request('/user/projects')
    .its('body.projects')
    .then(
      (projects: { _id: string; name: string }[]) =>
        projects.find(p => p._id === projectId)!.name
    )
}

// The open document in the editor, which is the main document
function editorShows(projectId: string, text: string) {
  cy.visit(`/project/${projectId}`)
  cy.get('.cm-content').should('contain.text', text)
  // Leaving a page while it still loads assets can crash web here: the send
  // patch's Stream.pipeline throws on Node 24 instead of calling back.
  cy.wait(2_000)
}

// Compiles over HTTP and returns the log, to see which engine ran
function compileLog(projectId: string): Cypress.Chainable<string> {
  cy.visit('/project')
  return postWithCsrf(`/project/${projectId}/compile?auto_compile=false`, {
    check: 'silent',
    draft: false,
    incrementalCompilesEnabled: false,
    stopOnFirstError: false,
  }).then(response => {
    expect(response.body.status).to.equal('success')
    const log = response.body.outputFiles.find(
      (file: { path: string }) => file.path === 'output.log'
    )
    return cy.request(log.url).its('body')
  })
}

const completeDocument = [
  '\\documentclass{article}',
  '\\begin{document}',
  'A complete document',
  '\\end{document}',
].join('\n')

before(function () {
  ensureUserExists(user)
})

describe('the /devs page', function () {
  // A private instance (the default) keeps it behind the login like every
  // other page, the public-access variant shows it to everyone
  it('asks to log in first', function () {
    cy.clearAllCookies()
    cy.request({ url: '/devs', followRedirect: false })
      .its('redirectedToUrl')
      .should('match', /\/login$/)
  })

  it('documents the /docs endpoint', function () {
    login(user)
    cy.visit('/devs')
    cy.findByRole('heading', { name: 'Overleaf API' })
    cy.get('form[action$="/docs"][method="post"]').should(
      'have.length.at.least',
      3
    )
  })

  it('opens its zipped project example in a new project', function () {
    login(user)
    cy.visit('/devs')
    // The examples open in a new tab, keep them in this one
    cy.get('form input[name="zip_uri"]')
      .closest('form')
      .invoke('removeAttr', 'target')
      .within(() => {
        cy.findByRole('button', { name: 'Open in Overleaf' }).click()
      })
    cy.url().should('match', /\/project\/[0-9a-f]{24}$/)
    cy.get('.cm-content').should('contain.text', 'I am a Zip file')
    cy.url().then(url => {
      const projectId = url.split('/').pop()!
      entityPaths(projectId).should('include.members', [
        '/main.tex',
        '/main2.tex',
        '/sample.bib',
      ])
      // An archive is named after its \title
      projectName(projectId).should('equal', 'I am a Zip file')
    })
  })
})

describe('/docs', function () {
  beforeEach(function () {
    login(user)
  })

  it('wraps a bare snippet into a document', function () {
    openInOverleaf({ snip: 'x^2 + y^2 = z^2' }).then(projectId => {
      entityPaths(projectId).should('deep.equal', ['/main.tex'])
      editorShows(projectId, '\\documentclass[12pt]{article}')
      cy.get('.cm-content').should('contain.text', 'x^2 + y^2 = z^2')
      projectName(projectId).should('equal', 'Open in Overleaf project')
    })
  })

  it('keeps a complete document and uses the given name', function () {
    const name = `Named-${uuid().slice(0, 8)}`
    openInOverleaf({ snip: completeDocument, name }).then(projectId => {
      editorShows(projectId, 'A complete document')
      cy.get('.cm-content').should('not.contain.text', '[12pt]')
      projectName(projectId).should('equal', name)
    })
  })

  it('takes an URL encoded snippet from a link', function () {
    openInOverleaf(
      { encoded_snip: encodeURIComponent('Linked 100% snippet') },
      'GET'
    ).then(projectId => {
      editorShows(projectId, 'Linked 100% snippet')
    })
  })

  it('imports files from data URLs with their names, main document and engine', function () {
    openInOverleaf({
      snip_uri: [
        dataUrl('application/x-tex', '\\input{chapter}'),
        dataUrl(
          'application/x-tex',
          [
            '\\documentclass{article}',
            '\\begin{document}',
            '\\input{chapter}',
            '\\end{document}',
          ].join('\n')
        ),
        dataUrl('application/x-tex', 'Text of the chapter'),
      ],
      snip_name: ['other.tex', 'thesis.tex', 'chapter.tex'],
      main_document: 'thesis.tex',
      engine: 'xelatex',
    }).then(projectId => {
      entityPaths(projectId).should('include.members', [
        '/other.tex',
        '/thesis.tex',
        '/chapter.tex',
      ])
      // Before opening the editor, which compiles on its own
      compileLog(projectId).should('match', /XeTeX/)
      // The editor opens the main document
      editorShows(projectId, '\\input{chapter}')
      cy.get('.cm-content').should('contain.text', '\\documentclass{article}')
    })
  })

  it('refuses submissions it cannot turn into a project', function () {
    expectRefused({}, 'no snippet, snip_uri or zip_uri provided')
    expectRefused(
      { snip_uri: 'data:application/x-tex;base64,!!not base64!!' },
      'invalid base64 data url'
    )
    expectRefused(
      { zip_uri: dataUrl('application/zip', 'not a zip') },
      'zip_uri did not resolve to a zip archive'
    )
    expectRefused({ snip_uri: 'ftp://example.com/file.tex' }, 'invalid url')
  })

  it('does not download from the internal network', function () {
    // The linked-url-proxy refuses private addresses
    for (const url of [
      'http://sharelatex/devs',
      'http://127.0.0.1:3000/status',
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      expectRefused({ snip_uri: url }, 'could not download')
      expectRefused({ zip_uri: url }, 'could not download')
    }
  })
})

describe('/docs when signed out', function () {
  // Private instance: the global login check runs before the module, so a
  // signed-out post goes to the login like any other request
  it('sends a signed-out post to the login', function () {
    cy.clearAllCookies()
    submitDocs({ snip: 'Posted while signed out' }).then(response => {
      expect(response.status).to.equal(302)
      expect(response.redirectedToUrl).to.match(/\/login$/)
    })
  })

  it('keeps a link through the login', function () {
    cy.clearAllCookies()
    cy.visit(`/docs?${formBody({ encoded_snip: 'Linked before logging in' })}`)
    cy.url().should('contain', '/login')
    cy.get('input[name="email"]').type(user)
    cy.get('input[name="password"]').type(DEFAULT_PASSWORD)
    cy.findByRole('button', { name: 'Login' }).click()
    cy.url().should('match', /\/project\/[0-9a-f]{24}$/)
    cy.get('.cm-content').should('contain.text', 'Linked before logging in')
  })

  it('creates no project for a link without logging in', function () {
    cy.clearAllCookies()
    submitDocs({ snip: 'Anonymous' }, 'GET').then(response => {
      expect(response.status).to.equal(302)
      expect(response.redirectedToUrl).to.contain('/login')
    })
  })
})
