import { v4 as uuid } from 'uuid'
import { login } from '../../../helpers/login'
import {
  createProject,
  openNewProject,
  projectName,
} from '../../../helpers/project'
import { postWithCsrf, requestWithCsrf } from '../../../helpers/request'
import {
  getTemplate,
  listTemplates,
  openAsTemplate,
  publishTemplate,
  requestTemplateRoute,
  visitTemplate,
} from '../../../helpers/templates'
import { ADMIN_EMAIL, ensureUserExists } from '../../../helpers/users'

// template-gallery module, configured as in the docs (variables.env). Source
// projects are plain new projects. Admins publish, everybody logged in uses
// the templates.

const user = `user-${uuid()}@example.com`

function loggedInUserId() {
  cy.visit('/project')
  return cy.get('meta[name="ol-user_id"]').invoke('attr', 'content')
}

function openFileMenu() {
  cy.findByRole('button', { name: 'File' }).click()
}

// Publishes the open project through File > Manage Template.
function openManageTemplate() {
  openFileMenu()
  cy.findByRole('menuitem', { name: 'Manage Template' }).click()
}

// Old files of a template are deleted in the background.
function waitUntilGone(url: string, attempt = 1) {
  requestTemplateRoute(url).then(response => {
    if (response.status === 200 && attempt < 10) {
      cy.wait(1_000)
      waitUntilGone(url, attempt + 1)
    } else {
      expect(response.status).not.to.equal(200)
    }
  })
}

before(function () {
  ensureUserExists(user)
})

describe('publishing a template', function () {
  const name = projectName('Smoke')
  let projectId: string
  let templateId: string

  it('lets the admin publish a compiled project from the File menu', function () {
    login(ADMIN_EMAIL)
    openNewProject(name)
    cy.url().then(url => {
      projectId = url.split('/').pop() as string
    })

    openManageTemplate()
    cy.findByRole('dialog').within(() => {
      cy.findByLabelText('Title:').should('have.value', name)
      cy.findByLabelText('Author:').clear().type('Ayaka Tester')
      cy.findByLabelText('Categories:').select('Journal articles')
      cy.findByLabelText('Description:').type(
        'A **smoke** test template with a [link](https://example.com).'
      )
      cy.findByLabelText('License:').select('LaTeX Project Public License 1.3c')
      cy.findByRole('button', { name: 'Publish' }).click()
    })

    cy.url({ timeout: 60_000 })
      .should('match', /\/template\/[0-9a-f]{24}$/)
      .then(url => {
        templateId = url.split('/').pop() as string
      })
    cy.findByRole('heading', { name })
    cy.findByText('Ayaka Tester')
    cy.findByText('LaTeX Project Public License 1.3c')
    cy.contains('strong', 'smoke')
    cy.findByRole('link', { name: 'link' }).should(
      'have.attr',
      'href',
      'https://example.com'
    )
  })

  it('keeps main file, compiler, category, version and source project', function () {
    login(ADMIN_EMAIL)
    loggedInUserId().then(adminId => {
      getTemplate(templateId).then(template => {
        expect(template).to.include({
          name,
          category: '/templates/academic-journal',
          license: 'lppl_1.3c',
          mainFile: 'main.tex',
          compiler: 'pdflatex',
          version: '1',
          project_id: projectId,
          owner: adminId,
        })
      })
    })
  })

  it('serves the PDF, the preview images and the source zip', function () {
    login(ADMIN_EMAIL)
    requestTemplateRoute(`/template/${templateId}/preview?version=1`).then(
      response => {
        expect(response.status).to.equal(200)
        expect(response.body.slice(0, 5)).to.equal('%PDF-')
      }
    )
    for (const style of ['thumbnail', 'preview']) {
      requestTemplateRoute(
        `/template/${templateId}/preview?version=1&style=${style}`
      ).then(response => {
        expect(response.status, style).to.equal(200)
        expect(response.body.length, style).to.be.greaterThan(500)
      })
    }
    requestTemplateRoute(`/template/${templateId}/zip?version=1`).then(
      response => {
        expect(response.status).to.equal(200)
        expect(response.body.slice(0, 2)).to.equal('PK')
        expect(response.body).to.contain('main.tex')
      }
    )
  })

  it('links the admin to the source project', function () {
    login(ADMIN_EMAIL)
    visitTemplate(templateId)
    cy.findByRole('link', { name: 'Admin: Source Project' }).should(
      'have.attr',
      'href',
      `/project/${projectId}`
    )
  })
})

