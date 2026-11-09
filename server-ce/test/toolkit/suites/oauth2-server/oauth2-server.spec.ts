import { v4 as uuid } from 'uuid'
import {
  adminUserInfo,
  setSuspended,
  setUserFeatures,
  visitWithFeatures,
} from '../../../helpers/adminTools'
import { login } from '../../../helpers/login'
import { expectOwnAuditEntry } from '../../../helpers/auditLog'
import { postWithCsrf, requestWithCsrf } from '../../../helpers/request'
import { ADMIN_EMAIL, ensureUserExists } from '../../../helpers/users'

// oauth2-server module: the personal access tokens ("Git authentication
// tokens") of the account settings, and /oauth/token/info, the public API
// endpoint git-bridge validates them with. The settings only show the widget
// when git-bridge is enabled, see overleaf.rc.

const owner = `owner-${uuid()}@example.com`
const other = `other-${uuid()}@example.com`
const collector = `collector-${uuid()}@example.com`

const TOKEN_LIMIT = 10
const DAY = 24 * 60 * 60 * 1000

type ListedToken = {
  _id: string
  accessTokenPartial: string
  createdAt: string
  accessTokenExpiresAt: string
  lastUsedAt?: string | null
}

before(function () {
  for (const email of [owner, other, collector]) {
    ensureUserExists(email)
  }
})

// The page whose CSRF token the API requests below send
function visitSettings() {
  cy.visit('/user/settings')
  cy.findByRole('heading', { name: 'Git integration' })
}

function createToken(): Cypress.Chainable<string> {
  return postWithCsrf('/oauth/personal-access-tokens', {}).then(response => {
    expect(response.status).to.equal(200)
    return response.body.accessToken as string
  })
}

function listTokens(): Cypress.Chainable<ListedToken[]> {
  return cy
    .request('/oauth/personal-access-tokens')
    .then(response => response.body as ListedToken[])
}

function deleteToken(tokenId: string) {
  return requestWithCsrf('DELETE', `/oauth/personal-access-tokens/${tokenId}`)
}

function tokenInfo(authorization?: string) {
  return cy.request({
    url: '/oauth/token/info',
    headers: authorization ? { Authorization: authorization } : {},
    failOnStatusCode: false,
  })
}

// Deletes every token of the logged in user, so each test starts empty.
function deleteAllTokens() {
  listTokens().then(tokens => {
    for (const token of tokens) {
      deleteToken(token._id).its('status').should('equal', 200)
    }
  })
}

// The date format of the token table, moment's 'Do MMM YYYY'
function formatDate(date: Date) {
  const day = date.getDate()
  const suffix =
    day % 10 === 1 && day !== 11
      ? 'st'
      : day % 10 === 2 && day !== 12
        ? 'nd'
        : day % 10 === 3 && day !== 13
          ? 'rd'
          : 'th'
  const month = date.toLocaleString('en-US', { month: 'short' })
  return `${day}${suffix} ${month} ${date.getFullYear()}`
}

function tokenRow(token: string) {
  return cy.contains('.row', `${token.slice(0, 8)}************`)
}

