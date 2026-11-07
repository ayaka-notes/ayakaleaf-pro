import { v4 as uuid } from 'uuid'
import { setUserPassword } from '../../../../helpers/adminTools'
import { DEFAULT_PASSWORD, login } from '../../../../helpers/login'
import {
  compileProject,
  createProject,
  projectName,
} from '../../../../helpers/project'
import { publishTemplate } from '../../../../helpers/templates'
import { ADMIN_EMAIL, ensureUserExists } from '../../../../helpers/users'

// OVERLEAF_TEMPLATES_USER_ID names templates@example.com, a user that is not
// an admin (services/templates-user). It manages templates, but publishes only
// projects it can read.

const templatesUser = 'templates@example.com'
const user = `user-${uuid()}@example.com`

before(function () {
  ensureUserExists(user)
  login(ADMIN_EMAIL)
  setUserPassword(templatesUser, DEFAULT_PASSWORD)
    .its('status')
    .should('equal', 200)
})

describe('templates user', function () {
  it('publishes a project of its own', function () {
    const name = projectName('TemplatesUserOwn')
    login(templatesUser)
    createProject(name).then(id => {
      publishTemplate(id, { name }).then(response => {
        expect(response.status, JSON.stringify(response.body)).to.equal(200)
      })
    })
  })

  it('cannot publish a project of another user', function () {
    login(user)
    createProject(projectName('OtherUserSource')).then(id => {
      compileProject(id).then(build => {
        login(templatesUser)
        // A page for the CSRF token, publishTemplate skips compiling here
        cy.visit('/project')
        publishTemplate(id, { name: projectName('OtherUserTpl'), build })
          .its('status')
          .should('equal', 403)
      })
    })
  })
})
