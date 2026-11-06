import { v4 as uuid } from 'uuid'
import { login } from '../../../helpers/login'
import { createProject, projectName } from '../../../helpers/project'
import { projectAccess } from '../../../helpers/adminTools'
import { postWithCsrf, requestWithCsrf } from '../../../helpers/request'
import { shareProject, shareProjectByLink } from '../../../helpers/sharing'
import { ADMIN_EMAIL } from '../../../helpers/users'
import {
  confirmDialog,
  expectLogged,
  createUser,
  dialog,
  header,
  headerAction,
  interceptSearch,
  openTab,
  pickOwner,
  row,
  rowTexts,
  uniqueAlias,
  userId,
  visitProject,
  visitUser,
} from './panel'

// A user's projects (the Projects tab of /admin/user/:id) and a project's
// page (/admin/project/:id): the lists, the details, the file tree, the
// members, deleted files, the audit log, and the admin's changes to them,
// checked through what the owner and the collaborators would notice.

const run = uuid().slice(0, 8)
// ids made in before hooks: aliases do not last past the first test
const ids = { active: '', page: '' }
const email = (name: string) => `projects-${run}-${name}@example.com`

function detail(label: string) {
  return cy.contains('.tab-pane.active tr', label).find('td')
}

function searchProjects(text: string) {
  const projects = uniqueAlias('projects')
  interceptSearch('/admin/user/*/projects/list', text).as(projects)
  cy.get('.tab-pane.active').findByRole('textbox', { name: 'Search' }).clear().type(text)
  cy.wait(`@${projects}`)
}

// As the owner, over the editor's own endpoints
function addFolder(projectId: string, name: string, parentFolderId?: string) {
  return postWithCsrf(`/project/${projectId}/folder`, {
    name,
    parent_folder_id: parentFolderId,
  }).then(response => {
    expect(response.status).to.equal(200)
    return response.body._id as string
  })
}

function addDoc(projectId: string, name: string, parentFolderId?: string) {
  return postWithCsrf(`/project/${projectId}/doc`, {
    name,
    parent_folder_id: parentFolderId,
  }).then(response => {
    expect(response.status).to.equal(200)
    return response.body._id as string
  })
}

function projectNameOf(email: string, projectId: string) {
  login(email)
  return cy
    .request('/user/projects')
    .then(
      response =>
        response.body.projects.find((p: { _id: string }) => p._id === projectId)
          ?.name
    )
}