describe('git authentication tokens in the account settings', function () {
  beforeEach(function () {
    login(owner)
    visitSettings()
    deleteAllTokens()
    cy.reload()
  })

  it('explains the tokens and offers to generate the first one', function () {
    cy.findByRole('heading', { name: 'Your Git authentication tokens' })
    cy.findByRole('button', { name: 'Generate token' })
    cy.findByRole('button', { name: 'Add another token' }).should('not.exist')
    // No table without tokens
    cy.findByText('Created at').should('not.exist')
  })

  it('tells about a created and a deleted token on the audit log', function () {
    createToken()
    deleteAllTokens()
    login(ADMIN_EMAIL)
    expectOwnAuditEntry(owner, 'create-git-token')
    expectOwnAuditEntry(owner, 'delete-git-token')
  })

  it('shows a new token once, then only its start with its dates', function () {
    cy.findByRole('button', { name: 'Generate token' }).click()
    cy.findByRole('dialog').within(() => {
      cy.findByText('Git authentication token')
      cy.findByText(
        'This is your Git authentication token. You should enter this when prompted for a password.'
      )
    })
    cy.findByRole('dialog')
      .find('code')
      .invoke('text')
      .then(token => {
        expect(token).to.match(/^olp_[a-zA-Z0-9]{36}$/)
        // The header close button is called Close too, use the footer one
        cy.findByRole('dialog')
          .findAllByRole('button', { name: 'Close' })
          .last()
          .click()
        cy.findByRole('dialog').should('not.exist')

        cy.findByText('Created at')
        cy.findByText('Last used')
        cy.findByText('Expires')
        cy.contains(token).should('not.exist')

        const today = new Date()
        const nextYear = new Date(today)
        nextYear.setFullYear(today.getFullYear() + 1)
        tokenRow(token).within(() => {
          cy.findAllByText(formatDate(today)).should('have.length', 1)
          cy.findByText(formatDate(nextYear))
          cy.findByText('N/A')
        })
      })
    cy.findByRole('button', { name: 'Generate token' }).should('not.exist')
    cy.findByRole('button', { name: 'Add another token' })
  })

  it('adds more tokens, newest first', function () {
    cy.findByRole('button', { name: 'Generate token' }).click()
    cy.findByRole('dialog')
      .find('code')
      .invoke('text')
      .then(first => {
        cy.findByRole('dialog')
          .findAllByRole('button', { name: 'Close' })
          .last()
          .click()
        cy.findByRole('button', { name: 'Add another token' }).click()
        cy.findByRole('dialog')
          .find('code')
          .invoke('text')
          .then(second => {
            expect(second).not.to.equal(first)
            cy.findByRole('dialog')
              .findAllByRole('button', { name: 'Close' })
              .last()
              .click()
            cy.get('.linking-git-bridge-revoke-button').should('have.length', 2)
            cy.get('.row')
              .filter(`:contains("************")`)
              .first()
              .should('contain', second.slice(0, 8))
          })
      })
  })

  it('keeps the token when deleting is cancelled', function () {
    createToken().then(token => {
      cy.reload()
      tokenRow(token).find('.linking-git-bridge-revoke-button').click()
      cy.findByRole('dialog').within(() => {
        cy.findByText('Delete Authentication token')
        cy.findByText(/You’re about to delete a Git authentication token/)
        cy.findByRole('button', { name: 'Cancel' }).click()
      })
      cy.findByRole('dialog').should('not.exist')
      tokenRow(token).should('exist')
      tokenInfo(`Bearer ${token}`).its('status').should('equal', 200)
    })
  })

  it('deletes a token, which then no longer authenticates', function () {
    createToken().then(token => {
      createToken().then(kept => {
        cy.reload()
        tokenRow(token).find('.linking-git-bridge-revoke-button').click()
        cy.findByRole('dialog')
          .findByRole('button', { name: 'Delete' })
          .click()
        cy.findByRole('dialog').should('not.exist')
        tokenRow(token).should('not.exist')
        tokenRow(kept).should('exist')
        tokenInfo(`Bearer ${token}`).its('status').should('equal', 401)
        tokenInfo(`Bearer ${kept}`).its('status').should('equal', 200)
      })
    })
  })

  it('shows when a token was last used', function () {
    createToken().then(token => {
      tokenInfo(`Bearer ${token}`).its('status').should('equal', 200)
      cy.reload()
      tokenRow(token).within(() => {
        cy.findByText('N/A').should('not.exist')
        // Created and last used today
        cy.findAllByText(formatDate(new Date())).should('have.length', 2)
      })
    })
  })
})

describe('token limit', function () {
  it(`stops at ${TOKEN_LIMIT} tokens until one is deleted`, function () {
    login(collector)
    visitSettings()
    deleteAllTokens()
    for (let i = 0; i < TOKEN_LIMIT; i++) {
      createToken()
    }
    postWithCsrf('/oauth/personal-access-tokens', {}).then(response => {
      expect(response.status).to.equal(400)
      expect(response.body.message).to.equal(
        'Personal access token count limit reached'
      )
    })
    listTokens().should('have.length', TOKEN_LIMIT)

    cy.reload()
    cy.findByText(/You’ve reached the 10 token limit/)
    cy.findByRole('button', { name: 'Add another token' }).should('not.exist')
    cy.findByRole('button', { name: 'Generate token' }).should('not.exist')

    cy.get('.linking-git-bridge-revoke-button').first().click()
    cy.findByRole('dialog').findByRole('button', { name: 'Delete' }).click()
    cy.findByRole('dialog').should('not.exist')
    cy.findByText(/You’ve reached the 10 token limit/).should('not.exist')
    cy.findByRole('button', { name: 'Add another token' })
    createToken()
  })
})

