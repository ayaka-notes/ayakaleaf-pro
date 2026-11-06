import { v4 as uuid } from 'uuid'
import { login } from '../../../../helpers/login'
import {
  compileProject,
  createProject,
  projectName,
} from '../../../../helpers/project'
import { getTemplate, publishTemplate } from '../../../../helpers/templates'
import { ADMIN_EMAIL, ensureAdminExists } from '../../../../helpers/users'
import {
  confirmDialog,
  dialog,
  interceptSearch,
  row,
  rowTexts,
  uniqueAlias,
} from '../panel'

// The Templates tab of /admin/project, with the template gallery on: finding,
// sorting and paging the gallery's templates, opening and deleting them.

const run = uuid().slice(0, 8)
const prefix = `Tab-${run}`
const pages = Array.from(
  { length: 12 },
  (_, i) => `${prefix}-page-${String(i).padStart(2, '0')}`
)
const alpha = `${prefix}-alpha`
const beta = `${prefix}-beta`
const doomed = `${prefix}-doomed`
const ids: Record<string, string> = {}

function visitTab() {
  cy.visit('/admin/project#templates')
  cy.get('.tab-pane.active')
    .findByRole('textbox', { name: 'Search' })
    .should('exist')
}

function answered(alias: string) {
  cy.wait(`@${alias}`)
  cy.get('.tab-pane.active .admin-panel-loading').should('not.exist')
}

function search(text: string) {
  const list = uniqueAlias('templates')
  interceptSearch('/admin/templates/list', text).as(list)
  cy.get('.tab-pane.active')
    .findByRole('textbox', { name: 'Search' })
    .clear()
    .type(text)
  answered(list)
}

before(function () {
  ensureAdminExists()
  login(ADMIN_EMAIL)
  createProject(projectName('Template source')).then(projectId => {
    compileProject(projectId).then(build => {
      const publish = (name: string, fields = {}) =>
        publishTemplate(projectId, { name, build, ...fields }).then(
          response => {
            expect(response.status).to.equal(200)
            ids[name] = response.body.template_id
          }
        )
      pages.forEach(name => publish(name))
      publish(alpha, {
        authorMD: 'Ada Writer',
        descriptionMD: 'About lighthouses.',
      })
      publish(beta, { authorMD: 'Bob Writer' })
      publish(doomed)
    })
  })
})

beforeEach(function () {
  login(ADMIN_EMAIL)
})

describe('the Templates tab', function () {
  it('opens from the projects, and the address keeps the tab', function () {
    cy.visit('/admin/project')
    cy.findByRole('tab', { name: 'Templates' }).click()
    cy.location('hash').should('equal', '#templates')
    row(prefix).should('exist')
    cy.reload()
    row(prefix).should('exist')
    cy.findByRole('tab', { name: 'Projects' }).click()
    cy.get('.tab-pane.active')
      .findByRole('textbox', { name: 'Search' })
      .should(
        'have.attr',
        'placeholder',
        'Search by project name, ID, owner or link'
      )
  })

  it('shows the author and the owner, who links to their page', function () {
    visitTab()
    search(alpha)
    cy.get('.tab-pane.active tbody tr').should('have.length', 1)
    row(alpha).should('contain.text', 'Ada Writer')
    row(alpha).should('contain.text', ADMIN_EMAIL)
    row(alpha)
      .find('a[href^="/admin/user/"]')
      .should('have.attr', 'href')
      .and('match', /^\/admin\/user\/[0-9a-f]{24}$/)
  })

  it('opens a template from its title and from the View action', function () {
    visitTab()
    search(alpha)
    row(alpha)
      .findByRole('link', { name: 'View' })
      .should('have.attr', 'href', `/template/${ids[alpha]}`)
      .and('have.attr', 'target', '_blank')
    row(alpha).findByRole('link', { name: alpha }).click()
    cy.location('pathname').should('equal', `/template/${ids[alpha]}`)
    cy.findByRole('heading', { name: alpha }).should('exist')
  })

  it('finds templates by name, author and description', function () {
    visitTab()
    search(beta)
    rowTexts().then(rows => {
      expect(rows).to.have.length(1)
      expect(rows[0]).to.contain(beta)
    })
    search('Bob Writer')
    rowTexts().then(rows => {
      expect(rows).to.have.length(1)
      expect(rows[0]).to.contain(beta)
    })
    search('lighthouses')
    rowTexts().then(rows => {
      expect(rows).to.have.length(1)
      expect(rows[0]).to.contain(alpha)
    })
    search(`${prefix}-nothing`)
    cy.get('.tab-pane.active tbody').should('contain.text', 'No Search Results')
  })

  it('pages through the matches and changes the page size', function () {
    visitTab()
    search(`${prefix}-page-`)
    cy.get('.tab-pane.active tbody tr').should('have.length', 10)
    cy.contains('.tab-pane.active', 'Showing 10 results of 12').should('exist')
    const second = uniqueAlias('templates')
    cy.intercept('GET', '/admin/templates/list*').as(second)
    cy.findByRole('button', { name: 'Go to page 2' }).click()
    answered(second)
    cy.get('.tab-pane.active tbody tr').should('have.length', 2)

    cy.get('#admin-templates-page-size').click()
    const bigger = uniqueAlias('templates')
    cy.intercept('GET', '/admin/templates/list*').as(bigger)
    cy.get('.dropdown-menu.show')
      .contains('.dropdown-item', '20 per page')
      .click()
    answered(bigger)
    cy.get('.tab-pane.active tbody tr').should('have.length', 12)
    cy.findByRole('button', { name: 'Go to page 2' }).should('not.exist')
  })

  it('sorts by title and by last modified, both ways', function () {
    // the newest first
    visitTab()
    search(`${prefix}-page-`)
    cy.get('.tab-pane.active tbody tr')
      .first()
      .should('contain.text', pages[11])
    const sort = (name: string | RegExp) => {
      const list = uniqueAlias('templates')
      cy.intercept('GET', '/admin/templates/list*').as(list)
      cy.get('.tab-pane.active thead').findByRole('button', { name }).click()
      answered(list)
    }
    sort(/Title/)
    cy.get('.tab-pane.active tbody tr').first().should('contain.text', pages[0])
    sort('Reverse Title sort order')
    cy.get('.tab-pane.active tbody tr')
      .first()
      .should('contain.text', pages[11])
    sort(/Last modified/)
    cy.get('.tab-pane.active tbody tr')
      .first()
      .should('contain.text', pages[11])
    sort('Reverse Last modified sort order')
    cy.get('.tab-pane.active tbody tr').first().should('contain.text', pages[0])
  })

  it('asks before deleting: Cancel keeps the template, Delete removes it from the gallery', function () {
    visitTab()
    search(doomed)
    row(doomed).findByRole('button', { name: 'Delete' }).click()
    dialog().should('contain.text', doomed)
    dialog().should('contain.text', 'This action cannot be undone')
    dialog().findByRole('button', { name: 'Cancel' }).click()
    dialog().should('not.exist')
    row(doomed).should('exist')
    getTemplate(ids[doomed]).then(template => {
      expect(template?.id).to.equal(ids[doomed])
    })

    row(doomed).findByRole('button', { name: 'Delete' }).click()
    confirmDialog('Delete')
    cy.get('.tab-pane.active tbody').should('contain.text', 'No Search Results')
    getTemplate(ids[doomed]).then(template => {
      expect(template?.id).to.equal(undefined)
    })
  })
})