describe('the Projects tab of a user', function () {
  const owner = email('owner')
  const other = email('other')
  const names = {
    active: projectName('Active'),
    archived: projectName('Archived'),
    trashed: projectName('Trashed'),
    deleted: projectName('Deleted'),
  }

  before(function () {
    createUser(owner)
    createUser(other)
    login(owner)
    createProject(names.active).then(id => {
      ids.active = id
    })
    createProject(names.archived).then(id => {
      cy.visit('/project')
      postWithCsrf(`/project/${id}/archive`, {}).its('status').should('be.lessThan', 300)
    })
    createProject(names.trashed).then(id => {
      cy.visit('/project')
      postWithCsrf(`/project/${id}/trash`, {}).its('status').should('be.lessThan', 300)
    })
    createProject(names.deleted).then(id => {
      cy.visit('/project')
      requestWithCsrf('DELETE', `/project/${id}`).its('status').should('be.lessThan', 300)
    })
  })

  beforeEach(function () {
    login(ADMIN_EMAIL)
    userId(owner).then(id => visitUser(id, 'projects'))
  })

  it('lists every project that is not deleted, with its status', function () {
    rowTexts().then(rows => {
      expect(rows.join('|')).to.contain(names.active)
      expect(rows.join('|')).to.contain(names.archived)
      expect(rows.join('|')).to.contain(names.trashed)
      expect(rows.join('|')).not.to.contain(names.deleted)
    })
    row(names.archived).should('contain.text', 'Archived')
    row(names.trashed).should('contain.text', 'Trashed')
    row(names.active).should('contain.text', 'Active')
  })

  it('searches by name and by id, as the placeholder says', function () {
    cy.get('.tab-pane.active')
      .findByRole('textbox', { name: 'Search' })
      .should('have.attr', 'placeholder', 'Search by project name or ID')
    searchProjects(names.archived)
    cy.get('.tab-pane.active tbody tr').should('have.length', 1)
    cy.wrap(null).then(() => ids.active).then(id => {
      searchProjects(id)
      cy.get('.tab-pane.active tbody tr').should('have.length', 1)
      row(names.active).should('exist')
    })
  })

  it('tells about a deleted project that matches and shows it', function () {
    searchProjects(names.deleted)
    cy.get('.tab-pane.active tbody').should('not.contain.text', names.deleted)
    cy.contains('.tab-pane.active .admin-panel-hint', 'Found 1 matching deleted projects')
      .findByRole('button', { name: 'Display deleted projects' })
      .click()
    row(names.deleted).should('contain.text', 'Deleted')
    row(names.deleted).findByRole('button', { name: 'Restore' }).should('exist')
    cy.get('.tab-pane.active')
      .findByRole('button', { name: 'Hide deleted projects' })
      .click()
    cy.get('.tab-pane.active tbody').should('not.contain.text', names.deleted)
  })

  // The options of the Status filter with their counts, as the menu shows them
  function statusCounts(): Cypress.Chainable<Record<string, number>> {
    cy.get('#admin-user-projects-status').click()
    return cy
      .get('.dropdown-menu.show .dropdown-item')
      .then(items => {
        const counts: Record<string, number> = {}
        for (const item of [...items]) {
          const match = item.innerText.replace(/\s+/g, ' ').trim().match(/^(?:check )?(.*?) (\d+)$/)
          if (match) counts[match[1]] = Number(match[2])
        }
        return counts
      })
      .then(counts => {
        cy.get('#admin-user-projects-status').click()
        return cy.wrap(counts)
      })
  }

  function status(option: string) {
    const projects = uniqueAlias('projects')
    cy.intercept('GET', '/admin/user/*/projects/list*').as(projects)
    cy.get('#admin-user-projects-status').click()
    cy.get('.dropdown-menu.show').contains('.dropdown-item', option).click()
    cy.wait(`@${projects}`)
  }

  it('counts every status, and each shows its projects', function () {
    statusCounts().should('deep.equal', {
      All: 3,
      Active: 1,
      Archived: 1,
      Trashed: 1,
      Deleted: 1,
    })
    for (const [option, name] of [
      ['Active', names.active],
      ['Archived', names.archived],
      ['Trashed', names.trashed],
      ['Deleted', names.deleted],
    ]) {
      status(option)
      rowTexts().should('have.length', 1)
      row(name).should('exist')
      cy.get('#admin-user-projects-status').should('contain.text', `Status: ${option}`)
    }
    // deleted rows are restored or purged, not opened
    row(names.deleted).findByRole('button', { name: 'Open Project' }).should('not.exist')
    status('All')
    rowTexts().should('have.length', 3)
  })

  it('counts follow the search', function () {
    searchProjects(names.archived)
    statusCounts().then(counts => {
      expect(counts).to.include({ All: 1, Archived: 1, Active: 0, Trashed: 0, Deleted: 0 })
    })
  })

  it('sorts by title and by last modified, both ways', function () {
    cy.intercept('GET', '/admin/user/*/projects/list*').as('projects')
    cy.get('.tab-pane.active thead').findByRole('button', { name: /Title/ }).click()
    cy.wait('@projects')
    rowTexts().then(rows => expect(rows[0]).to.contain(names.active))
    cy.get('.tab-pane.active thead')
      .findByRole('button', { name: 'Reverse Title sort order' })
      .click()
    cy.wait('@projects')
    rowTexts().then(rows => expect(rows[0]).to.contain(names.trashed))
    cy.get('.tab-pane.active thead').findByRole('button', { name: /Last modified/ }).click()
    cy.wait('@projects')
    // newest first: the trashed one was created last of the three
    rowTexts().then(rows => expect(rows[0]).to.contain(names.trashed))
  })

  it('links each live project to the editor', function () {
    cy.wrap(null).then(() => ids.active).then(id => {
      row(names.active)
        .findByRole('link', { name: 'Open Project' })
        .should('have.attr', 'href', `/project/${id}`)
    })
  })

  it('opens the project page from its name', function () {
    row(names.active).findByRole('link', { name: names.active }).click()
    cy.location('pathname').should('match', /^\/admin\/project\/[0-9a-f]{24}$/)
    cy.get('.admin-panel-user-header').should('contain.text', names.active)
  })

  it('changes the owner of one project from its row', function () {
    const name = projectName('Row-owner')
    login(owner)
    createProject(name).then(projectId => {
      login(ADMIN_EMAIL)
      userId(owner).then(id => visitUser(id, 'projects'))
      row(name).findByRole('button', { name: 'Change project owner' }).click()
      dialog().should('contain.text', 'This action cannot be undone.')
      pickOwner(other)
      confirmDialog('Change project owner')
      row(name).should('not.exist')
      projectAccess(other).its(projectId).should('equal', 'owner')
      projectAccess(owner).its(projectId).should('equal', 'readWrite')
    })
  })

  it('deletes a project, restores it and purges it', function () {
    const name = projectName('Lifecycle')
    login(owner)
    createProject(name).then(projectId => {
      login(ADMIN_EMAIL)
      userId(owner).then(id => visitUser(id, 'projects'))
      row(name).findByRole('button', { name: 'Delete' }).click()
      confirmDialog('Delete')
      row(name).should('not.exist')
      projectAccess(owner).should('not.have.property', projectId)

      login(ADMIN_EMAIL)
      userId(owner).then(id => visitUser(id, 'projects'))
      searchProjects(name)
      cy.get('.tab-pane.active').findByRole('button', { name: 'Display deleted projects' }).click()
      row(name).findByRole('button', { name: 'Restore' }).click()
      confirmDialog('Restore')
      row(name).should('not.exist')
      projectAccess(owner).its(projectId).should('equal', 'owner')

      login(ADMIN_EMAIL)
      userId(owner).then(id => visitUser(id, 'projects'))
      searchProjects(name)
      row(name).findByRole('button', { name: 'Delete' }).click()
      confirmDialog('Delete')
      cy.get('.tab-pane.active').findByRole('button', { name: 'Display deleted projects' }).click()
      row(name).findByRole('button', { name: 'Delete permanently' }).click()
      dialog().should('contain.text', 'This action cannot be undone.')
      confirmDialog('Delete permanently')
      row(name).should('not.exist')
      cy.request({ url: `/admin/project/${projectId}`, failOnStatusCode: false })
        .its('status')
        .should('equal', 404)
    })
  })
})