describe('creating a project from a template', function () {
  let sourceId: string
  let templateId: string
  const name = `Article ${uuid().slice(0, 8)}`

  before(function () {
    login(ADMIN_EMAIL)
    createProject(name).then(id => {
      sourceId = id
      // Settings that have to carry over to projects made from the template
      postWithCsrf(`/project/${id}/settings`, {
        compiler: 'xelatex',
        spellCheckLanguage: 'de',
      })
        .its('status')
        .should('equal', 204)
      publishTemplate(id, { name }).then(response => {
        expect(response.status, JSON.stringify(response.body)).to.equal(200)
        templateId = response.body.template_id
      })
    })
  })

  it('stores the compiler and spell check language of the project', function () {
    login(user)
    getTemplate(templateId).then(template => {
      expect(template).to.include({ compiler: 'xelatex', language: 'de' })
    })
  })

  it('gives a user a new project of their own with the files of the template', function () {
    login(user)
    openAsTemplate(templateId).then(projectId => {
      expect(projectId).not.to.equal(sourceId)
      cy.get('.cm-content').should('contain.text', '\\documentclass')
      cy.request(`/project/${projectId}/entities`)
        .its('body.entities')
        .should('deep.include', { path: '/main.tex', type: 'doc' })
      cy.visit('/project')
      cy.findByRole('link', { name })
    })
  })

  it('carries the compiler over to the new project', function () {
    login(user)
    openAsTemplate(templateId)
    cy.findByRole('button', { name: 'Settings' }).click()
    cy.findByRole('dialog').findByRole('tab', { name: 'Compiler' }).click()
    cy.findByRole('dialog')
      .findByRole('combobox', { name: 'Compiler' })
      .find('option:selected')
      .should('have.text', 'XeLaTeX')
  })

  it('gives two independent projects when opened twice', function () {
    login(user)
    openAsTemplate(templateId).then(first => {
      openAsTemplate(templateId).should('not.equal', first)
    })
  })

  it('keeps working after the source project is deleted', function () {
    login(ADMIN_EMAIL)
    cy.visit('/project')
    requestWithCsrf('DELETE', `/project/${sourceId}`)
      .its('status')
      .should('equal', 200)
    visitTemplate(templateId)
    cy.findByRole('heading', { name })
    cy.findByRole('link', { name: 'Admin: Source Project' }).should('not.exist')
    // Leaving a page while it still loads assets can crash web here: the send
    // patch's Stream.pipeline throws on Node 24 instead of calling back.
    cy.wait(2_000)

    login(user)
    openAsTemplate(templateId)
    cy.get('.cm-content').should('contain.text', '\\documentclass')
    cy.wait(2_000)
  })
})

