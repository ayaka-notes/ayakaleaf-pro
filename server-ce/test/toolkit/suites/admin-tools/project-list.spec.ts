import { v4 as uuid } from 'uuid'
import { login } from '../../../helpers/login'
import { createProject } from '../../../helpers/project'
import { projectAccess } from '../../../helpers/adminTools'
import { postWithCsrf, requestWithCsrf } from '../../../helpers/request'
import { ADMIN_EMAIL } from '../../../helpers/users'
import {
  confirmDialog,
  createUser,
  dialog,
  everyRow,
  interceptSearch,
  ownerPicker,
  pickOwner,
  row,
  rowTexts,
  uniqueAlias,
  userId,
} from './panel'

// Every project of the site (/admin/project, the Admin menu's
// Project/Object Lookup): the projects of all owners in one list, found by
// name, id, owner or link, filtered by status, and the row and bulk actions,
// each going by the project's own owner. Checked through what the owners see.

const run = uuid().slice(0, 8)
const email = (name: string) => `site-${run}-${name}@example.com`
// every project of this run starts with it, so a search narrows to them
const prefix = `Site-${run}`
// ids made in before hooks: aliases do not last past the first test
const ids: Record<string, string> = {}

const ada = email('ada')
const bob = email('bob')
const carol = email('carol')
// the owner of the shared projects, out of the searches by prefix (which
// also match the owners' emails) and so out of their counts
const dan = `link-${run}-dan@example.com`

type ShareTokens = {
  readOnly: string
  readAndWrite: string
  readAndWriteHashPrefix: string
}
const tokens: Record<string, ShareTokens> = {}

// As the owner, over the share modal's calls: turns on link sharing and
// reads the view and the edit token
function shareByLink(id: string): Cypress.Chainable<ShareTokens> {
  cy.visit('/project')
  postWithCsrf(`/project/${id}/settings/admin`, { publicAccessLevel: 'tokenBased' })
    .its('status')
    .should('be.lessThan', 300)
  return cy.request(`/project/${id}/tokens`).its('body')
}

function visitList() {
  cy.visit('/admin/project')
  cy.get('.tab-pane.active').findByRole('textbox', { name: 'Search' }).should('exist')
}

// Waits until the list shows the answer (the Status menu's counts too)
function answered(alias: string) {
  cy.wait(`@${alias}`)
  cy.get('.tab-pane.active .admin-panel-loading').should('not.exist')
}

function search(text: string) {
  const projects = uniqueAlias('projects')
  interceptSearch('/admin/projects/list', text).as(projects)
  cy.get('.tab-pane.active').findByRole('textbox', { name: 'Search' }).clear().type(text)
  answered(projects)
}

function status(option: string) {
  const projects = uniqueAlias('projects')
  cy.intercept('GET', '/admin/projects/list*').as(projects)
  cy.get('#admin-projects-status').click()
  cy.get('.dropdown-menu.show').contains('.dropdown-item', option).click()
  answered(projects)
}

// The options of the Status filter with their counts, as the menu shows them
function statusCounts(): Cypress.Chainable<Record<string, number>> {
  cy.get('#admin-projects-status').click()
  return cy
    .get('.dropdown-menu.show .dropdown-item')
    .then(items => {
      const counts: Record<string, number> = {}
      for (const item of [...items]) {
        const match = item.innerText
          .replace(/\s+/g, ' ')
          .trim()
          .match(/^(?:check )?(.*?) (\d+)$/)
        if (match) counts[match[1]] = Number(match[2])
      }
      return counts
    })
    .then(counts => {
      cy.get('#admin-projects-status').click()
      return cy.wrap(counts)
    })
}

function bulk(name: string) {
  return cy.get('.tab-pane.active .admin-panel-bulk-actions').findByRole('button', { name })
}

function tickAll() {
  cy.get('#admin-projects-select-all').check()
}