describe('pages of projects', function () {
  const owner = email('pager')
  const prefix = `Pager-${run}`

  before(function () {
    createUser(owner)
    login(owner)
    for (let i = 0; i < 12; i++) {
      createProject(`${prefix}-${String(i).padStart(2, '0')}`)
    }
  })

  beforeEach(function () {
    login(ADMIN_EMAIL)
    userId(owner).then(id => visitUser(id, 'projects'))
  })

  it('shows ten per page, the next page, and a larger page size', function () {
    rowTexts().should('have.length', 10)
    cy.get('.tab-pane.active').should('contain.text', 'Showing 10 out of 12 projects.')
    cy.intercept('GET', '/admin/user/*/projects/list*').as('projects')
    cy.get('.tab-pane.active').findByRole('button', { name: 'Go to page 2' }).click()
    cy.wait('@projects')
    rowTexts().should('have.length', 2)
    cy.get('.tab-pane.active').findByRole('button', { name: 'Go to first page' }).click()
    cy.wait('@projects')
    rowTexts().should('have.length', 10)
    cy.get('#admin-user-projects-page-size').click()
    cy.get('.dropdown-menu.show').contains('.dropdown-item', '20 per page').click()
    cy.wait('@projects')
    rowTexts().should('have.length', 12)
  })

  it('finds one project of many by part of its name', function () {
    searchProjects(`${prefix}-07`)
    rowTexts().should('have.length', 1)
    row(`${prefix}-07`).should('exist')
  })
})