describe('the gallery', function () {
  // A run-unique tag keeps these four apart from the other suites' templates.
  const tag = `gal${uuid().slice(0, 6)}`
  const templates = [
    {
      name: `${tag} Alpha journal`,
      category: '/templates/academic-journal',
      descriptionMD: 'Two-column article.',
    },
    {
      name: `${tag} beta journal`,
      category: '/templates/academic-journal',
      descriptionMD: `Single column, needle-in-${tag}.`,
    },
    {
      name: `${tag} Gamma slides`,
      category: '/templates/presentation',
      descriptionMD: 'Beamer slides.',
      authorMD: 'Slide Maker',
    },
    {
      name: `${tag} Delta thesis`,
      category: '/templates/thesis',
      descriptionMD: 'A thesis.',
    },
  ]

  before(function () {
    login(ADMIN_EMAIL)
    for (const template of templates) {
      createProject(template.name).then(id => {
        publishTemplate(id, template)
          .its('status')
          .should('equal', 200)
      })
    }
  })

  beforeEach(function () {
    login(user)
  })

  it('filters by category', function () {
    listTemplates({ category: 'all', q: tag }).its('totalSize').should('equal', 4)
    listTemplates({ category: 'academic-journal', q: tag, by: 'name', order: 'asc' })
      .its('templates')
      .then(list => {
        expect(list.map((t: { name: string }) => t.name)).to.deep.equal([
          `${tag} Alpha journal`,
          `${tag} beta journal`,
        ])
      })
    listTemplates({ category: 'presentation', q: tag })
      .its('totalSize')
      .should('equal', 1)
    listTemplates({ category: 'no-such-category', q: tag })
      .its('totalSize')
      .should('equal', 0)
  })

  it('searches name, author and description, case-insensitively and literally', function () {
    const names = (q: string) =>
      listTemplates({ category: 'all', q }).then(body =>
        body.templates.map((t: { name: string }) => t.name)
      )
    names(`${tag} GAMMA`).should('deep.equal', [`${tag} Gamma slides`])
    names('slide maker').should('include', `${tag} Gamma slides`)
    names(`needle-in-${tag}`).should('deep.equal', [`${tag} beta journal`])
    listTemplates({ category: 'all', q: '.*' }).its('totalSize').should('equal', 0)
  })

  it('sorts by name case-insensitively and by last update', function () {
    listTemplates({ category: 'all', q: tag, by: 'name', order: 'asc' })
      .its('templates')
      .then(list => {
        expect(list.map((t: { name: string }) => t.name)).to.deep.equal([
          `${tag} Alpha journal`,
          `${tag} beta journal`,
          `${tag} Delta thesis`,
          `${tag} Gamma slides`,
        ])
      })
    listTemplates({ category: 'all', q: tag, by: 'lastUpdated', order: 'desc' })
      .its('templates.0.name')
      .should('equal', `${tag} Delta thesis`)
  })

  it('rejects an unknown sort field', function () {
    requestTemplateRoute('/api/templates?category=all&by=owner')
      .its('status')
      .should('equal', 400)
  })

  it('paginates', function () {
    const page = (n: number) =>
      listTemplates({
        category: 'all',
        q: tag,
        by: 'name',
        order: 'asc',
        page: n,
        pageSize: 3,
      })
    page(1).then(body => {
      expect(body.totalSize).to.equal(4)
      expect(body.templates).to.have.length(3)
    })
    page(2)
      .its('templates')
      .then(list => {
        expect(list.map((t: { name: string }) => t.name)).to.deep.equal([
          `${tag} Gamma slides`,
        ])
      })
    // page < 1 counts as 1, pageSize is capped at 50
    listTemplates({ category: 'all', q: tag, page: 0, pageSize: 1000 })
      .its('templates')
      .should('have.length', 4)
  })

  it('lists the configured categories', function () {
    cy.visit('/templates')
    for (const [key, name] of [
      ['academic-journal', 'Journal articles'],
      ['book', 'Books'],
      ['presentation', 'Presentations'],
      ['poster', 'Posters'],
      ['cv', 'CVs and résumés'],
      ['homework', 'Assignments'],
      ['bibliography', 'Bibliographies'],
      ['calendar', 'Calendars'],
      ['formal-letter', 'Formal letters'],
      ['report', 'Reports'],
      ['thesis', 'Theses'],
      ['newsletter', 'Newsletters'],
    ]) {
      // Each category is a card linking to its page
      cy.contains(`a[href="/templates/${key}"]`, name)
    }
  })

  it('shows the templates of a category page', function () {
    cy.visit('/templates/presentation')
    cy.findByRole('heading', { name: /Presentations/ })
    cy.findByRole('link', { name: new RegExp(`${tag} Gamma slides`) })
    cy.findByRole('link', { name: new RegExp(`${tag} Alpha journal`) }).should(
      'not.exist'
    )
  })

  it('searches from the gallery page and opens a template', function () {
    cy.visit('/templates/all')
    cy.findByLabelText('Search…').type(`${tag} gamma{enter}`)
    cy.findByRole('link', { name: new RegExp(`${tag} Gamma slides`) }).click()
    cy.findByRole('heading', { name: `${tag} Gamma slides` })
    cy.findByText('Slide Maker')
    cy.findByRole('link', { name: 'Open as Template' })
    cy.findByRole('link', { name: 'View PDF' })
  })
})

