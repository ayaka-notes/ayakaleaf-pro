import { login } from '../../../helpers/login'
import {
  createProject,
  openProject,
  projectName,
} from '../../../helpers/project'
import {
  ADMIN_EMAIL,
  ensureAdminExists,
  ensureUserExists,
} from '../../../helpers/users'

// The pages come from the public Overleaf wiki, which the instance caches on
// startup. The tests use long-lived pages and only check their structure.
const WIKI_URL = 'https://learnwiki.overleaf.com'

function pageTitle() {
  return cy.get('.page .page-header h1')
}

// The template puts whitespace around the title
function shouldShowTitle(title: string) {
  pageTitle().should(h1 => {
    expect(h1.text().trim()).to.equal(title)
  })
}

function pageContent() {
  return cy.get('.page .mw-parser-output')
}

function sidebar() {
  return cy.get('.contents .mw-parser-output')
}

before(function () {
  ensureAdminExists()
})

describe('learn pages', function () {
  beforeEach(function () {
    login(ADMIN_EMAIL)
  })

  it('shows the documentation home with the contents in the sidebar', function () {
    cy.visit('/learn')
    shouldShowTitle('Main Page')
    pageContent().findByRole('link', { name: 'Lists' }).should('exist')
    sidebar()
      .findByRole('link', { name: 'Lists' })
      .should('have.attr', 'href', '/learn/latex/Lists')
  })

  it('opens a page from the sidebar', function () {
    cy.visit('/learn')
    sidebar().findByRole('link', { name: 'Lists' }).click()
    cy.location('pathname').should('equal', '/learn/latex/Lists')
    shouldShowTitle('Lists')
  })

  it('points wiki links to the instance and images to the wiki', function () {
    cy.visit('/learn/latex/Learn_LaTeX_in_30_minutes')
    shouldShowTitle('Learn LaTeX in 30 minutes')
    pageContent()
      .find('a[href^="/learn/"]')
      .should('have.length.greaterThan', 0)
      .each(link => {
        expect(link.attr('href')).to.match(/^\/learn\/latex\//)
      })
    pageContent()
      .find('img[src*="/learn-scripts/images/"]')
      .should('have.length.greaterThan', 0)
      .each(img => {
        expect(img.attr('src')).to.match(
          new RegExp(`^${WIKI_URL}/learn-scripts/images/`)
        )
      })
    pageContent().find('script').should('not.exist')
  })

  it('follows a link inside a page', function () {
    cy.visit('/learn/latex/Learn_LaTeX_in_30_minutes')
    pageContent()
      .find('a[href="/learn/latex/Creating_a_document_in_Overleaf"]')
      .first()
      .click()
    cy.location('pathname').should(
      'equal',
      '/learn/latex/Creating_a_document_in_Overleaf'
    )
    shouldShowTitle('Creating a document in Overleaf')
  })

  it('shows the target of a wiki redirect', function () {
    cy.visit('/learn/latex/Aligning_equations')
    shouldShowTitle('Aligning equations with amsmath')
  })

  it('serves the knowledge base under /learn/how-to without its namespace', function () {
    // Kb/Knowledge Base redirects to Kb/How-to Guides on the wiki
    cy.visit('/learn/how-to')
    shouldShowTitle('How-to Guides')
    pageContent()
      .find('a[href^="/learn/latex/Kb/"]')
      .should('have.length.greaterThan', 0)
  })

  it('returns 404 for a page the wiki does not have', function () {
    const path = `/learn/latex/E2E_missing_page_${Date.now()}`
    cy.request({ url: path, failOnStatusCode: false })
      .its('status')
      .should('equal', 404)
    cy.visit(path, { failOnStatusCode: false })
    pageTitle().should('not.exist')
  })
})

describe('links to the documentation', function () {
  it('asks signed-out visitors to log in first', function () {
    // Without OVERLEAF_ALLOW_PUBLIC_ACCESS every page needs a login
    cy.visit('/learn/latex/Lists')
    cy.location('pathname').should('equal', '/login')
  })

  it('shows Documentation in the header', function () {
    login(ADMIN_EMAIL)
    cy.visit('/learn/latex/Lists')
    cy.findByRole('menuitem', { name: 'Documentation' }).should(
      'have.attr',
      'href',
      '/learn'
    )
  })

  it('links the LaTeX tutorial from the welcome message', function () {
    // A user without projects sees the welcome message
    const email = `learn-${Date.now()}@example.com`
    ensureUserExists(email)
    login(email)
    cy.visit('/project')
    cy.findByRole('link', { name: /Learn LaTeX with a tutorial/ }).should(
      'have.attr',
      'href',
      '/learn/latex/Learn_LaTeX_in_30_minutes'
    )
  })

  it('opens the documentation from the editor Help menu', function () {
    login(ADMIN_EMAIL)
    createProject(projectName('Learn')).then(openProject)
    cy.findByRole('menubar').findByRole('button', { name: 'Help' }).click()
    cy.findByRole('menuitem', { name: 'Documentation' })
      .should('have.attr', 'href', '/learn')
      .and('have.attr', 'target', '_blank')
  })
})