// As the owner, over the project list's own endpoints
function setUp(owner: string, name: string, change?: 'archive' | 'trash' | 'delete') {
  login(owner)
  return createProject(name).then(id => {
    if (change) {
      cy.visit('/project')
      const request =
        change === 'delete'
          ? requestWithCsrf('DELETE', `/project/${id}`)
          : postWithCsrf(`/project/${id}/${change}`, {})
      request.its('status').should('be.lessThan', 300)
    }
    return cy.wrap(id)
  })
}

// every account once, first: creating ada and bob again for the second
// group stopped at the activation page (run 4)
before(function () {
  for (const address of [ada, bob, carol, dan]) createUser(address)
})

describe('every project of the site', function () {
  const names = {
    adaActive: `${prefix}-ada-active`,
    adaArchived: `${prefix}-ada-archived`,
    adaTrashed: `${prefix}-ada-trashed`,
    adaDeleted: `${prefix}-ada-deleted`,
    bobActive: `${prefix}-bob-active`,
    bobDeleted: `${prefix}-bob-deleted`,
    // regex characters are searched as they are
    bobLiteral: `${prefix}-bob (a+b)`,
    danShared: `Link-${run}-dan-shared`,
    danDeleted: `Link-${run}-dan-deleted`,
  }

  before(function () {
    setUp(dan, names.danShared).then(id => {
      ids.danShared = id
      shareByLink(id).then(body => {
        tokens.danShared = body
      })
    })
    setUp(dan, names.danDeleted).then(id => {
      shareByLink(id).then(body => {
        tokens.danDeleted = body
      })
      requestWithCsrf('DELETE', `/project/${id}`).its('status').should('be.lessThan', 300)
    })
    setUp(ada, names.adaActive).then(id => {
      ids.adaActive = id
    })
    setUp(ada, names.adaArchived, 'archive')
    setUp(ada, names.adaTrashed, 'trash')
    setUp(ada, names.adaDeleted, 'delete')
    setUp(bob, names.bobActive).then(id => {
      ids.bobActive = id
    })
    setUp(bob, names.bobDeleted, 'delete')
    setUp(bob, names.bobLiteral)
  })

  beforeEach(function () {
    login(ADMIN_EMAIL)
  })

  it('has no Templates tab while the template gallery is off', function () {
    visitList()
    cy.findByRole('tab', { name: 'Projects' }).should('exist')
    cy.findByRole('tab', { name: 'Templates' }).should('not.exist')
  })

  it('opens from the Admin menu with the projects of every owner', function () {
    cy.visit('/project')
    cy.findByRole('menuitem', { name: 'Admin' }).click()
    cy.findByRole('menuitem', { name: 'Project/Object Lookup' }).click()
    cy.url().should('match', /\/admin\/project$/)
    cy.get('.tab-pane.active')
      .findByRole('textbox', { name: 'Search' })
      .should('have.attr', 'placeholder', 'Search by project name, ID, owner or link')
    search(prefix)
    rowTexts().then(rows => {
      const all = rows.join('|')
      for (const name of [names.adaActive, names.adaArchived, names.adaTrashed, names.bobActive]) {
        expect(all).to.contain(name)
      }
      expect(all).not.to.contain(names.adaDeleted)
      expect(all).not.to.contain(names.bobDeleted)
    })
    row(names.adaActive).should('contain.text', ada)
    row(names.bobActive).should('contain.text', bob)
  })

  it('links each title to its project page and each owner to their page', function () {
    visitList()
    search(names.bobActive)
    cy.wrap(null).then(() => {
      row(names.bobActive)
        .findByRole('link', { name: names.bobActive })
        .should('have.attr', 'href', `/admin/project/${ids.bobActive}`)
    })
    userId(bob).then(id => {
      row(names.bobActive).find(`a[href="/admin/user/${id}"]`).click()
      cy.url().should('contain', `/admin/user/${id}`)
      cy.get('.admin-panel-user-header').should('contain.text', bob)
    })
  })

  it('finds projects by name, by id and by the owner email', function () {
    visitList()
    search(names.bobLiteral)
    rowTexts().then(rows => {
      expect(rows).to.have.length(1)
      expect(rows[0]).to.contain(names.bobLiteral)
    })
    cy.wrap(null).then(() => {
      search(ids.adaActive)
      rowTexts().then(rows => {
        expect(rows).to.have.length(1)
        expect(rows[0]).to.contain(names.adaActive)
      })
    })
    search(ada)
    rowTexts().should('have.length', 3)
    everyRow('.tab-pane.active tbody tr', text => text.includes(ada))
    search(bob)
    rowTexts().should('have.length', 2)
    everyRow('.tab-pane.active tbody tr', text => text.includes(bob))
  })

  it('finds a project by its view link, its edit link, its address or a token', function () {
    visitList()
    cy.wrap(null).then(() => {
      const base = Cypress.config().baseUrl
      const { readOnly, readAndWrite, readAndWriteHashPrefix } = tokens.danShared
      for (const text of [
        `${base}/read/${readOnly}`,
        `${base}/${readAndWrite}`,
        // as the share modal copies it
        `${base}/${readAndWrite}#${readAndWriteHashPrefix}`,
        `${base}/project/${ids.danShared}`,
        readOnly,
      ]) {
        search(text)
        rowTexts().then(rows => {
          expect(rows, text).to.have.length(1)
          expect(rows[0]).to.contain(names.danShared).and.contain(dan)
        })
      }
    })
  })

  it('tells about a deleted project found by its view link', function () {
    visitList()
    cy.wrap(null).then(() => {
      search(`${Cypress.config().baseUrl}/read/${tokens.danDeleted.readOnly}`)
    })
    cy.get('.tab-pane.active tbody').should('contain.text', 'No projects')
    cy.contains('.tab-pane.active .admin-panel-hint', 'Found 1 matching deleted projects')
      .findByRole('button', { name: 'Display deleted projects' })
      .click()
    rowTexts().then(rows => {
      expect(rows).to.have.length(1)
      expect(rows[0]).to.contain(names.danDeleted).and.contain('Deleted')
    })
  })

  it('counts every status of every owner, and each shows its projects', function () {
    visitList()
    search(prefix)
    statusCounts().should('deep.equal', {
      All: 5,
      Active: 3,
      Archived: 1,
      Trashed: 1,
      Deleted: 2,
    })
    status('Archived')
    rowTexts().then(rows => {
      expect(rows).to.have.length(1)
      expect(rows[0]).to.contain(names.adaArchived).and.contain('Archived')
    })
    status('Trashed')
    rowTexts().then(rows => {
      expect(rows).to.have.length(1)
      expect(rows[0]).to.contain(names.adaTrashed).and.contain('Trashed')
    })
    status('Active')
    rowTexts().should('have.length', 3)
    everyRow('.tab-pane.active tbody tr', text => text.includes('Active'))
    // the counts follow the search, by owner too
    search(bob)
    statusCounts().should('deep.equal', {
      All: 2,
      Active: 2,
      Archived: 0,
      Trashed: 0,
      Deleted: 1,
    })
  })

  it('tells about matching deleted projects and shows them with their owners', function () {
    visitList()
    search(prefix)
    cy.contains('.tab-pane.active .admin-panel-hint', 'Found 2 matching deleted projects')
      .findByRole('button', { name: 'Display deleted projects' })
      .click()
    rowTexts().should('have.length', 2)
    row(names.adaDeleted).should('contain.text', ada).and('contain.text', 'Deleted')
    row(names.bobDeleted).should('contain.text', bob).and('contain.text', 'Deleted')
    cy.get('.tab-pane.active').findByRole('button', { name: 'Hide deleted projects' }).click()
    cy.get('.tab-pane.active tbody').should('not.contain.text', names.adaDeleted)
  })

  // Clicks a column's sort button and waits for the list to answer
  function sortBy(name: string | RegExp) {
    const projects = uniqueAlias('projects')
    cy.intercept('GET', '/admin/projects/list*').as(projects)
    cy.get('.tab-pane.active thead').findByRole('button', { name }).click()
    answered(projects)
  }

  it('keeps the search and the filter in the address, so a reload shows the same', function () {
    visitList()
    search(prefix)
    status('Deleted')
    cy.location('search')
      .should('contain', 'status=deleted')
      .and('contain', `search=${prefix}`)
    cy.reload()
    cy.get('#admin-projects-status').should('contain.text', 'Deleted')
    cy.get('.tab-pane.active')
      .findByRole('textbox', { name: 'Search' })
      .should('have.value', prefix)
    row(names.adaDeleted).should('exist')
    row(names.adaActive).should('not.exist')
  })

  it('says something went wrong, and keeps the page, when the session ended', function () {
    visitList()
    search(prefix)
    cy.clearCookie('overleaf.sid')
    cy.get('.tab-pane.active')
      .findByRole('textbox', { name: 'Search' })
      .clear()
      .type(names.bobActive)
    cy.get('.tab-pane.active .notification-type-error').should('exist')
    cy.get('.tab-pane.active')
      .findByRole('textbox', { name: 'Search' })
      .should('have.value', names.bobActive)
    // the page that replaces a crashed one asks for a reload
    cy.contains('Please refresh the page to continue').should('not.exist')
  })

  it('sorts by title and by last modified, both ways, and deleted ones by when', function () {
    visitList()
    search(prefix)
    // newest first: bob's literal one was made last, ada's active one first
    rowTexts().then(rows => {
      expect(rows[0]).to.contain(names.bobLiteral)
      expect(rows.at(-1)).to.contain(names.adaActive)
    })
    sortBy(/Title/)
    rowTexts().then(rows => {
      expect(rows[0]).to.contain(names.adaActive)
      expect(rows.at(-1)).to.contain(`${prefix}-bob`)
    })
    sortBy('Reverse Title sort order')
    rowTexts().then(rows => {
      expect(rows[0]).to.contain(`${prefix}-bob`)
      expect(rows.at(-1)).to.contain(names.adaActive)
    })
    sortBy(/Last modified/)
    rowTexts().then(rows => expect(rows[0]).to.contain(names.bobLiteral))
    sortBy('Reverse Last modified sort order')
    rowTexts().then(rows => expect(rows[0]).to.contain(names.adaActive))
    // the deleted ones by when they were deleted: ada's first, then bob's
    status('Deleted')
    sortBy(/Deleted At/)
    rowTexts().then(rows => {
      expect(rows).to.have.length(2)
      expect(rows[0]).to.contain(names.bobDeleted)
    })
    sortBy('Reverse Deleted At sort order')
    rowTexts().then(rows => expect(rows[0]).to.contain(names.adaDeleted))
  })
})

