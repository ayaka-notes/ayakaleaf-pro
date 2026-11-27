import { beforeEach, describe, it, vi } from 'vitest'
import sinon from 'sinon'
import Settings from '@overleaf/settings'

const modulePath =
  '../../../../app/src/Features/SystemMessages/SystemMessageManager.mjs'

describe('SystemMessageManager', function () {
  beforeEach(async function (ctx) {
    ctx.messages = ['messages-stub']
    ctx.savedDocs = []
    // callable, so `new SystemMessage({...})` in createMessage works
    function FakeSystemMessage(doc) {
      Object.assign(this, doc || {})
      this.save = () => {
        ctx.savedDocs.push({
          content: this.content,
          placements: this.placements,
          unremovable: this.unremovable,
        })
        return Promise.resolve()
      }
    }
    FakeSystemMessage.find = sinon.stub().returns({
      exec: sinon.stub().resolves(ctx.messages),
    })
    FakeSystemMessage.deleteMany = sinon.stub().returns({
      exec: sinon.stub().resolves(),
    })
    ctx.SystemMessage = FakeSystemMessage

    vi.doMock('../../../../app/src/models/SystemMessage', () => ({
      SystemMessage: ctx.SystemMessage,
    }))

    ctx.SystemMessageManager = (await import(modulePath)).default
  })

  it('should look the messages up in the database on import', function (ctx) {
    sinon.assert.called(ctx.SystemMessage.find)
  })

  describe('getMessage', function () {
    beforeEach(function (ctx) {
      ctx.SystemMessageManager.promises._cachedMessages = ctx.messages
      ctx.result = ctx.SystemMessageManager.getMessages()
    })

    it('should return the messages', function (ctx) {
      ctx.result.should.equal(ctx.messages)
    })
  })

  describe('clearMessages', function () {
    beforeEach(function (ctx) {
      ctx.SystemMessage.deleteMany = sinon.stub().returns({
        exec: sinon.stub().resolves(),
      })
      ctx.SystemMessageManager.promises.clearMessages()
    })

    it('should remove the messages from the database', function (ctx) {
      ctx.SystemMessage.deleteMany.calledWith({}).should.equal(true)
    })
  })

  describe('createMessage (#17d: unremovable flag)', function () {
    it('should store the unremovable flag', async function (ctx) {
      await ctx.SystemMessageManager.promises.createMessage(
        'Emergency',
        ['auth'],
        true
      )
      ctx.savedDocs.length.should.equal(1)
      ctx.savedDocs[0].content.should.equal('Emergency')
      ctx.savedDocs[0].placements.should.deep.equal(['auth'])
      ctx.savedDocs[0].unremovable.should.equal(true)
    })

    it('should default unremovable to false', async function (ctx) {
      await ctx.SystemMessageManager.promises.createMessage('Normal')
      ctx.savedDocs.length.should.equal(1)
      ctx.savedDocs[0].unremovable.should.equal(false)
    })
  })

  describe('setMessageUnremovable (#17d)', function () {
    beforeEach(function (ctx) {
      ctx.SystemMessage.findByIdAndUpdate = sinon.stub().returns({
        exec: sinon.stub().resolves({ _id: 'abc', unremovable: true }),
      })
    })

    it('should update the flag via the model', async function (ctx) {
      const result = await ctx.SystemMessageManager.promises.setMessageUnremovable(
        'abc',
        true
      )
      ctx.SystemMessage.findByIdAndUpdate
        .calledWith('abc', { unremovable: true }, { new: true })
        .should.equal(true)
      result.unremovable.should.equal(true)
    })

    it('should 404 when the message does not exist', async function (ctx) {
      ctx.SystemMessage.findByIdAndUpdate.returns({
        exec: sinon.stub().resolves(null),
      })
      let err = null
      try {
        await ctx.SystemMessageManager.promises.setMessageUnremovable(
          'nope',
          true
        )
      } catch (e) {
        err = e
      }
      err.should.be.an.instanceOf(Error)
      err.info.statusCode.should.equal(404)
    })
  })

  describe('getMessagesForSurface (#17b: auth pages)', function () {
    beforeEach(function (ctx) {
      Settings.siteIsOpen = true
      // the manager instance is exposed as `.promises`; the default export is
      // a wrapper, so the cache must be set on the instance
      ctx.SystemMessageManager.promises._cachedMessages = [
        { content: 'legacy message', placements: [] },
        { content: 'auth only', placements: ['auth'] },
        { content: 'editor only', placements: ['editor'] },
      ]
    })

    it('should include legacy (unscoped) messages everywhere', async function (ctx) {
      const auth = (await ctx.SystemMessageManager.promises.getMessagesForSurface(
        'auth'
      )).map(m => m.content)
      const editor = (
        await ctx.SystemMessageManager.promises.getMessagesForSurface('editor')
      ).map(m => m.content)
      auth.includes('legacy message').should.equal(true)
      editor.includes('legacy message').should.equal(true)
    })

    it('should scope messages to their surface', async function (ctx) {
      const auth = (await ctx.SystemMessageManager.promises.getMessagesForSurface(
        'auth'
      )).map(m => m.content)
      const editor = (
        await ctx.SystemMessageManager.promises.getMessagesForSurface('editor')
      ).map(m => m.content)
      const hub = (
        await ctx.SystemMessageManager.promises.getMessagesForSurface('hub')
      ).map(m => m.content)
      auth.should.deep.equal(['legacy message', 'auth only'])
      editor.should.deep.equal(['legacy message', 'editor only'])
      hub.should.deep.equal(['legacy message'])
    })

    it('should serve an empty loaded cache without querying the database', async function (ctx) {
      // the manager instance is exposed as `.promises`; set the cache on it,
      // not on the default-export wrapper
      ctx.SystemMessageManager.promises._cachedMessages = []
      // the import-time background refresh already called find once
      ctx.SystemMessage.find.resetHistory()
      const auth = await ctx.SystemMessageManager.promises.getMessagesForSurface(
        'auth'
      )
      auth.should.deep.equal([])
      ctx.SystemMessage.find.called.should.equal(false)
    })
    it('should query the database when the cache was never loaded', async function (ctx) {
      ctx.SystemMessageManager.promises._cachedMessages = null
      ctx.SystemMessage.find.resetHistory()
      const auth = await ctx.SystemMessageManager.promises.getMessagesForSurface(
        'auth'
      )
      ctx.SystemMessage.find.called.should.equal(true)
      auth.should.deep.equal(['messages-stub'])
    })
    it('should prepend the protected notice for auth when the site is closed', async function (ctx) {
      Settings.siteIsOpen = false
      const auth = await ctx.SystemMessageManager.promises.getMessagesForSurface(
        'auth'
      )
      auth[0]._id.should.equal('protected')
      auth[0].content.should.include('SITE IS CLOSED')
    })
  })
})
