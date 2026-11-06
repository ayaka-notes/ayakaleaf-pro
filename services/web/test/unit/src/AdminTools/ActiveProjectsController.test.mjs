import { beforeEach, describe, it, vi } from 'vitest'
import sinon from 'sinon'

const modulePath =
  '../../../../modules/admin-tools/app/src/ActiveProjectsController.mjs'

describe('ActiveProjectsController', function () {
  beforeEach(async function (ctx) {
    ctx.clients = [
      {
        project_id: 'p1',
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
      },
      {
        project_id: 'p1',
        first_name: 'John',
        last_name: 'Roe',
        email: 'john@example.com',
      },
      {
        project_id: 'p2',
        email: 'solo@example.com',
      },
    ]

    ctx.fetchJson = sinon.stub().resolves(ctx.clients)

    ctx.ProjectGetter = {
      promises: {
        getProject: sinon.stub().callsFake(async (id) =>
          id === 'p1' ? { _id: 'p1', name: 'My Paper' } : { _id: 'p2', name: 'Solo' }
        ),
      },
    }

    ctx.SessionManager = {
      getLoggedInUserId: sinon.stub().returns('user-1'),
    }
    ctx.User = { findById: sinon.stub().resolves({ email: 'admin@example.com' }) }
    ctx.UserSettingsHelper = {
      buildUserSettings: sinon.stub().resolves({ user: { email: 'admin@example.com' } }),
    }

    vi.doMock('@overleaf/fetch-utils', () => ({
      fetchJson: ctx.fetchJson,
    }))
    vi.doMock('../../../../app/src/Features/Project/ProjectGetter', () => ({
      default: ctx.ProjectGetter,
    }))
    vi.doMock('../../../../app/src/Features/Authentication/SessionManager', () => ({
      default: ctx.SessionManager,
    }))
    vi.doMock('../../../../app/src/models/User', () => ({
      User: ctx.User,
    }))
    vi.doMock(
      '../../../../app/src/Features/Project/UserSettingsHelper',
      () => ({ default: ctx.UserSettingsHelper })
    )

    ctx.controller = (await import(modulePath)).default
    ctx.res = {
      json: sinon.stub(),
      render: sinon.stub(),
    }
    ctx.next = sinon.stub()
  })

  describe('listActiveProjects', function () {
    it('should group real-time clients by project and enrich with names', async function (ctx) {
      await ctx.controller.listActiveProjects({}, ctx.res, ctx.next)

      ctx.res.json.calledOnce.should.equal(true)
      const body = ctx.res.json.firstCall.args[0]
      body.length.should.equal(2)
      const p1 = body.find((p) => p.id === 'p1')
      p1.name.should.equal('My Paper')
      p1.connectionCount.should.equal(2)
      p1.activeUsers.should.deep.equal([
        { name: 'Jane Doe', email: 'jane@example.com' },
        { name: 'John Roe', email: 'john@example.com' },
      ])
    })

    it('should propagate real-time errors', async function (ctx) {
      ctx.fetchJson.rejects(new Error('real-time down'))
      let err = null
      try {
        await ctx.controller.listActiveProjects({}, ctx.res, ctx.next)
      } catch (e) {
        err = e
      }
      should.exist(err)
    })
  })

  describe('activeProjectsPage', function () {
    it('should render the React page with the prefetched list', async function (ctx) {
      await ctx.controller.activeProjectsPage({}, ctx.res, ctx.next)

      ctx.res.render.calledOnce.should.equal(true)
      const [view, locals] = ctx.res.render.firstCall.args
      view.should.match(/active-projects-react$/)
      locals.title.should.equal('Active Projects')
      locals.activeProjects.length.should.equal(2)
    })

    it('should still render an empty list when real-time fails', async function (ctx) {
      ctx.fetchJson.rejects(new Error('real-time down'))
      await ctx.controller.activeProjectsPage({}, ctx.res, ctx.next)

      ctx.res.render.calledOnce.should.equal(true)
      const [, locals] = ctx.res.render.firstCall.args
      locals.activeProjects.should.deep.equal([])
    })
  })
})