describe('gallery pages, sorting and search', function () {
  // Ten templates sharing a run-unique tag: one more than a page holds (9)
  const tag = `pg${uuid().slice(0, 6)}`
  const names = Array.from(
    { length: 10 },
    (_, i) => `${tag} ${String(i + 1).padStart(2, '0')}`
  )

  function entries() {
    return cy.get('.gallery-container .gallery-thumbnail')
  }

  function firstTitle() {
    return entries().first().find('.caption-title')
  }

  function search(text: string) {
    cy.findByLabelText('Search…').clear().type(text)
  }

  before(function () {
    login(ADMIN_EMAIL)
    for (const name of names) {
      createProject(name).then(id => {
        publishTemplate(id, { name }).its('status').should('equal', 200)
      })
    }
  })

  beforeEach(function () {
    login(user)
    cy.visit('/templates/all')
    search(tag)
  })

  it('shows nine templates per page and pages through the rest', function () {
    entries().should('have.length', 9)
    cy.findByRole('navigation', { name: 'Pagination Navigation' }).within(() => {
      cy.findByLabelText('Current Page, Page 1')
      cy.findByRole('button', { name: 'Go to page 2' }).click()
    })
    entries().should('have.length', 1)
    cy.findByLabelText('Current Page, Page 2')

    cy.findByRole('button', { name: 'Go to previous page' }).click()
    entries().should('have.length', 9)
    cy.findByLabelText('Current Page, Page 1')
  })

  it('sorts by title both ways and starts again on page one', function () {
    cy.findByRole('button', { name: 'Go to page 2' }).click()
    cy.findByRole('button', { name: 'Sort by Title' }).click()
    cy.findByLabelText('Current Page, Page 1')
    firstTitle().should('have.text', names[0])

    cy.findByRole('button', { name: 'Reverse Title sort order' }).click()
    firstTitle().should('have.text', names[9])
  })

  it('hides the pagination when one page is enough', function () {
    search(names[4])
    entries().should('have.length', 1)
    firstTitle().should('have.text', names[4])
    cy.findByRole('navigation', { name: 'Pagination Navigation' }).should(
      'not.exist'
    )
  })

  it('says so when nothing matches', function () {
    search(`${tag}-nothing-matches`)
    cy.findByText('No Templates.')
    entries().should('not.exist')
  })

  it('returns to the page shown before searching when the search is cleared', function () {
    cy.findByLabelText('Search…').clear()
    cy.findByRole('button', { name: 'Go to page 2' }).click()
    cy.findByLabelText('Current Page, Page 2')

    search(tag)
    cy.findByLabelText('Current Page, Page 1')
    cy.findByLabelText('Search…').clear()
    cy.findByLabelText('Current Page, Page 2')
  })
})

