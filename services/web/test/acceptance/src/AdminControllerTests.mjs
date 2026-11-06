import { expect } from 'chai'
import Settings from '@overleaf/settings'
import UserHelper from './helpers/User.mjs'
import Features from '../../../app/src/infrastructure/Features.mjs'
import { expectValidationErrorRaw } from '@overleaf/validation-tools/testUtils.js'

const User = UserHelper.promises

describe('AdminController', function () {
  let admin

  beforeEach(async function () {
    admin = new User()
    await admin.login()
    await admin.ensureAdmin()
    await admin.login()
  })

  describe('GET /admin', function () {
    it('should render the admin page', async function () {
      const { response, body } = await admin.doRequest('get', {
        url: '/admin',
      })
      expect(response.statusCode).to.equal(200)
      expect(body).to.include('System Admin')
    })
  })

  describe('POST /admin/closeEditor', function () {
    before(function () {
      // only mounted in Server CE/Pro; see router.mjs
      if (Features.hasFeature('saas')) {
        this.skip()
      }
    })

    // closeEditor flips the site-wide Settings.editorIsOpen flag, which
    // gates every non-/admin route (see checkIfEditorClosed in Server.mjs);
    // reset it directly (not via an HTTP round-trip, which could itself
    // fail) so a closed site doesn't leak into whatever runs next.
    afterEach(function () {
      Settings.editorIsOpen = true
    })

    it('should reject an unexpected field with 400', async function () {
      const { response, body } = await admin.doRequest('post', {
        url: '/admin/closeEditor',
        json: { notAField: true },
      })
      expectValidationErrorRaw(
        { statusCode: response.statusCode, body },
        400,
        'notAField'
      )
    })

    it('should close the editor and redirect', async function () {
      const { response } = await admin.doRequest('post', {
        url: '/admin/closeEditor',
        json: {},
      })
      expect(response.statusCode).to.equal(302)
      expect(response.headers.location).to.equal('/admin#open-close-editor')
    })

    it('should block a non-admin route while closed, then restore access via openEditor', async function () {
      await admin.doRequest('post', { url: '/admin/closeEditor', json: {} })

      const closed = await admin.doRequest('get', {
        url: '/login',
        json: true,
      })
      expect(closed.response.statusCode).to.equal(503)
      expect(closed.body.message).to.include('maintenance')

      const { response } = await admin.doRequest('post', {
        url: '/admin/openEditor',
        json: {},
      })
      expect(response.statusCode).to.equal(302)
      expect(response.headers.location).to.equal('/admin#open-close-editor')

      const reopened = await admin.doRequest('get', {
        url: '/login',
        json: true,
      })
      expect(reopened.response.statusCode).to.equal(200)
    })
  })

  describe('POST /admin/disconnectAllUsers', function () {
    before(function () {
      // only mounted in Server CE/Pro; see router.mjs
      if (Features.hasFeature('saas')) {
        this.skip()
      }
    })

    it('should reject a non-numeric delay with 400', async function () {
      const { response, body } = await admin.doRequest('post', {
        url: '/admin/disconnectAllUsers?delay=not-a-number',
      })
      expectValidationErrorRaw(
        { statusCode: response.statusCode, body },
        400,
        'delay'
      )
    })

    it('should disconnect users and redirect', async function () {
      const { response } = await admin.doRequest('post', {
        url: '/admin/disconnectAllUsers?delay=1',
      })
      expect(response.statusCode).to.equal(302)
      expect(response.headers.location).to.equal('/admin#open-close-editor')
    })
  })

  describe('POST /admin/flushProjectToTpds', function () {
    it('should reject a malformed project_id with 400', async function () {
      const { response, body } = await admin.doRequest('post', {
        url: '/admin/flushProjectToTpds',
        json: { project_id: 'not-an-object-id' },
      })
      expectValidationErrorRaw(
        { statusCode: response.statusCode, body },
        400,
        'project_id'
      )
    })
  })

  describe('POST /admin/pollDropboxForUser', function () {
    it('should reject a malformed user_id with 400', async function () {
      const { response, body } = await admin.doRequest('post', {
        url: '/admin/pollDropboxForUser',
        json: { user_id: 'not-an-object-id' },
      })
      expectValidationErrorRaw(
        { statusCode: response.statusCode, body },
        400,
        'user_id'
      )
    })
  })

  describe('GET /admin/messages (page)', function () {
    it('should render the React admin page', async function () {
      const { response, body } = await admin.doRequest('get', {
        url: '/admin/messages',
      })
      expect(response.statusCode).to.equal(200)
      expect(body).to.include('system-messages-root')
    })
  })

  describe('POST /admin/messages', function () {
    it('should reject a missing content field with 400', async function () {
      const { response, body } = await admin.doRequest('post', {
        url: '/admin/messages',
        json: {},
      })
      expectValidationErrorRaw(
        { statusCode: response.statusCode, body },
        400,
        'content'
      )
    })

    it('should reject an unknown placement with 400', async function () {
      const { response, body } = await admin.doRequest('post', {
        url: '/admin/messages',
        json: { content: 'x', placements: ['nope'] },
      })
      expectValidationErrorRaw(
        { statusCode: response.statusCode, body },
        400,
        'placements'
      )
    })

    it('should create the message', async function () {
      const { response } = await admin.doRequest('post', {
        url: '/admin/messages',
        json: { content: 'a system message', placements: ['editor'] },
      })
      expect(response.statusCode).to.equal(200)
    })
  })

  describe('POST /admin/messages/list', function () {
    it('should list the DB messages as JSON', async function () {
      const { response, body } = await admin.doRequest('post', {
        url: '/admin/messages/list',
        json: {},
      })
      expect(response.statusCode).to.equal(200)
      expect(Array.isArray(body)).to.equal(true)
    })
  })

  describe('PATCH /admin/messages/:id', function () {
    it('should reject a malformed id with 400', async function () {
      const { response, body } = await admin.doRequest('patch', {
        url: '/admin/messages/not-an-object-id',
        json: { placements: ['hub'] },
      })
      expectValidationErrorRaw(
        { statusCode: response.statusCode, body },
        400,
        'id'
      )
    })

    it('should update the placements', async function () {
      const { body: createdList } = await admin.doRequest('post', {
        url: '/admin/messages',
        json: { content: 'placement-update-test', placements: ['editor'] },
      })
      const { body: list } = await admin.doRequest('post', {
        url: '/admin/messages/list',
        json: {},
      })
      const msg = list.find((m) => m.content === 'placement-update-test')
      expect(msg).to.not.be.undefined
      expect(msg.placements).to.deep.equal(['editor'])

      const { response } = await admin.doRequest('patch', {
        url: `/admin/messages/${msg._id}`,
        json: { placements: ['hub', 'auth'] },
      })
      expect(response.statusCode).to.equal(200)

      const { body: updatedList } = await admin.doRequest('post', {
        url: '/admin/messages/list',
        json: {},
      })
      const updated = updatedList.find((m) => m._id === msg._id)
      expect(updated.placements).to.deep.equal(['hub', 'auth'])

      // cleanup
      await admin.doRequest('delete', {
        url: `/admin/messages/${msg._id}`,
      })
    })

    it('should toggle unremovable (hide the dismiss X) (#17d)', async function () {
      await admin.doRequest('post', {
        url: '/admin/messages',
        json: { content: 'unremovable-test' },
      })
      const { body: list } = await admin.doRequest('post', {
        url: '/admin/messages/list',
        json: {},
      })
      const msg = list.find((m) => m.content === 'unremovable-test')
      expect(msg).to.not.be.undefined
      expect(msg.unremovable ?? false).to.equal(false)

      const { response } = await admin.doRequest('patch', {
        url: `/admin/messages/${msg._id}`,
        json: { unremovable: true },
      })
      expect(response.statusCode).to.equal(200)

      const { body: updatedList } = await admin.doRequest('post', {
        url: '/admin/messages/list',
        json: {},
      })
      const updated = updatedList.find((m) => m._id === msg._id)
      expect(updated.unremovable).to.equal(true)

      // cleanup
      await admin.doRequest('delete', {
        url: `/admin/messages/${msg._id}`,
      })
    })
  })

  describe('DELETE /admin/messages/:id', function () {
    it('should delete a single message', async function () {
      await admin.doRequest('post', {
        url: '/admin/messages',
        json: { content: 'delete-me-message' },
      })
      const { body: list } = await admin.doRequest('post', {
        url: '/admin/messages/list',
        json: {},
      })
      const msg = list.find((m) => m.content === 'delete-me-message')
      expect(msg).to.not.be.undefined

      const { response } = await admin.doRequest('delete', {
        url: `/admin/messages/${msg._id}`,
      })
      expect(response.statusCode).to.equal(200)

      const { body: listAfter } = await admin.doRequest('post', {
        url: '/admin/messages/list',
        json: {},
      })
      expect(listAfter.find((m) => m._id === msg._id)).to.be.undefined
    })
  })

  describe('POST /admin/messages/clear', function () {
    it('should clear messages', async function () {
      const { response } = await admin.doRequest('post', {
        url: '/admin/messages/clear',
        json: {},
      })
      expect(response.statusCode).to.equal(200)
    })
  })
})