describe('bulk actions on projects', function () {
  const owner = email('bulk-owner')
  const other = email('bulk-other')
  // three projects with a prefix of their own for each case
  let prefix = ''

  function bulk(name: string) {
    return cy
      .get('.tab-pane.active .admin-panel-bulk-actions')
      .findByRole('button', { name })
  }

  function openOwnerProjects() {
    login(ADMIN_EMAIL)
    userId(owner).then(id => visitUser(id, 'projects'))
    searchProjects(prefix)
  }

  function tickAll() {
    cy.get('#admin-user-projects-select-all').check()
  }

  before(function () {
    createUser(owner)
    createUser(other)
  })

  beforeEach(function () {
    prefix = `Bulk-${uuid().slice(0, 8)}`
    login(owner)
    for (const i of [1, 2, 3]) createProject(`${prefix}-${i}`)
  })

  it('downloads the ticked projects as one zip, as core does', function () {
    openOwnerProjects()
    tickAll()
    cy.get('.tab-pane.active .admin-panel-footer').should('contain.text', '3 selected')
    // core's zip comes as an attachment: the page stays
    cy.intercept('GET', '/project/download/zip*').as('zip')
    bulk('Download').click()
    cy.wait('@zip').then(({ request, response }) => {
      const projectIds = new URL(request.url).searchParams.get('project_ids')!.split(',')
      expect(projectIds).to.have.length(3)
      expect(response!.statusCode).to.equal(200)
    })
  })

  it('gives the ticked projects to another owner', function () {
    openOwnerProjects()
    tickAll()
    cy.get('.tab-pane.active tbody tr').then(rows => {
      const ids = [...rows].map(
        tr => tr.querySelector('a')!.getAttribute('href')!.split('/').pop()!
      )
      bulk('Change project owner').click()
      pickOwner(other)
      confirmDialog('Change project owner')
      cy.get('.tab-pane.active tbody').should('contain.text', 'No projects')
      projectAccess(other).then(access => {
        for (const id of ids) expect(access[id]).to.equal('owner')
      })
    })
  })

  it('deletes the ticked projects, restores them and purges them', function () {
    openOwnerProjects()
    tickAll()
    bulk('Delete').click()
    dialog().should('contain.text', `${prefix}-1`).and('contain.text', `${prefix}-3`)
    confirmDialog('Delete')
    cy.contains('.tab-pane.active .admin-panel-hint', 'Found 3 matching deleted projects')
      .findByRole('button', { name: 'Display deleted projects' })
      .click()
    tickAll()
    bulk('Change project owner').should('not.exist')
    bulk('Restore').click()
    confirmDialog('Restore')
    cy.get('.tab-pane.active tbody').should('contain.text', 'No projects')

    openOwnerProjects()
    rowTexts().should('have.length', 3)
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

describe('the project page', function () {
  const owner = email('page-owner')
  const editor = email('editor')
  const viewer = email('viewer')
  const reviewer = email('reviewer')
  const linkViewer = email('link-viewer')
  const invitee = email('invitee')
  const newOwner = email('new-owner')
  const name = projectName('Page')

  before(function () {
    for (const address of [owner, editor, viewer, reviewer, linkViewer, newOwner]) {
      createUser(address)
    }
    login(owner)
    createProject(name, 'example').then(projectId => {
      ids.page = projectId
      cy.visit('/project')
      addFolder(projectId, 'chapters').then(chapters => {
        addDoc(projectId, 'intro.tex', chapters)
        addFolder(projectId, 'figures', chapters).then(figures =>
          addDoc(projectId, 'plot.tex', figures)
        )
      })
      addDoc(projectId, 'notes.tex').then(docId => {
        requestWithCsrf('DELETE', `/project/${projectId}/doc/${docId}`)
          .its('status')
          .should('be.lessThan', 300)
      })
      shareProject(projectId, editor, 'readAndWrite')
      login(owner)
      shareProject(projectId, viewer, 'readOnly')
      login(owner)
      shareProject(projectId, reviewer, 'review')
      login(owner)
      shareProjectByLink(projectId, linkViewer, 'readOnly')
      login(owner)
      cy.visit('/project')
      postWithCsrf(`/project/${projectId}/invite`, {
        email: invitee,
        privileges: 'readAndWrite',
      })
        .its('status')
        .should('equal', 200)
    })
  })

  beforeEach(function () {
    login(ADMIN_EMAIL)
  })

  it('shows the details and leads back to the owner', function () {
    cy.wrap(null).then(() => ids.page).then(projectId => {
      visitProject(projectId)
      detail('ID').should('contain.text', projectId)
      detail('Owner').should('contain.text', owner)
      detail('Status').should('contain.text', 'Active')
      detail('Link sharing').should('contain.text', 'Link sharing is on')
      detail('Compiler').should('contain.text', 'pdfLaTeX')
      // the name the editor's menu shows, not the image
      detail('TeX Live version')
        .should('contain.text', 'TeX Live 2026')
        .and('not.contain.text', 'texlive-basic')
      detail('Main document').should('contain.text', '/main.tex')
      detail('Size').invoke('text').should('match', /\d+(\.\d+)? (B|KB|MB)/)
      // the owner's name, which a new account takes from its email
      cy.get('a.previous-page-link').should('contain.text', owner.split('@')[0]).click()
      cy.location('pathname').should('match', /^\/admin\/user\/[0-9a-f]{24}$/)
      cy.location('hash').should('equal', '#projects')
    })
  })

  it('downloads the project and links to it', function () {
    cy.wrap(null).then(() => ids.page).then(projectId => {
      visitProject(projectId)
      // links, not buttons
      header().findByRole('link', { name: 'Open Project' }).should('have.attr', 'href', `/project/${projectId}`)
      header()
        .findByRole('link', { name: 'Download' })
        .invoke('attr', 'href')
        .then(href => {
          cy.request({ url: href as string, encoding: 'binary' }).then(response => {
            expect(response.status).to.equal(200)
            expect(response.headers['content-type']).to.contain('zip')
          })
        })
    })
  })

  it('shows the file tree folded, folders first, and unfolds a folder', function () {
    cy.wrap(null).then(() => ids.page).then(projectId => {
      visitProject(projectId, 'files')
      rowTexts().then(rows => {
        expect(rows[0]).to.contain('chapters')
        expect(rows.join('|')).to.contain('main.tex')
        expect(rows.join('|')).to.contain('frog.jpg')
        expect(rows.join('|')).not.to.contain('intro.tex')
      })
      cy.get('.tab-pane.active').findByRole('button', { name: /chapters/ }).click()
      row('intro.tex').should('exist')
      row('figures').should('exist')
      row('plot.tex').should('not.exist')
      cy.get('.tab-pane.active').findByRole('button', { name: /figures/ }).click()
      row('plot.tex').should('exist')
      cy.get('.tab-pane.active').findByRole('button', { name: /chapters/ }).click()
      row('intro.tex').should('not.exist')
      row('plot.tex').should('not.exist')
    })
  })

  it('lists the members and the invite nobody accepted yet', function () {
    cy.wrap(null).then(() => ids.page).then(projectId => {
      visitProject(projectId, 'members')
      row(owner).should('contain.text', 'Owner')
      row(editor).should('contain.text', 'Editor')
      row(viewer).should('contain.text', 'Viewer')
      row(reviewer).should('contain.text', 'Reviewer')
      row(linkViewer).should('contain.text', 'Link sharing').and('contain.text', 'Viewer')
      row(invitee).should('contain.text', 'Pending invite')
    })
  })

  it('changes a collaborator’s role and removes access', function () {
    cy.wrap(null).then(() => ids.page).then(projectId => {
      visitProject(projectId, 'members')
      headerAction('Edit').click()
      row(owner).find('select').should('not.exist')
      row(owner).findByRole('button', { name: 'Remove access' }).should('not.exist')
      row(viewer).find('select').select('readAndWrite')
      row(viewer).find('select').should('have.value', 'readAndWrite')
      projectAccess(viewer).its(projectId).should('equal', 'readWrite')

      login(ADMIN_EMAIL)
      visitProject(projectId, 'members')
      headerAction('Edit').click()
      row(linkViewer).findByRole('button', { name: 'Remove access' }).click()
      confirmDialog('Remove access')
      row(linkViewer).should('not.exist')
      projectAccess(linkViewer).should('not.have.property', projectId)
    })
  })

  it('resends and revokes an invite', function () {
    cy.wrap(null).then(() => ids.page).then(projectId => {
      visitProject(projectId, 'members')
      headerAction('Edit').click()
      row(invitee).findByRole('button', { name: 'Resend invite' }).click()
      confirmDialog('Resend invite')
      row(invitee).findByRole('button', { name: 'Revoke Invite' }).click()
      confirmDialog('Revoke Invite')
      row(invitee).should('not.exist')
      cy.get('.tab-pane.active').findByRole('button', { name: 'Done' }).click()
      cy.reload()
      row(invitee).should('not.exist')
    })
  })

  it('restores a deleted file as a copy and keeps the deleted one listed', function () {
    cy.wrap(null).then(() => ids.page).then(projectId => {
      visitProject(projectId, 'deleted-files')
      row('notes.tex').findByRole('button', { name: 'Restore file' }).click()
      confirmDialog('Restore file')
      row('notes.tex').should('contain.text', '/notes-')
      row('notes.tex').findByRole('button', { name: 'Restore file' }).should('exist')
      expectLogged(`/admin/project/${projectId}`, 'restore-deleted-doc')
      cy.reload()
      openTab('File tree')
      rowTexts().then(rows => expect(rows.join('|')).to.match(/notes-[0-9-]+\.tex/))
    })
  })

  it('edits the project’s settings with the pencil', function () {
    cy.wrap(null).then(() => ids.page).then(projectId => {
      const renamed = projectName('Renamed')
      visitProject(projectId)
      headerAction('Edit').click()
      cy.get('#admin-project-name').clear().type(renamed)
      cy.get('#admin-project-compiler').select('XeLaTeX')
      // the project's image is the one selected, by the same name
      cy.get('#admin-project-imageName option:selected').should('have.text', 'TeX Live 2026')
      cy.get('#admin-project-imageName').select('TeX Live 2025')
      // the main document: any doc the editor offers, here one in a folder
      cy.get('#admin-project-rootDocId').select('/chapters/intro.tex')
      cy.get('#admin-project-link-sharing').uncheck()
      cy.get('.tab-pane.active').findByRole('button', { name: 'Save' }).click()
      cy.get('.tab-pane.active').contains('Saved').should('exist')
      cy.get('.admin-panel-user-header').should('contain.text', renamed)
      cy.reload()
      detail('Compiler').should('contain.text', 'XeLaTeX')
      detail('TeX Live version').should('contain.text', 'TeX Live 2025')
      detail('Main document').should('contain.text', '/chapters/intro.tex')
      detail('Link sharing').should('contain.text', 'Link sharing is off')
      projectNameOf(owner, projectId).should('equal', renamed)
    })
  })

  it('changes the owner, keeping the old owner as an editor', function () {
    cy.wrap(null).then(() => ids.page).then(projectId => {
      visitProject(projectId)
      headerAction('Edit').click()
      cy.get('.tab-pane.active').findByRole('button', { name: 'Change project owner' }).click()
      pickOwner(newOwner)
      confirmDialog('Change project owner')
      detail('Owner').should('contain.text', newOwner)
      projectAccess(newOwner).its(projectId).should('equal', 'owner')
      projectAccess(owner).its(projectId).should('equal', 'readWrite')
    })
  })

  it('shows the audit log of the project', function () {
    cy.wrap(null).then(() => ids.page).then(projectId => {
      visitProject(projectId, 'audit-logs')
      row('Transfer ownership').should('contain.text', ADMIN_EMAIL)
      row('Send invite').should('exist')
    })
  })
})

describe('a deleted project', function () {
  it('shows who deleted it and when, and can be restored or purged', function () {
    const owner = email('deleted-owner')
    const name = projectName('Gone')
    createUser(owner)
    login(owner)
    createProject(name).then(projectId => {
      login(ADMIN_EMAIL)
      visitProject(projectId)
      headerAction('Delete').click()
      confirmDialog('Delete')
      cy.get('.admin-panel-user-header').should('contain.text', 'Deleted')
      cy.findAllByRole('tab').should('have.length', 1)
      detail('Deleted By email').should('contain.text', ADMIN_EMAIL)
      headerAction('Restore').click()
      confirmDialog('Restore')
      cy.get('.admin-panel-user-header').should('contain.text', 'Active')
      expectLogged(`/admin/project/${projectId}`, 'project-deleted')
      expectLogged(`/admin/project/${projectId}`, 'project-restored')

      headerAction('Delete').click()
      confirmDialog('Delete')
      headerAction('Delete permanently').click()
      confirmDialog('Delete permanently')
      cy.location('pathname').should('match', /^\/admin\/user\/[0-9a-f]{24}$/)
      cy.request({ url: `/admin/project/${projectId}`, failOnStatusCode: false })
        .its('status')
        .should('equal', 404)
      // a purge deletes the project's log too: the admin's own log tells
      userId(ADMIN_EMAIL).then(adminId => {
        // the restore above gave it a suffix
        expectLogged(`/admin/user/${adminId}`, 'purge-deleted-project')
          .its('info.name')
          .should('contain', name)
      })
    })
  })

  it('answers 404 for an unknown project', function () {
    login(ADMIN_EMAIL)
    for (const id of ['0123456789abcdef01234567', 'not-an-id']) {
      cy.request({ url: `/admin/project/${id}`, failOnStatusCode: false })
        .its('status')
        .should('equal', 404)
    }
  })
})
