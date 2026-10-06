import { v4 as uuid } from 'uuid'
import { activateUser, DEFAULT_PASSWORD, login } from '../../../helpers/login'
import { postWithCsrf } from '../../../helpers/request'

// Walks through what a fresh toolkit deployment is used for first: create the
// admin on /launchpad, check the status page, then let the admin add a user.
// The tests depend on each other and need a fresh instance (`make setup`).

describe('launchpad', function () {
  const adminLocalPart = `admin-${uuid()}`
  const admin = `${adminLocalPart}@example.com`
  const user = `user-${uuid()}@example.com`

  describe('before the first admin exists', function () {
    beforeEach(function () {
      cy.visit('/launchpad')
    })

    it('shows the form to create the first admin', function () {
      cy.findByRole('heading', { name: 'Create the first Admin account' })
      cy.findByLabelText('Email')
      cy.findByLabelText('Password')
      cy.findByRole('button', { name: 'Register' })
    })

    it('rejects a too short password', function () {
      cy.findByLabelText('Email').type(admin)
      cy.findByLabelText('Password').type('short')
      cy.findByRole('button', { name: 'Register' }).click()
      cy.findByText('password is too short')

      cy.reload()
      cy.findByRole('heading', { name: 'Create the first Admin account' })
    })

    it('rejects a password that contains the email', function () {
      cy.findByLabelText('Email').type(admin)
      cy.findByLabelText('Password').type(`${adminLocalPart}!1`)
      cy.findByRole('button', { name: 'Register' }).click()
      cy.findByText('password contains part of email address')

      cy.reload()
      cy.findByRole('heading', { name: 'Create the first Admin account' })
    })

    it('rejects an invalid email', function () {
      // The browser blocks this in the form already, so check the server.
      postWithCsrf('/launchpad/register_admin', {
        email: 'not-an-email',
        password: DEFAULT_PASSWORD,
      }).then(response => {
        expect(response.status).to.equal(400)
        expect(response.body.message.text).to.equal('email not valid')
      })
    })

    it('rejects a request without password', function () {
      postWithCsrf('/launchpad/register_admin', { email: admin }).then(
        response => {
          expect(response.status).to.equal(400)
        }
      )
    })

    it('refuses the LDAP and SAML admin registration in local auth mode', function () {
      for (const url of [
        '/launchpad/register_ldap_admin',
        '/launchpad/register_saml_admin',
      ]) {
        postWithCsrf(url, { email: admin }).then(response => {
          expect(response.status).to.equal(403)
        })
      }
    })

    it('creates the first admin account', function () {
      cy.findByLabelText('Email').type(admin)
      cy.findByLabelText('Password').type(DEFAULT_PASSWORD)
      cy.findByRole('button', { name: 'Register' }).click()

      // The admin exists now, so /launchpad sends anonymous visitors to login.
      cy.url().should('contain', '/login')
    })
  })

  describe('after the first admin exists', function () {
    it('sends anonymous visitors to the login page', function () {
      cy.visit('/launchpad')
      cy.url().should('contain', '/login')
    })

    it('refuses to create a second admin', function () {
      cy.visit('/login')
      postWithCsrf('/launchpad/register_admin', {
        email: `second-${admin}`,
        password: DEFAULT_PASSWORD,
      }).then(response => {
        expect(response.status).to.equal(403)
        expect(response.body.message.text).to.equal(
          'admin user already exists'
        )
      })
    })

    it('shows the status checks to the admin', function () {
      login(admin)
      cy.visit('/launchpad')
      cy.findByRole('heading', { name: 'Status Checks' })
      cy.get('[data-ol-launchpad-check="websocket"]')
        .findByText('OK', { timeout: 20_000 })
        .should('be.visible')
    })

    it('links the admin to the admin panel and the project list', function () {
      login(admin)
      cy.visit('/launchpad')
      cy.findByRole('link', { name: /Start Using/ }).should(
        'have.attr',
        'href',
        '/project'
      )
      cy.findByRole('link', { name: 'Go To Admin Panel' }).click()
      cy.url().should('contain', '/admin')
    })

    it('lets the admin register a new user', function () {
      login(admin)
      cy.visit('/admin/register')
      cy.findByLabelText('Emails to register new users').type(user + '{enter}')
      cy.findByRole('cell', { name: /\/user\/activate/ }).then($td => {
        activateUser($td.text().trim())
      })

      login(user)
      cy.visit('/project')
      cy.url().should('contain', '/project')
    })

    it('keeps non-admin users out of the launchpad and admin pages', function () {
      login(user)
      cy.visit('/launchpad')
      cy.url().should('contain', '/restricted')

      cy.visit('/admin/register')
      cy.url().should('contain', '/restricted')

      cy.visit('/project')
      postWithCsrf('/launchpad/send_test_email', { email: user }).then(
        response => {
          expect(response.status).to.equal(302)
          expect(response.headers.location).to.contain('/restricted')
        }
      )
    })
  })
})