describe('managing templates', function () {
  const name = projectName('Managed')
  let templateId: string

  before(function () {
    login(ADMIN_EMAIL)
    createProject(name).then(id => {
      publishTemplate(id, { name }).then(response => {
        expect(response.status).to.equal(200)
        templateId = response.body.template_id
      })
    })
  })

  beforeEach(function () {
    login(ADMIN_EMAIL)
  })

  it('asks before overwriting a template of the same title, then bumps the version', function () {
    openNewProject(name)
    cy.url().as('sourceUrl')
    openManageTemplate()
    cy.findByRole('dialog').within(() => {
      cy.findByRole('button', { name: 'Publish' }).click()
      cy.findByText(
        /A template with this title already exists and is owned by you\. Do you want to overwrite it\?/i
      )
      cy.findByRole('button', { name: 'Overwrite' }).click()
    })
    cy.url({ timeout: 60_000 }).should('contain', `/template/${templateId}`)

    cy.get<string>('@sourceUrl').then(sourceUrl => {
      getTemplate(templateId).then(template => {
        expect(template.version).to.equal('2')
        expect(template.project_id).to.equal(sourceUrl.split('/').pop())
      })
    })
    requestTemplateRoute(`/template/${templateId}/zip?version=2`)
      .its('status')
      .should('equal', 200)
    waitUntilGone(`/template/${templateId}/zip?version=1`)
  })

  it('edits title, category, description and license', function () {
    const newName = `${name} renamed`
    visitTemplate(templateId)
    cy.findByRole('button', { name: 'Edit' }).click()
    cy.findByRole('dialog').within(() => {
      cy.findByText('Edit template')
      cy.findByLabelText('Title:').clear().type(newName)
      cy.findByLabelText('Categories:').select('Theses')
      cy.findByLabelText('Description:').clear().type('New *description*')
      cy.findByLabelText('License:').select('Other (as stated in the work)')
      cy.findByRole('button', { name: 'Save' }).click()
    })
    cy.findByRole('heading', { name: newName })

    cy.reload()
    cy.findByRole('heading', { name: newName })
    cy.contains('em', 'description')
    getTemplate(templateId).then(template => {
      expect(template).to.include({
        name: newName,
        category: '/templates/thesis',
        license: 'other',
      })
    })
  })

  it('refuses to rename to the title of another template', function () {
    const taken = projectName('Taken')
    createProject(taken).then(id => {
      publishTemplate(id, { name: taken }).its('status').should('equal', 200)
    })
    cy.visit('/project')
    postWithCsrf(`/template/${templateId}/edit`, { name: taken })
      .its('status')
      .should('equal', 409)
  })

  it('sanitises the markdown fields', function () {
    cy.visit('/project')
    postWithCsrf(`/template/${templateId}/edit`, {
      descriptionMD:
        'ok <script>alert(1)</script> <img src=x onerror=alert(2)> [x](javascript:alert(3)) [y](https://example.com)',
      authorMD: '<b onmouseover=alert(4)>Evil</b> [site](https://example.org)',
    })
      .its('status')
      .should('equal', 200)

    const alert = cy.stub().as('alert')
    cy.on('window:alert', alert)
    visitTemplate(templateId)
    cy.findByRole('link', { name: 'y' }).should(
      'have.attr',
      'href',
      'https://example.com'
    )
    cy.findByRole('link', { name: 'site' }).should(
      'have.attr',
      'href',
      'https://example.org'
    )
    cy.get('script:not([src])').each($script => {
      expect($script.text()).not.to.contain('alert(1)')
    })
    cy.get('[onerror], [onmouseover], a[href^="javascript:"]').should(
      'not.exist'
    )
    cy.get('@alert').should('not.have.been.called')
  })

  it('needs a compile of the project to publish', function () {
    createProject(projectName('NoPdf')).then(id => {
      publishTemplate(id, {
        name: projectName('NoPdf'),
        build: 'abcdef0123456-0123456789abcdef',
      }).then(response => {
        expect(response.status).to.equal(400)
        expect(response.body.message).to.match(/recompile/i)
      })
    })
  })

  it('deletes the template, its page and its files', function () {
    visitTemplate(templateId)
    cy.findByRole('button', { name: 'Delete' }).click()
    cy.findByRole('dialog').within(() => {
      cy.findByText('Delete template')
      cy.findByRole('button', { name: 'Confirm' }).click()
    })
    cy.url().should('not.contain', `/template/${templateId}`)

    requestTemplateRoute(`/template/${templateId}`)
      .its('status')
      .should('equal', 404)
    getTemplate(templateId).then(template => {
      expect(template).to.equal(null)
    })
    waitUntilGone(`/template/${templateId}/zip?version=2`)
  })
})