describe('actions on every project', function () {
  // two projects, one of each owner, with a prefix of their own for each case
  let caseName = ''
  const project = { ada: '', bob: '' }

  beforeEach(function () {
    caseName = `${prefix}-case-${uuid().slice(0, 8)}`
    setUp(ada, `${caseName}-ada`).then(id => {
      project.ada = id
    })
    setUp(bob, `${caseName}-bob`).then(id => {
      project.bob = id
    })
    login(ADMIN_EMAIL)
    visitList()
    search(caseName)
    rowTexts().should('have.length', 2)
  })

  it('changes the owner of one project from its row', function () {
    row(`${caseName}-ada`).findByRole('button', { name: 'Change project owner' }).click()
    pickOwner(carol)
    confirmDialog('Change project owner')
    row(`${caseName}-ada`).should('contain.text', carol)
    row(`${caseName}-bob`).should('contain.text', bob)
    cy.wrap(null).then(() =>
      projectAccess(carol).then(access => {
        expect(access[project.ada]).to.equal('owner')
        expect(access[project.bob]).to.equal(undefined)
      })
    )
  })

  it('finds a project by the full name of its owner', function () {
    const owner = email(`named-${caseName.slice(-8)}`)
    const surname = `Surname${caseName.slice(-8)}`
    createUser(owner)
    setUp(owner, `${caseName}-named`)
    login(ADMIN_EMAIL)
    visitList()
    userId(owner).then(id =>
      postWithCsrf(`/admin/user/${id}/update`, { firstName: 'Lin', lastName: surname })
        .its('status')
        .should('equal', 200)
    )
    search(`Lin ${surname}`)
    rowTexts().then(rows => {
      expect(rows).to.have.length(1)
      expect(rows[0]).to.contain(`${caseName}-named`)
    })
  })

  it('lists ticked projects of two owners that share a name', function () {
    const shared = `${caseName}-shared`
    setUp(ada, shared)
    setUp(bob, shared)
    login(ADMIN_EMAIL)
    visitList()
    search(shared)
    rowTexts().should('have.length', 2)
    tickAll()
    bulk('Change project owner').click()
    dialog().find('.admin-panel-modal-list li').should('have.length', 2)
    dialog().findByRole('button', { name: 'Cancel' }).click()
    dialog().should('not.exist')
  })

  it('refuses to restore a project while its owner is deleted, and says why', function () {
    const owner = email(`gone-${caseName.slice(-8)}`)
    createUser(owner)
    setUp(owner, `${caseName}-orphan`).then(projectId => {
      login(ADMIN_EMAIL)
      visitList()
      userId(owner).then(ownerId => {
        postWithCsrf(`/admin/user/${ownerId}/delete`, {}).its('status').should('equal', 200)
        search(`${caseName}-orphan`)
        cy.get('.tab-pane.active').findByRole('button', { name: 'Display deleted projects' }).click()
        row(`${caseName}-orphan`).findByRole('button', { name: 'Restore' }).click()
        dialog().within(() => {
          cy.findByRole('button', { name: 'Restore' }).click()
          cy.get('.notification-type-error').should('contain.text', 'restore the owner first')
          cy.findByRole('button', { name: 'Cancel' }).click()
        })
        dialog().should('not.exist')
        // with the owner back it is back too
        postWithCsrf(`/admin/user/${ownerId}/restore`, {}).its('status').should('equal', 200)
        projectAccess(owner).then(access => {
          expect(access[projectId]).to.equal('owner')
        })
      })
    })
  })

  it('answers 404 to a purge of a project that is not deleted, and logs nothing', function () {
    visitList()
    requestWithCsrf('DELETE', `/admin/project/${project.ada}/purge`)
      .its('status')
      .should('equal', 404)
    userId(ADMIN_EMAIL).then(id => {
      cy.request(`/admin/user/${id}/audit-log/list?operation=purge-deleted-project&search=&pageSize=200`)
        .its('body.entries')
        .then((entries: { info?: { projectId?: string } }[]) => {
          expect(entries.map(entry => entry.info?.projectId)).not.to.include(project.ada)
        })
    })
    projectAccess(ada).then(access => {
      expect(access[project.ada]).to.equal('owner')
    })
  })

  it('restores a project to its own owner, whoever the request names', function () {
    setUp(dan, `Restore-${run}`, 'delete').then(id => {
      login(ADMIN_EMAIL)
      visitList()
      userId(bob).then(otherId => {
        postWithCsrf(`/admin/project/${id}/undelete`, { userId: otherId })
          .its('status')
          .should('equal', 200)
      })
      projectAccess(dan).then(access => {
        expect(access[id]).to.equal('owner')
      })
      projectAccess(bob).then(access => {
        expect(access).not.to.have.property(id)
      })
    })
  })

  it('deletes a project from its row and restores it to its own owner', function () {
    row(`${caseName}-bob`).findByRole('button', { name: 'Delete' }).click()
    confirmDialog('Delete')
    cy.get('.tab-pane.active tbody').should('not.contain.text', `${caseName}-bob`)
    cy.get('.tab-pane.active').findByRole('button', { name: 'Display deleted projects' }).click()
    row(`${caseName}-bob`).findByRole('button', { name: 'Restore' }).click()
    confirmDialog('Restore')
    cy.get('.tab-pane.active tbody').should('contain.text', 'No projects')
    cy.wrap(null).then(() =>
      projectAccess(bob).then(access => {
        expect(access[project.bob]).to.equal('owner')
      })
    )
  })

  it('gives ticked projects of two owners to a third, never to one of them', function () {
    tickAll()
    cy.get('.tab-pane.active .admin-panel-footer').should('contain.text', '2 selected')
    bulk('Change project owner').click()
    // the owners of the ticked projects are not offered
    interceptSearch('/admin/users/list', ada).as('owners')
    ownerPicker().type(ada)
    cy.wait('@owners')
    cy.findByRole('option', { name: new RegExp(ada) }).should('not.exist')
    ownerPicker().clear()
    pickOwner(carol)
    confirmDialog('Change project owner')
    everyRow('.tab-pane.active tbody tr', text => text.includes(carol))
    cy.wrap(null).then(() =>
      projectAccess(carol).then(access => {
        expect(access[project.ada]).to.equal('owner')
        expect(access[project.bob]).to.equal('owner')
      })
    )
  })

  it('keeps the ticks when a bulk action is cancelled, and Deleted starts afresh', function () {
    tickAll()
    for (const name of ['Delete', 'Change project owner']) {
      bulk(name).click()
      dialog().findByRole('button', { name: 'Cancel' }).click()
      dialog().should('not.exist')
      cy.get('.tab-pane.active .admin-panel-footer').should('contain.text', '2 selected')
    }
    // the ticked live rows do not carry over to the deleted ones
    status('Deleted')
    cy.get('.tab-pane.active tbody').should('contain.text', 'No projects')
    cy.get('.tab-pane.active .admin-panel-footer').should('not.contain.text', 'selected')
    cy.get('.tab-pane.active .admin-panel-bulk-actions').should('not.exist')
    status('All')
    rowTexts().should('have.length', 2)
  })

  it('downloads ticked projects of two owners as one zip', function () {
    tickAll()
    cy.intercept('GET', '/project/download/zip*').as('zip')
    bulk('Download').click()
    cy.wait('@zip').then(({ request, response }) => {
      const projectIds = new URL(request.url).searchParams.get('project_ids')!.split(',')
      expect(projectIds).to.have.members([project.ada, project.bob])
      expect(response!.statusCode).to.equal(200)
    })
  })

  it('deletes ticked projects of two owners, restores each to its owner and purges them', function () {
    tickAll()
    bulk('Delete').click()
    dialog().should('contain.text', `${caseName}-ada`).and('contain.text', `${caseName}-bob`)
    confirmDialog('Delete')
    cy.contains('.tab-pane.active .admin-panel-hint', 'Found 2 matching deleted projects')
      .findByRole('button', { name: 'Display deleted projects' })
      .click()
    row(`${caseName}-ada`).should('contain.text', ada)
    row(`${caseName}-bob`).should('contain.text', bob)
    tickAll()
    bulk('Change project owner').should('not.exist')
    bulk('Restore').click()
    confirmDialog('Restore')
    cy.get('.tab-pane.active tbody').should('contain.text', 'No projects')
    cy.wrap(null).then(() => {
      projectAccess(ada).then(access => expect(access[project.ada]).to.equal('owner'))
      projectAccess(bob).then(access => expect(access[project.bob]).to.equal('owner'))
    })

    login(ADMIN_EMAIL)
    visitList()
    search(caseName)
    rowTexts().should('have.length', 2)
    tickAll()
    bulk('Delete').click()
    confirmDialog('Delete')
    cy.get('.tab-pane.active').findByRole('button', { name: 'Display deleted projects' }).click()
    tickAll()
    bulk('Delete permanently').click()
    confirmDialog('Delete permanently')
    cy.get('.tab-pane.active tbody').should('contain.text', 'No projects')
    cy.get('.tab-pane.active').findByRole('button', { name: 'Hide deleted projects' }).click()
    cy.get('.tab-pane.active tbody').should('contain.text', 'No projects')
    // purged: nothing left to find among the deleted ones either
    cy.get('.tab-pane.active .admin-panel-hint').should('not.exist')
  })
})
