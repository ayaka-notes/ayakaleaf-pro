import { beforeEach, describe, expect, it, vi } from 'vitest'
import sinon from 'sinon'
import mongodb from 'mongodb-legacy'

const { ObjectId } = mongodb

const MODULE_PATH = '../../../app/src/TokenApiAuthMiddleware.mjs'

describe('TokenApiAuthMiddleware', function () {
  beforeEach(async function (ctx) {
    ctx.userId = new ObjectId().toString()
    ctx.projectId = new ObjectId().toString()
    ctx.threadId = new ObjectId().toString()

    ctx.AuthorizationManager = {
      isRestrictedUser: sinon.stub().returns(false),
      promises: {
        getPrivilegeLevelForProject: sinon.stub(),
      },
    }
    ctx.otherUserId = new ObjectId().toString()
    // Chat returns user ids as strings.
    ctx.thread = { messages: [{ user_id: ctx.userId, content: 'hi' }] }
    ctx.ChatApiHandler = {
      promises: {
        getThread: sinon.stub().callsFake(async () => ctx.thread),
      },
    }
    ctx.CollaboratorsGetter = {
      promises: {
        userIsTokenMember: sinon.stub().resolves(false),
        isUserInvitedMemberOfProject: sinon.stub().resolves(true),
      },
    }
    // verifyToken returns the token document, which the middleware checks
    // for type and scope.
    ctx.PersonalAccessTokenManager = {
      verifyToken: sinon
        .stub()
        .resolves({
          type: 'personal_access_token',
          scope: 'git_bridge',
          user_id: ctx.userId,
        }),
    }

    vi.doMock(
      '../../../../../app/src/Features/Authorization/AuthorizationManager.mjs',
      () => ({ default: ctx.AuthorizationManager })
    )
    vi.doMock(
      '../../../../../app/src/Features/Collaborators/CollaboratorsGetter.mjs',
      () => ({ default: ctx.CollaboratorsGetter })
    )
    vi.doMock('../../../../../app/src/Features/Chat/ChatApiHandler.mjs', () => ({
      default: ctx.ChatApiHandler,
    }))
    vi.doMock(
      '../../../../oauth2-server/app/src/OAuthPersonalAccessTokenManager.mjs',
      () => ({ default: ctx.PersonalAccessTokenManager })
    )

    const mod = await import(MODULE_PATH)
    ctx.tokenProjectAccess = mod.default
    ctx.tokenThreadResolveAccess = mod.tokenThreadResolveAccess

    ctx.req = {
      headers: { authorization: 'Bearer olp_test' },
      params: { project_id: ctx.projectId, thread_id: ctx.threadId },
      path: '/api/v1/project/x',
      method: 'POST',
    }
    ctx.res = {
      statusCode: 200,
      set: sinon.stub(),
      on: sinon.stub(),
      status: sinon.stub().callsFake(code => {
        ctx.res.statusCode = code
        return ctx.res
      }),
      json: sinon.stub(),
    }
    ctx.next = sinon.stub()

    ctx.setLevel = level =>
      ctx.AuthorizationManager.promises.getPrivilegeLevelForProject.resolves(
        level
      )
    ctx.expectAllowed = () => {
      expect(ctx.next.calledOnceWithExactly()).to.equal(true)
      expect(ctx.res.status.called).to.equal(false)
    }
    ctx.expectForbidden = () => {
      expect(ctx.next.called).to.equal(false)
      expect(ctx.res.statusCode).to.equal(403)
      expect(ctx.res.json.calledWith({ error: 'forbidden' })).to.equal(true)
    }

    // Runs both middlewares as the resolve route does.
    ctx.resolveRoute = async () => {
      await ctx.tokenProjectAccess(ctx.req, ctx.res, ctx.next)
      if (ctx.next.calledOnceWithExactly()) {
        ctx.next.resetHistory()
        await ctx.tokenThreadResolveAccess(ctx.req, ctx.res, ctx.next)
      }
    }
  })

  describe('restricted user', function () {
    beforeEach(function (ctx) {
      ctx.setLevel('readOnly')
      ctx.CollaboratorsGetter.promises.userIsTokenMember.resolves(true)
      ctx.CollaboratorsGetter.promises.isUserInvitedMemberOfProject.resolves(
        false
      )
      ctx.AuthorizationManager.isRestrictedUser.returns(true)
    })

    it('answers 404 like a non-member', async function (ctx) {
      await ctx.resolveRoute()
      expect(ctx.next.called).to.equal(false)
      expect(ctx.res.statusCode).to.equal(404)
      expect(ctx.res.json.calledWith({ error: 'not found' })).to.equal(true)
      expect(
        ctx.AuthorizationManager.isRestrictedUser.calledWith(
          ctx.userId,
          'readOnly',
          true,
          false
        )
      ).to.equal(true)
    })
  })

  describe('invited read-only member', function () {
    beforeEach(function (ctx) {
      ctx.setLevel('readOnly')
    })

    it('may read', async function (ctx) {
      await ctx.tokenProjectAccess(ctx.req, ctx.res, ctx.next)
      ctx.expectAllowed()
      expect(ctx.req.tokenUserId).to.equal(ctx.userId)
    })

    it('gets 403 on resolve, even on a thread they started', async function (ctx) {
      await ctx.resolveRoute()
      ctx.expectForbidden()
    })
  })

  for (const level of ['owner', 'readAndWrite']) {
    describe(level, function () {
      it("may resolve someone else's thread", async function (ctx) {
        ctx.setLevel(level)
        ctx.thread.messages[0].user_id = ctx.otherUserId
        await ctx.resolveRoute()
        ctx.expectAllowed()
      })
    })
  }

  describe('reviewer', function () {
    beforeEach(function (ctx) {
      ctx.setLevel('review')
    })

    it('may resolve a thread they started', async function (ctx) {
      await ctx.resolveRoute()
      ctx.expectAllowed()
      expect(
        ctx.ChatApiHandler.promises.getThread.calledWith(
          ctx.projectId,
          ctx.threadId
        )
      ).to.equal(true)
    })

    it('may resolve their own thread when the token store holds an ObjectId', async function (ctx) {
      ctx.PersonalAccessTokenManager.verifyToken.resolves({
        type: 'personal_access_token',
        scope: 'git_bridge',
        user_id: new ObjectId(ctx.userId),
      })
      await ctx.resolveRoute()
      ctx.expectAllowed()
    })

    it("gets 403 on someone else's thread", async function (ctx) {
      ctx.thread.messages[0].user_id = ctx.otherUserId
      await ctx.resolveRoute()
      ctx.expectForbidden()
    })

    it('gets 403 when they only replied to the thread', async function (ctx) {
      ctx.thread.messages = [
        { user_id: ctx.otherUserId, content: 'first' },
        { user_id: ctx.userId, content: 'reply' },
      ]
      await ctx.resolveRoute()
      ctx.expectForbidden()
    })

    it('gets 403 on a thread without messages', async function (ctx) {
      ctx.thread.messages = []
      await ctx.resolveRoute()
      ctx.expectForbidden()
    })

    it('gets 403 when chat does not know the thread', async function (ctx) {
      ctx.ChatApiHandler.promises.getThread.rejects(new Error('not found'))
      await ctx.resolveRoute()
      ctx.expectForbidden()
    })

    it("gets 403 on someone else's thread as a site admin", async function (ctx) {
      // Core would answer owner for a site admin; the middleware asks with
      // ignoreSiteAdmin and so sees the membership level.
      ctx.AuthorizationManager.promises.getPrivilegeLevelForProject.callsFake(
        async (userId, projectId, token, opts) =>
          opts?.ignoreSiteAdmin ? 'review' : 'owner'
      )
      ctx.thread.messages[0].user_id = ctx.otherUserId
      await ctx.resolveRoute()
      ctx.expectForbidden()
    })
  })

  describe('token scope', function () {
    it('rejects tokens that are not personal access tokens', async function (ctx) {
      ctx.PersonalAccessTokenManager.verifyToken.resolves({
        type: 'access_token',
        scope: 'git_bridge',
        user_id: ctx.userId,
      })
      await ctx.tokenProjectAccess(ctx.req, ctx.res, ctx.next)
      expect(ctx.next.called).to.equal(false)
      expect(ctx.res.statusCode).to.equal(401)
    })

    it('rejects personal access tokens without the git_bridge scope', async function (ctx) {
      ctx.PersonalAccessTokenManager.verifyToken.resolves({
        type: 'personal_access_token',
        scope: 'github-sync',
        user_id: ctx.userId,
      })
      await ctx.tokenProjectAccess(ctx.req, ctx.res, ctx.next)
      expect(ctx.next.called).to.equal(false)
      expect(ctx.res.statusCode).to.equal(401)
    })

    it('rejects invalid tokens', async function (ctx) {
      ctx.PersonalAccessTokenManager.verifyToken.resolves(null)
      await ctx.tokenProjectAccess(ctx.req, ctx.res, ctx.next)
      expect(ctx.next.called).to.equal(false)
      expect(ctx.res.statusCode).to.equal(401)
    })
  })
})