describe('template permissions', function () {
  const name = projectName('AdminTpl')
  let templateId: string
  let userProjectId: string

  before(function () {
    login(ADMIN_EMAIL)
    createProject(name).then(id => {
      publishTemplate(id, { name }).then(response => {
        templateId = response.body.template_id
      })
    })
    login(user)
    createProject(projectName('UserSource')).then(id => {
      userProjectId = id
    })
  })

  it('does not let a regular user publish, edit or delete', function () {
    login(user)
    publishTemplate(userProjectId, { name: projectName('UserTpl') })
      .its('status')
      .should('equal', 403)
    postWithCsrf(`/template/${templateId}/edit`, { name: 'hijacked' })
      .its('status')
      .should('equal', 403)
    requestWithCsrf('DELETE', `/template/${templateId}/delete`, { version: 1 })
      .its('status')
      .should('equal', 403)
    getTemplate(templateId).its('name').should('equal', name)
  })

  it('shows a regular user no Manage Template entry and no edit or delete buttons', function () {
    login(user)
    cy.visit(`/project/${userProjectId}`)
    openFileMenu()
    cy.findByRole('menuitem', { name: 'Word count' })
    cy.findByRole('menuitem', { name: 'Manage Template' }).should('not.exist')

    visitTemplate(templateId)
    cy.findByRole('link', { name: 'Open as Template' })
    cy.findByRole('button', { name: 'Edit' }).should('not.exist')
    cy.findByRole('button', { name: 'Delete' }).should('not.exist')
  })

  it('sends anonymous visitors to the login page', function () {
    for (const url of [
      '/templates/all',
      `/template/${templateId}`,
      '/api/templates?category=all',
    ]) {
      cy.request({ url, followRedirect: false }).then(response => {
        expect(response.status, url).to.equal(302)
        expect(response.headers.location, url).to.contain('/login')
      })
    }
  })
})

describe('template robustness', function () {
  const name = projectName('Robust')
  let templateId: string

  before(function () {
    login(ADMIN_EMAIL)
    createProject(name).then(id => {
      publishTemplate(id, { name }).then(response => {
        templateId = response.body.template_id
      })
    })
  })

  it('enforces length limits on title, description, author and license', function () {
    login(ADMIN_EMAIL)
    createProject(projectName('Limits')).then(id => {
      for (const [field, length] of [
        ['name', 151],
        ['descriptionMD', 4097],
        ['authorMD', 513],
        ['license', 513],
      ] as const) {
        publishTemplate(id, {
          name: projectName('Limits'),
          build: 'unused-the-input-is-checked-first',
          [field]: 'x'.repeat(length),
        })
          .its('status')
          .should('equal', 400)
      }
    })
    postWithCsrf(`/template/${templateId}/edit`, { name: 'x'.repeat(151) })
      .its('status')
      .should('equal', 400)
  })

  it('answers unknown or malformed ids with 404', function () {
    login(user)
    for (const url of [
      '/template/000000000000000000000000',
      '/template/not-an-id',
      `/template/${templateId}/preview?version=1&style=bogus`,
      `/template/${templateId}/preview`,
      `/template/${templateId}/zip`,
    ]) {
      requestTemplateRoute(url).its('status').should('equal', 404)
    }
    requestTemplateRoute(`/template/${templateId}/zip?version=99`)
      .its('status')
      .should('be.gte', 400)
  })

  it('looks templates up by id or name only', function () {
    login(user)
    let started = 0
    cy.then(() => {
      started = Date.now()
    })
    requestTemplateRoute(
      `/api/template?key=%24where&val=${encodeURIComponent('sleep(3000) || true')}`
    ).then(response => {
      expect(Date.now() - started).to.be.lessThan(2_000)
      expect(response.body).to.equal(null)
    })
    requestTemplateRoute(`/api/template?key=name&val=${name}`)
      .its('body.name')
      .should('equal', name)
  })

  it('reports an error for a template whose files are missing and keeps working', function () {
    login(user)
    cy.visit('/project')
    postWithCsrf('/project/new/template/post_back', {
      templateId: '000000000000000000000000',
      templateVersionId: '1',
      templateName: 'missing',
      compiler: 'pdflatex',
      mainFile: 'main.tex',
      language: 'en',
    }).then(response => {
      expect(response.status).to.be.gte(400)
      expect(response.status).not.to.equal(502)
    })
    cy.request('/project').its('status').should('equal', 200)
  })
})
