import { beforeEach, describe, it, vi } from 'vitest'
import sinon from 'sinon'
import MockRequest from '../helpers/MockRequest.mjs'
import MockResponse from '../helpers/MockResponse.mjs'

const modulePath =
  '../../../../app/src/Features/ServerAdmin/AdminController.mjs'

describe('AdminController', function () {
  beforeEach(async function (ctx) {
    ctx.Settings = {}
    ctx.TpdsUpdateSender = { pollDropboxForUser: sinon.stub() }
    ctx.TpdsProjectFlusher = { flushProjectToTpds: sinon.stub() }
    ctx.EditorRealTimeController = { emitToAll: sinon.stub() }
    ctx.SystemMessageManager = {
      createMessage: sinon.stub(),
      updateMessagePlacements: sinon.stub(),
      deleteMessage: sinon.stub(),
      clearMessages: sinon.stub(),
      promises: {
        getMessagesFromDB: sinon.stub().resolves([]),
        updateMessagePlacements: sinon.stub().resolves(),
        setMessageUnremovable: sinon.stub().resolves(),
      },
    }
    ctx.ProjectGetter = {
      promises: { findAllDebugProjects: sinon.stub().resolves([]) },
    }
    ctx.Modules = {
      promises: { hooks: { fire: sinon.stub().resolves([null]) } },
    }
    ctx.Features = { hasFeature: sinon.stub().returns(false) }

    vi.doMock('@overleaf/settings', () => ({ default: ctx.Settings }))
    vi.doMock(
      '../../../../app/src/Features/ThirdPartyDataStore/TpdsUpdateSender',
      () => ({ default: ctx.TpdsUpdateSender })
    )
    vi.doMock(
      '../../../../app/src/Features/ThirdPartyDataStore/TpdsProjectFlusher',
      () => ({ default: ctx.TpdsProjectFlusher })
    )
    vi.doMock(
      '../../../../app/src/Features/Editor/EditorRealTimeController',
      () => ({ default: ctx.EditorRealTimeController })
    )
    vi.doMock(
      '../../../../app/src/Features/SystemMessages/SystemMessageManager',
      () => ({ default: ctx.SystemMessageManager })
    )
    vi.doMock('../../../../app/src/Features/Project/ProjectGetter', () => ({
      default: ctx.ProjectGetter,
    }))
    vi.doMock('../../../../app/src/infrastructure/Modules', () => ({
      default: ctx.Modules,
    }))
    vi.doMock('../../../../app/src/infrastructure/Features', () => ({
      default: ctx.Features,
    }))

    ctx.controller = (await import(modulePath)).default
    ctx.req = new MockRequest(vi)
    ctx.res = new MockResponse(vi)
    ctx.res.redirect = sinon.stub()
    ctx.res.sendStatus = sinon.stub()
    ctx.res.render = sinon.stub()
    ctx.res.json = sinon.stub()
    ctx.next = sinon.stub()
  })

  describe('index', function () {
    it('should render the admin page', async function (ctx) {
      await ctx.controller.index(ctx.req, ctx.res, ctx.next)
      ctx.res.render.calledWith('admin/index').should.equal(true)
    })

    it('should include debug projects when saas is enabled', async function (ctx) {
      ctx.Features.hasFeature.returns(true)
      await ctx.controller.index(ctx.req, ctx.res, ctx.next)
      ctx.ProjectGetter.promises.findAllDebugProjects.called.should.equal(true)
      ctx.res.render
        .calledWithMatch('admin/index', {
          debugProjects: [],
        })
        .should.equal(true)
    })
  })

  describe('disconnectAllUsers', function () {
    it('should use the default delay when none is given', function (ctx) {
      ctx.req.query = {}
      ctx.controller.disconnectAllUsers(ctx.req, ctx.res)
      ctx.EditorRealTimeController.emitToAll
        .calledWith('forceDisconnect', sinon.match.string, 10)
        .should.equal(true)
      ctx.res.redirect.calledWith('/admin#open-close-editor').should.equal(true)
    })

    it('should use the given delay', function (ctx) {
      ctx.req.query = { delay: '5000' }
      ctx.controller.disconnectAllUsers(ctx.req, ctx.res)
      ctx.EditorRealTimeController.emitToAll
        .calledWith('forceDisconnect', sinon.match.string, 5000)
        .should.equal(true)
    })
  })

  describe('openEditor', function () {
    it('should open the editor and redirect', function (ctx) {
      ctx.controller.openEditor(ctx.req, ctx.res)
      ctx.Settings.editorIsOpen.should.equal(true)
      ctx.res.redirect.calledWith('/admin#open-close-editor').should.equal(true)
    })
  })

  describe('closeEditor', function () {
    it('should close the editor and redirect', function (ctx) {
      ctx.req.body = {}
      ctx.controller.closeEditor(ctx.req, ctx.res)
      Boolean(ctx.Settings.editorIsOpen).should.equal(false)
      ctx.res.redirect.calledWith('/admin#open-close-editor').should.equal(true)
    })
  })

  describe('flushProjectToTpds', function () {
    beforeEach(function (ctx) {
      // project_id is validated as a Mongo ObjectId
      ctx.projectId = '507f191e810c19729de860ea'
      ctx.req.body = { project_id: ctx.projectId }
    })

    it('should flush the project and return 200', function (ctx) {
      ctx.TpdsProjectFlusher.flushProjectToTpds.callsFake((id, cb) => cb())
      ctx.controller.flushProjectToTpds(ctx.req, ctx.res, ctx.next)
      ctx.TpdsProjectFlusher.flushProjectToTpds
        .calledWith(ctx.projectId)
        .should.equal(true)
      ctx.res.sendStatus.calledWith(200).should.equal(true)
    })

    it('should call next with an error on failure', function (ctx) {
      const error = new Error('failed')
      ctx.TpdsProjectFlusher.flushProjectToTpds.callsFake((id, cb) => cb(error))
      ctx.controller.flushProjectToTpds(ctx.req, ctx.res, ctx.next)
      ctx.next.calledWith(error).should.equal(true)
    })
  })

  describe('pollDropboxForUser', function () {
    it('should poll dropbox for the user', function (ctx) {
      // user_id is validated as a Mongo ObjectId
      ctx.userId = '507f191e810c19729de860eb'
      ctx.req.body = { user_id: ctx.userId }
      ctx.TpdsUpdateSender.pollDropboxForUser.callsFake((id, cb) => cb())
      ctx.controller.pollDropboxForUser(ctx.req, ctx.res)
      ctx.TpdsUpdateSender.pollDropboxForUser
        .calledWith(ctx.userId)
        .should.equal(true)
      ctx.res.sendStatus.calledWith(200).should.equal(true)
    })
  })

  describe('createMessage', function () {
    it('should create the message and respond 200 to the fetch client', function (ctx) {
      ctx.req.body = { content: 'a system message' }
      ctx.SystemMessageManager.createMessage.callsFake(
        (content, placements, unremovable, cb) => cb()
      )
      ctx.controller.createMessage(ctx.req, ctx.res, ctx.next)
      ctx.SystemMessageManager.createMessage
        .calledWith('a system message', undefined, false)
        .should.equal(true)
      ctx.res.sendStatus.calledWith(200).should.equal(true)
    })

    it('should pass the placements and unremovable flag through', function (ctx) {
      ctx.req.body = {
        content: 'a system message',
        placements: ['editor'],
        unremovable: true,
      }
      ctx.SystemMessageManager.createMessage.callsFake(
        (content, placements, unremovable, cb) => cb()
      )
      ctx.controller.createMessage(ctx.req, ctx.res, ctx.next)
      ctx.SystemMessageManager.createMessage
        .calledWith('a system message', ['editor'], true)
        .should.equal(true)
    })
  })

  describe('updateMessage', function () {
    it('should update the placements when sent', async function (ctx) {
      const messageId = '507f191e810c19729de860ea'
      ctx.req.params = { id: messageId }
      ctx.req.body = { placements: ['hub', 'auth'] }
      await ctx.controller.updateMessage(ctx.req, ctx.res, ctx.next)
      ctx.SystemMessageManager.promises.updateMessagePlacements
        .calledWith(messageId, ['hub', 'auth'])
        .should.equal(true)
      ctx.SystemMessageManager.promises.setMessageUnremovable.called
        .should.equal(false)
      ctx.res.sendStatus.calledWith(200).should.equal(true)
    })

    it('should toggle unremovable when sent (#17d)', async function (ctx) {
      const messageId = '507f191e810c19729de860ea'
      ctx.req.params = { id: messageId }
      ctx.req.body = { unremovable: true }
      await ctx.controller.updateMessage(ctx.req, ctx.res, ctx.next)
      ctx.SystemMessageManager.promises.setMessageUnremovable
        .calledWith(messageId, true)
        .should.equal(true)
      ctx.SystemMessageManager.promises.updateMessagePlacements.called
        .should.equal(false)
      ctx.res.sendStatus.calledWith(200).should.equal(true)
    })

    it('should apply both fields when both are sent', async function (ctx) {
      const messageId = '507f191e810c19729de860ea'
      ctx.req.params = { id: messageId }
      ctx.req.body = { placements: [], unremovable: false }
      await ctx.controller.updateMessage(ctx.req, ctx.res, ctx.next)
      ctx.SystemMessageManager.promises.updateMessagePlacements
        .calledWith(messageId, [])
        .should.equal(true)
      ctx.SystemMessageManager.promises.setMessageUnremovable
        .calledWith(messageId, false)
        .should.equal(true)
    })
  })

  describe('deleteMessage', function () {
    it('should delete the message and redirect', function (ctx) {
      const messageId = '507f191e810c19729de860eb'
      ctx.req.params = { id: messageId }
      ctx.req.body = {}
      ctx.SystemMessageManager.deleteMessage.callsFake((id, cb) => cb())
      ctx.controller.deleteMessage(ctx.req, ctx.res, ctx.next)
      ctx.SystemMessageManager.deleteMessage
        .calledWith(messageId)
        .should.equal(true)
      ctx.res.sendStatus.calledWith(200).should.equal(true)
    })
  })

  describe('getMessagesJSON', function () {
    it('should respond with the DB messages', function (ctx) {
      ctx.req.body = {}
      ctx.SystemMessageManager.getMessagesFromDB.callsFake((cb) =>
        cb(null, [{ content: 'one' }, { content: 'two' }])
      )
      ctx.controller.getMessagesJSON(ctx.req, ctx.res, ctx.next)
      ctx.res.json
        .calledWithMatch([{ content: 'one' }, { content: 'two' }])
        .should.equal(true)
    })
  })

  describe('clearMessages', function () {
    it('should clear messages and redirect to the new page', function (ctx) {
      ctx.SystemMessageManager.clearMessages.callsFake(cb => cb())
      ctx.controller.clearMessages(ctx.req, ctx.res, ctx.next)
      ctx.res.sendStatus.calledWith(200).should.equal(true)
    })
  })
})
