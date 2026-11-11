import { ObjectId } from 'mongodb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import sinon from 'sinon'

vi.mock('@overleaf/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    err: vi.fn(),
  },
}))

vi.mock('../../../../app/src/Features/Chat/ChatApiHandler', () => ({
  default: {
    promises: {
      getThread: vi.fn(),
      sendComment: vi.fn(),
      resolveThread: vi.fn(),
    },
  },
}))

vi.mock('../../../../app/src/Features/Docstore/DocstoreManager', () => ({
  default: {
    promises: {
      getDoc: vi.fn(),
      updateDoc: vi.fn(),
    },
  },
}))

vi.mock('../../../../app/src/Features/User/UserGetter', () => ({
  default: {
    promises: {
      getUser: vi.fn(),
    },
  },
}))

const modulePath = '../../../../app/src/Features/Reviews/ReviewStateManager.mjs'

describe('ReviewStateManager', function () {
  let ReviewStateManager

  beforeEach(async function (ctx) {
    ctx.project = { _id: new ObjectId() }
    ctx.userId = new ObjectId().toString()
    ctx.threadId = new ObjectId().toString()
    ctx.commentText = 'section and subsection commands'
    // a doc long enough for the anchors below
    ctx.docText =
      'Your introduction is great. ' +
      'Simply use the ' +
      ctx.commentText +
      ' for structure. ' +
      'Trailing text for the insert anchor check. ' +
      'Inserted tracked change text here. More text.'
    ctx.state = {
      format: 'overleaf-comments-and-changes',
      version: 1,
      project_id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      docs: [
        {
          id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
          ranges: {
            comments: [
              {
                id: ctx.threadId,
                op: {
                  c: ctx.commentText,
                  p: ctx.docText.indexOf(ctx.commentText),
                  t: ctx.threadId,
                },
                metadata: { user_id: ctx.userId, ts: '2026-01-01T00:00:00Z' },
              },
            ],
            changes: [
              {
                id: 'cccccccccccccccccccccccc',
                op: {
                  i: 'Inserted tracked change text',
                  p: ctx.docText.indexOf('Inserted tracked change text'),
                },
                metadata: { user_id: ctx.userId, ts: '2026-01-01T00:00:00Z' },
              },
            ],
          },
        },
      ],
      threads: {
        [ctx.threadId]: {
          resolved: false,
          messages: [{ user_id: ctx.userId, content: 'A comment', timestamp: 1 }],
        },
      },
    }

    const mod = await import(modulePath)
    ReviewStateManager = mod.default
    ctx.ReviewStateManager = ReviewStateManager

    const { default: ChatApiHandler } = await import(
      '../../../../app/src/Features/Chat/ChatApiHandler'
    )
    const { default: DocstoreManager } = await import(
      '../../../../app/src/Features/Docstore/DocstoreManager'
    )
    const { default: UserGetter } = await import(
      '../../../../app/src/Features/User/UserGetter'
    )
    ChatApiHandler.promises.getThread.mockReset().mockRejectedValue(new Error('404'))
    ChatApiHandler.promises.sendComment.mockReset().mockResolvedValue({})
    ChatApiHandler.promises.resolveThread.mockReset().mockResolvedValue(undefined)
    DocstoreManager.promises.getDoc.mockReset().mockResolvedValue({
      lines: ctx.docText.split('\n'),
      version: 1,
      ranges: {},
    })
    DocstoreManager.promises.updateDoc.mockReset().mockResolvedValue({})
    UserGetter.promises.getUser.mockReset().mockResolvedValue({ _id: ctx.userId })

    ctx.ChatApiHandler = ChatApiHandler
    ctx.DocstoreManager = DocstoreManager
    ctx.UserGetter = UserGetter
  })

  describe('matchBundleDocToText', function () {
    it('matches when all anchors occur at their offsets', async function (ctx) {
      const { matchBundleDocToText } = await import(modulePath)
      expect(matchBundleDocToText(ctx.state.docs[0], ctx.docText)).to.equal(true)
    })

    it('does not match a different text', async function (ctx) {
      const { matchBundleDocToText } = await import(modulePath)
      expect(matchBundleDocToText(ctx.state.docs[0], 'completely different')).to.equal(
        false
      )
    })

    it('does not match a doc without anchors', async function (ctx) {
      const { matchBundleDocToText } = await import(modulePath)
      expect(
        matchBundleDocToText(
          { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', ranges: { comments: [], changes: [] } },
          ctx.docText
        )
      ).to.equal(false)
    })
  })

  describe('restoreReviewState', function () {
    it('re-creates the thread and writes the ranges to the matched doc', async function (ctx) {
      const report = await ctx.ReviewStateManager.promises.restoreReviewState({
        project: ctx.project,
        docs: [{ docId: 'dddddddddddddddddddddddd', text: ctx.docText }],
        state: ctx.state,
      })
      expect(report.threads[0].status).to.equal('created')
      expect(ctx.ChatApiHandler.promises.sendComment).toHaveBeenCalledWith(
        String(ctx.project._id),
        ctx.threadId,
        ctx.userId,
        'A comment'
      )
      expect(report.docs[0].status).to.equal('applied')
      expect(report.docs[0].comments).to.equal(1)
      expect(report.docs[0].changes).to.equal(1)
      const [projectId, docId, lines, version, ranges] =
        ctx.DocstoreManager.promises.updateDoc.mock.calls[0]
      expect(projectId).to.equal(String(ctx.project._id))
      expect(String(docId)).to.equal('dddddddddddddddddddddddd')
      expect(ranges.comments[0].op.t).to.equal(ctx.threadId)
    })

    it('skips threads whose message user does not exist', async function (ctx) {
      ctx.UserGetter.promises.getUser.mockRejectedValue(new Error('404'))
      const report = await ctx.ReviewStateManager.promises.restoreReviewState({
        project: ctx.project,
        docs: [{ docId: 'dddddddddddddddddddddddd', text: ctx.docText }],
        state: ctx.state,
      })
      const thread = report.threads[0]
      expect(thread.status).to.equal('skipped')
      expect(ctx.ChatApiHandler.promises.sendComment).not.toHaveBeenCalled()
      // the tracked changes are still applied, but the anchor of the skipped
      // thread is NOT written (it would be dangling in the editor)
      expect(report.docs[0].status).to.equal('applied')
      expect(report.docs[0].comments).to.equal(0)
      expect(report.docs[0].changes).to.equal(1)
      const [, , , , ranges] = ctx.DocstoreManager.promises.updateDoc.mock.calls[0]
      expect(ranges.comments).to.deep.equal([])
      expect(ranges.changes).to.have.lengthOf(1)
    })

    it('writes no dangling anchors when the user is missing and there are no tracked changes', async function (ctx) {
      ctx.UserGetter.promises.getUser.mockRejectedValue(new Error('404'))
      const state = {
        ...ctx.state,
        docs: [
          {
            ...ctx.state.docs[0],
            ranges: {
              comments: ctx.state.docs[0].ranges.comments,
              changes: [],
            },
          },
        ],
      }
      const report = await ctx.ReviewStateManager.promises.restoreReviewState({
        project: ctx.project,
        docs: [{ docId: 'dddddddddddddddddddddddd', text: ctx.docText }],
        state,
      })
      expect(report.threads[0].status).to.equal('skipped')
      expect(report.docs[0].status).to.equal('skipped')
      expect(report.docs[0].reason).to.match(/users do not exist here/)
      expect(ctx.ChatApiHandler.promises.sendComment).not.toHaveBeenCalled()
      expect(ctx.DocstoreManager.promises.updateDoc).not.toHaveBeenCalled()
    })

    it('still writes anchors of threads whose users exist when other threads are skipped', async function (ctx) {
      // thread A (ctx.threadId) author missing; thread B author present
      const threadB = new ObjectId().toString()
      const userB = new ObjectId().toString()
      ctx.UserGetter.promises.getUser
        .mockRejectedValueOnce(new Error('404')) // thread A author
        .mockResolvedValue({ _id: userB }) // thread B author
      const quoteB = 'Trailing text for the insert anchor check.'
      const state = {
        ...ctx.state,
        docs: [
          {
            ...ctx.state.docs[0],
            ranges: {
              comments: [
                ...ctx.state.docs[0].ranges.comments,
                {
                  id: threadB,
                  op: {
                    c: quoteB,
                    p: ctx.docText.indexOf(quoteB),
                    t: threadB,
                  },
                  metadata: { user_id: userB, ts: '2026-01-01T00:00:00Z' },
                },
              ],
              changes: ctx.state.docs[0].ranges.changes,
            },
          },
        ],
        threads: {
          ...ctx.state.threads,
          [threadB]: {
            resolved: false,
            messages: [{ user_id: userB, content: 'Second comment', timestamp: 2 }],
          },
        },
      }
      const report = await ctx.ReviewStateManager.promises.restoreReviewState({
        project: ctx.project,
        docs: [{ docId: 'dddddddddddddddddddddddd', text: ctx.docText }],
        state,
      })
      const statuses = Object.fromEntries(
        report.threads.map(t => [t.threadId, t.status])
      )
      expect(statuses[ctx.threadId]).to.equal('skipped')
      expect(statuses[threadB]).to.equal('created')
      // only thread B's anchor is written; the change is kept
      const [, , , , ranges] = ctx.DocstoreManager.promises.updateDoc.mock.calls[0]
      expect(ranges.comments).to.have.lengthOf(1)
      expect(ranges.comments[0].op.t).to.equal(threadB)
      expect(ranges.changes).to.have.lengthOf(1)
    })

    it('resolves a resolved thread as the original resolver', async function (ctx) {
      ctx.state.threads[ctx.threadId].resolved = true
      ctx.state.threads[ctx.threadId].resolved_by_user_id = ctx.userId
      ctx.ChatApiHandler.promises.getThread.mockResolvedValue({ messages: [] })
      await ctx.ReviewStateManager.promises.restoreReviewState({
        project: ctx.project,
        docs: [{ docId: 'dddddddddddddddddddddddd', text: ctx.docText }],
        state: ctx.state,
      })
      expect(ctx.ChatApiHandler.promises.resolveThread).toHaveBeenCalledWith(
        String(ctx.project._id),
        ctx.threadId,
        ctx.userId
      )
    })

    it('reports bundle docs that do not match any new doc', async function (ctx) {
      const report = await ctx.ReviewStateManager.promises.restoreReviewState({
        project: ctx.project,
        docs: [{ docId: 'dddddddddddddddddddddddd', text: 'totally different text' }],
        state: ctx.state,
      })
      expect(report.docs[0].status).to.equal('skipped')
      expect(ctx.DocstoreManager.promises.updateDoc).not.toHaveBeenCalled()
    })

    it('throws on an invalid bundle', async function (ctx) {
      const bad = { ...ctx.state, format: 'something-else' }
      let threw = null
      try {
        await ctx.ReviewStateManager.promises.restoreReviewState({
          project: ctx.project,
          docs: [{ docId: 'dddddddddddddddddddddddd', text: ctx.docText }],
          state: bad,
        })
      } catch (err) {
        threw = err
      }
      expect(threw).to.not.equal(null)
    })

    it('accepts live ObjectId doc ids (not only strings)', async function (ctx) {
      const newId = new ObjectId()
      const report = await ctx.ReviewStateManager.promises.restoreReviewState({
        project: { _id: new ObjectId() },
        docs: [{ docId: newId, text: ctx.docText }],
        state: ctx.state,
      })
      expect(report.docs[0].status).to.equal('applied')
      const [projectId, docId] = ctx.DocstoreManager.promises.updateDoc.mock.calls[0]
      expect(typeof docId).to.equal('string')
      expect(docId).to.equal(newId.toString())
      expect(typeof projectId).to.equal('string')
    })

    it('keeps working when the docstore lags (doc appears on a later attempt)', async function (ctx) {
      let calls = 0
      ctx.DocstoreManager.promises.getDoc.mockImplementation(async () => {
        calls++
        if (calls < 3) throw new Error('not yet')
        return { lines: ctx.docText.split('\n'), version: 2, ranges: {} }
      })
      const report = await ctx.ReviewStateManager.promises.restoreReviewState({
        project: ctx.project,
        docs: [{ docId: 'dddddddddddddddddddddddd', text: ctx.docText }],
        state: ctx.state,
      })
      expect(report.docs[0].status).to.equal('applied')
      const [, , , version] = ctx.DocstoreManager.promises.updateDoc.mock.calls[0]
      expect(version).to.equal(2)
    })
  })
})