describe('personal access token API', function () {
  it('creates tokens that expire in a year', function () {
    login(owner)
    visitSettings()
    deleteAllTokens()
    const before = Date.now()
    createToken().then(token => {
      listTokens().then(tokens => {
        expect(tokens).to.have.length(1)
        const [listed] = tokens
        expect(listed.accessTokenPartial).to.equal(token.slice(0, 8))
        const createdAt = new Date(listed.createdAt).getTime()
        const expiresAt = new Date(listed.accessTokenExpiresAt).getTime()
        expect(createdAt, 'createdAt').to.be.within(before - DAY, Date.now() + DAY)
        expect(expiresAt - createdAt, 'validity').to.be.within(
          365 * DAY,
          366 * DAY
        )
      })
    })
  })

  it('never lists the secret', function () {
    login(owner)
    visitSettings()
    createToken().then(token => {
      cy.request('/oauth/personal-access-tokens').then(response => {
        const body = JSON.stringify(response.body)
        expect(body).not.to.contain(token)
        for (const listed of response.body as Record<string, unknown>[]) {
          expect(listed).not.to.have.property('accessToken')
        }
      })
    })
  })

  it('reports a valid token to git-bridge', function () {
    login(owner)
    visitSettings()
    createToken().then(token => {
      cy.clearAllCookies()
      tokenInfo(`Bearer ${token}`).then(response => {
        expect(response.status).to.equal(200)
        expect(response.body.accessToken).to.equal(token)
        expect(response.body.scope).to.equal('git_bridge')
        expect(
          new Date(response.body.accessTokenExpiresAt).getTime()
        ).to.be.greaterThan(Date.now())
      })
    })
  })

  it('rejects missing, malformed and unknown tokens', function () {
    tokenInfo().then(response => {
      expect(response.status).to.equal(401)
      expect(response.body.error).to.equal('Unauthorized')
    })
    login(owner)
    visitSettings()
    createToken().then(token => {
      cy.clearAllCookies()
      // The token has to come as a bearer token
      tokenInfo(token).its('status').should('equal', 401)
      tokenInfo(`Basic ${btoa(`git:${token}`)}`)
        .its('status')
        .should('equal', 401)
    })
    tokenInfo(`Bearer olp_${'x'.repeat(36)}`)
      .its('status')
      .should('equal', 401)
  })

  it('needs a login to manage tokens', function () {
    cy.clearAllCookies()
    cy.request({
      url: '/oauth/personal-access-tokens',
      headers: { Accept: 'application/json' },
      failOnStatusCode: false,
      followRedirect: false,
    })
      .its('status')
      .should('equal', 401)
    cy.request({
      method: 'POST',
      url: '/oauth/personal-access-tokens',
      headers: { Accept: 'application/json' },
      failOnStatusCode: false,
      followRedirect: false,
    })
      .its('status')
      .should('be.oneOf', [401, 403])
  })

  it("keeps every user's tokens to themselves", function () {
    login(owner)
    visitSettings()
    createToken().then(token => {
      listTokens().then(tokens => {
        const tokenId = tokens.find(
          t => t.accessTokenPartial === token.slice(0, 8)
        )!._id

        login(other)
        visitSettings()
        listTokens().then(otherTokens => {
          expect(otherTokens.map(t => t._id)).not.to.include(tokenId)
        })
        deleteToken(tokenId).then(response => {
          expect(response.status).to.equal(404)
          expect(response.body.message).to.equal('Token not found')
        })
        tokenInfo(`Bearer ${token}`).its('status').should('equal', 200)
      })
    })
  })

  it('answers 404 for unknown token ids', function () {
    login(owner)
    visitSettings()
    deleteToken('000000000000000000000000').its('status').should('equal', 404)
    deleteToken('not-an-id').its('status').should('equal', 404)
  })
})

describe('tokens of disabled and deleted accounts', function () {
  // A new user with a token that git-bridge accepts
  function userWithToken(email: string): Cypress.Chainable<string> {
    ensureUserExists(email)
    login(email)
    visitSettings()
    return createToken().then(token => {
      cy.clearAllCookies()
      return tokenInfo(`Bearer ${token}`)
        .its('status')
        .should('equal', 200)
        .then(() => token)
    })
  }

  it('refuses the tokens while the account is disabled', function () {
    const email = `disabled-${uuid()}@example.com`
    userWithToken(email).then(token => {
      login(ADMIN_EMAIL)
      setSuspended(email, true)
      cy.clearAllCookies()
      tokenInfo(`Bearer ${token}`).its('status').should('equal', 401)

      login(ADMIN_EMAIL)
      setSuspended(email, false)
      cy.clearAllCookies()
      tokenInfo(`Bearer ${token}`).its('status').should('equal', 200)
    })
  })

  it('refuses the tokens of a deleted account', function () {
    const email = `deleted-${uuid()}@example.com`
    userWithToken(email).then(token => {
      login(ADMIN_EMAIL)
      adminUserInfo(email).then(user => {
        postWithCsrf(`/admin/user/${user.id}/delete`, {
          sendEmail: false,
          toUserId: null,
        })
          .its('status')
          .should('equal', 200)
      })
      cy.clearAllCookies()
      tokenInfo(`Bearer ${token}`).its('status').should('equal', 401)
    })
  })
})

describe('tokens with git access turned off', function () {
  it('hides them and makes no new ones, and still deletes the old, until it is on again', function () {
    const email = `git-off-${uuid()}@example.com`
    ensureUserExists(email)
    login(email)
    visitSettings()
    createToken()

    login(ADMIN_EMAIL)
    setUserFeatures(email, { gitBridge: false })

    login(email)
    visitWithFeatures('/user/settings')
    cy.findByRole('heading', { name: 'Change password' }).should('exist')
    cy.findByRole('heading', { name: 'Git integration' }).should('not.exist')
    postWithCsrf('/oauth/personal-access-tokens', {})
      .its('status')
      .should('equal', 403)
    deleteAllTokens()
    listTokens().should('have.length', 0)

    login(ADMIN_EMAIL)
    setUserFeatures(email, { gitBridge: true })

    login(email)
    visitSettings()
    createToken()
  })
})
