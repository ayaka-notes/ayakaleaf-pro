import { beforeEach, describe, expect, it, vi } from 'vitest'
// TODO: This file was created by bulk-decaffeinate.
// Fix any style issues and re-enable lint.
/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS201: Simplify complex destructure assignments
 * DS205: Consider reworking code to avoid use of IIFEs
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
import sinon from 'sinon'
import { EventEmitter } from 'node:events'
const modulePath =
  '../../../../app/src/Features/Downloads/ProjectZipStreamManager.mjs'

describe('ProjectZipStreamManager', function () {
  beforeEach(async function (ctx) {
    ctx.project_id = 'project-id-123'
    ctx.callback = sinon.stub()
    ctx.archive = {
      on() {},
      append: sinon.stub(),
    }
    ctx.logger = {
      error: sinon.stub(),
      info: sinon.stub(),
      debug: sinon.stub(),
    }

    vi.doMock('archiver', () => ({
      default: (ctx.archiver = sinon.stub().returns(ctx.archive)),
    }))

    vi.doMock('@overleaf/logger', () => ({
      default: ctx.logger,
    }))

    vi.doMock(
      '../../../../app/src/Features/Project/ProjectEntityHandler',
      () => ({
        default: (ctx.ProjectEntityHandler = {}),
      })
    )

    vi.doMock(
      '../../../../app/src/Features/History/HistoryManager.mjs',
      () => ({
        default: (ctx.HistoryManager = {
          flushProject: sinon.stub().yields(null),
        }),
      })
    )

    vi.doMock('../../../../app/src/Features/Project/ProjectGetter', () => ({
      default: (ctx.ProjectGetter = {}),
    }))

    vi.doMock(
      '../../../../app/src/Features/FileStore/FileStoreHandler',
      () => ({
        default: (ctx.FileStoreHandler = {}),
      })
    )

    ctx.DocstoreManager = {
      promises: {
        getAllDocsWithRanges: sinon
          .stub()
          .resolves([{ _id: 'doc-1', lines: ['hello'], ranges: {} }]),
      },
    }
    ctx.ChatApiHandler = {
      promises: {
        getThreads: sinon.stub().resolves({}),
      },
    }
    vi.doMock(
      '../../../../app/src/Features/Docstore/DocstoreManager.mjs',
      () => ({ default: ctx.DocstoreManager })
    )
    vi.doMock(
      '../../../../app/src/Features/Chat/ChatApiHandler.mjs',
      () => ({ default: ctx.ChatApiHandler })
    )

    ctx.ProjectZipStreamManager = (await import(modulePath)).default
  })

  describe('createZipStreamForMultipleProjects', function () {
    describe('successfully', function () {
      beforeEach(async function (ctx) {
        await new Promise(resolve => {
          ctx.project_ids = ['project-1', 'project-2']
          ctx.zip_streams = {
            'project-1': new EventEmitter(),
            'project-2': new EventEmitter(),
          }

          ctx.project_names = {
            'project-1': 'Project One Name',
            'project-2': 'Project Two Name',
          }

          ctx.ProjectZipStreamManager.createZipStreamForProject = (
            projectId,
            zipFromHistory,
            historyId,
            callback
          ) => {
            callback(null, ctx.zip_streams[projectId])
            setTimeout(() => {
              return ctx.zip_streams[projectId].emit('end')
            })
            return 0
          }
          sinon.spy(ctx.ProjectZipStreamManager, 'createZipStreamForProject')

          ctx.ProjectGetter.getProject = (projectId, fields, callback) => {
            return callback(null, {
              name: ctx.project_names[projectId],
              overleaf: { history: { id: 123 } },
            })
          }
          sinon.spy(ctx.ProjectGetter, 'getProject')

          ctx.ProjectZipStreamManager.createZipStreamForMultipleProjects(
            ctx.project_ids,
            false,
            (...args) => {
              return ctx.callback(...Array.from(args || []))
            }
          )

          return (ctx.archive.finalize = () => resolve())
        })
      })

      it('should create a zip archive', function (ctx) {
        return ctx.archiver.calledWith('zip').should.equal(true)
      })

      it('should return a stream before any processing is done', function (ctx) {
        ctx.callback
          .calledWith(sinon.match.falsy, ctx.archive)
          .should.equal(true)
        return ctx.callback
          .calledBefore(ctx.ProjectZipStreamManager.createZipStreamForProject)
          .should.equal(true)
      })

      it('should get a zip stream for all of the projects', function (ctx) {
        return Array.from(ctx.project_ids).map(projectId =>
          ctx.ProjectZipStreamManager.createZipStreamForProject
            .calledWith(projectId)
            .should.equal(true)
        )
      })

      it('should get the names of each project', function (ctx) {
        return Array.from(ctx.project_ids).map(projectId =>
          ctx.ProjectGetter.getProject
            .calledWith(projectId, { name: true, 'overleaf.history.id': true })
            .should.equal(true)
        )
      })

      it('should add all of the projects to the zip', function (ctx) {
        return Array.from(ctx.project_ids).map(projectId =>
          ctx.archive.append
            .calledWith(ctx.zip_streams[projectId], {
              name: ctx.project_names[projectId] + '.zip',
            })
            .should.equal(true)
        )
      })
    })

    describe('with a project not existing', function () {
      beforeEach(async function (ctx) {
        await new Promise(resolve => {
          ctx.project_ids = ['project-1', 'wrong-id']
          ctx.project_names = {
            'project-1': 'Project One Name',
          }
          ctx.zip_streams = {
            'project-1': new EventEmitter(),
          }

          ctx.ProjectZipStreamManager.createZipStreamForProject = (
            projectId,
            zipFromHistory,
            historyId,
            callback
          ) => {
            callback(null, ctx.zip_streams[projectId])
            setTimeout(() => {
              ctx.zip_streams[projectId].emit('end')
            })
          }
          sinon.spy(ctx.ProjectZipStreamManager, 'createZipStreamForProject')

          ctx.ProjectGetter.getProject = (projectId, fields, callback) => {
            const name = ctx.project_names[projectId]
            callback(
              null,
              name ? { name, overleaf: { history: { id: 123 } } } : undefined
            )
          }
          sinon.spy(ctx.ProjectGetter, 'getProject')

          ctx.ProjectZipStreamManager.createZipStreamForMultipleProjects(
            ctx.project_ids,
            false,
            ctx.callback
          )

          ctx.archive.finalize = () => resolve()
        })
      })

      it('should create a zip archive', function (ctx) {
        ctx.archiver.calledWith('zip').should.equal(true)
      })

      it('should return a stream before any processing is done', function (ctx) {
        ctx.callback
          .calledWith(sinon.match.falsy, ctx.archive)
          .should.equal(true)
        ctx.callback
          .calledBefore(ctx.ProjectZipStreamManager.createZipStreamForProject)
          .should.equal(true)
      })

      it('should get the names of each project', function (ctx) {
        ctx.project_ids.map(projectId =>
          ctx.ProjectGetter.getProject
            .calledWith(projectId, { name: true, 'overleaf.history.id': true })
            .should.equal(true)
        )
      })

      it('should get a zip stream only for the existing project', function (ctx) {
        ctx.ProjectZipStreamManager.createZipStreamForProject
          .calledWith('project-1')
          .should.equal(true)
        ctx.ProjectZipStreamManager.createZipStreamForProject
          .calledWith('wrong-id')
          .should.equal(false)
      })

      it('should only add the existing project to the zip', function (ctx) {
        sinon.assert.calledOnce(ctx.archive.append)
        ctx.archive.append
          .calledWith(ctx.zip_streams['project-1'], {
            name: ctx.project_names['project-1'] + '.zip',
          })
          .should.equal(true)
      })
    })
  })

  describe('createZipStreamForProject', function () {
    describe('successfully', function () {
      beforeEach(function (ctx) {
        ctx.ProjectZipStreamManager.addAllDocsToArchive = sinon
          .stub()
          .callsArg(2)
        ctx.ProjectZipStreamManager.addAllFilesToArchive = sinon
          .stub()
          .callsArg(2)
        ctx.archive.finalize = sinon.stub()
        return ctx.ProjectZipStreamManager.createZipStreamForProject(
          ctx.project_id,
          false,
          123,
          ctx.callback
        )
      })

      it('should create a zip archive', function (ctx) {
        return ctx.archiver.calledWith('zip').should.equal(true)
      })

      it('should return a stream before any processing is done', function (ctx) {
        ctx.callback
          .calledWith(sinon.match.falsy, ctx.archive)
          .should.equal(true)
        ctx.callback
          .calledBefore(ctx.ProjectZipStreamManager.addAllDocsToArchive)
          .should.equal(true)
        return ctx.callback
          .calledBefore(ctx.ProjectZipStreamManager.addAllFilesToArchive)
          .should.equal(true)
      })

      it('should add all of the project docs to the zip', function (ctx) {
        return ctx.ProjectZipStreamManager.addAllDocsToArchive
          .calledWith(ctx.project_id, ctx.archive)
          .should.equal(true)
      })

      it('should add all of the project files to the zip', function (ctx) {
        return ctx.ProjectZipStreamManager.addAllFilesToArchive
          .calledWith(ctx.project_id, ctx.archive)
          .should.equal(true)
      })

      it('should finalise the stream', function (ctx) {
        return ctx.archive.finalize.called.should.equal(true)
      })
    })

    describe('with an error adding docs', function () {
      beforeEach(function (ctx) {
        ctx.ProjectZipStreamManager.addAllDocsToArchive = sinon
          .stub()
          .callsArgWith(2, new Error('something went wrong'))
        ctx.ProjectZipStreamManager.addAllFilesToArchive = sinon
          .stub()
          .callsArg(2)
        ctx.archive.finalize = sinon.stub()
        ctx.ProjectZipStreamManager.createZipStreamForProject(
          ctx.project_id,
          false,
          123,
          ctx.callback
        )
      })

      it('should log out an error', function (ctx) {
        return ctx.logger.error
          .calledWith(sinon.match.any, 'error adding docs to zip stream')
          .should.equal(true)
      })

      it('should continue with the process', function (ctx) {
        ctx.ProjectZipStreamManager.addAllDocsToArchive.called.should.equal(
          true
        )
        ctx.ProjectZipStreamManager.addAllFilesToArchive.called.should.equal(
          true
        )
        return ctx.archive.finalize.called.should.equal(true)
      })
    })

    describe('with an error adding files', function () {
      beforeEach(function (ctx) {
        ctx.ProjectZipStreamManager.addAllDocsToArchive = sinon
          .stub()
          .callsArg(2)
        ctx.ProjectZipStreamManager.addAllFilesToArchive = sinon
          .stub()
          .callsArgWith(2, new Error('something went wrong'))
        ctx.archive.finalize = sinon.stub()
        return ctx.ProjectZipStreamManager.createZipStreamForProject(
          ctx.project_id,
          false,
          123,
          ctx.callback
        )
      })

      it('should log out an error', function (ctx) {
        return ctx.logger.error
          .calledWith(sinon.match.any, 'error adding files to zip stream')
          .should.equal(true)
      })

      it('should continue with the process', function (ctx) {
        ctx.ProjectZipStreamManager.addAllDocsToArchive.called.should.equal(
          true
        )
        ctx.ProjectZipStreamManager.addAllFilesToArchive.called.should.equal(
          true
        )
        return ctx.archive.finalize.called.should.equal(true)
      })
    })
  })

  describe('addAllDocsToArchive', function () {
    beforeEach(async function (ctx) {
      await new Promise(resolve => {
        ctx.docs = {
          '/main.tex': {
            lines: [
              '\\documentclass{article}',
              '\\begin{document}',
              'Hello world',
              '\\end{document}',
            ],
          },
          '/chapters/chapter1.tex': {
            lines: ['chapter1', 'content'],
          },
        }
        ctx.ProjectEntityHandler.getAllDocs = sinon
          .stub()
          .callsArgWith(1, null, ctx.docs)
        return ctx.ProjectZipStreamManager.addAllDocsToArchive(
          ctx.project_id,
          ctx.archive,
          error => {
            ctx.callback(error)
            return resolve()
          }
        )
      })
    })

    it('should get the docs for the project', function (ctx) {
      return ctx.ProjectEntityHandler.getAllDocs
        .calledWith(ctx.project_id)
        .should.equal(true)
    })

    it('should add each doc to the archive', function (ctx) {
      return (() => {
        const result = []
        for (let path in ctx.docs) {
          const doc = ctx.docs[path]
          path = path.slice(1) // remove "/"
          result.push(
            ctx.archive.append
              .calledWith(doc.lines.join('\n'), { name: path })
              .should.equal(true)
          )
        }
        return result
      })()
    })
  })

  describe('addAllFilesToArchive', function () {
    beforeEach(function (ctx) {
      ctx.files = {
        '/image.png': {
          _id: 'file-id-1',
          hash: 'abc',
        },
        '/folder/picture.png': {
          _id: 'file-id-2',
          hash: 'def',
        },
      }
      ctx.streams = {
        abc: new EventEmitter(),
        def: new EventEmitter(),
      }
      ctx.ProjectEntityHandler.getAllFiles = sinon
        .stub()
        .callsArgWith(1, null, ctx.files)
      ctx.HistoryManager.requestBlobWithProjectId = (
        projectId,
        hash,
        callback
      ) => {
        return callback(null, { stream: ctx.streams[hash] })
      }
      sinon.spy(ctx.HistoryManager, 'requestBlobWithProjectId')
      ctx.ProjectZipStreamManager.addAllFilesToArchive(
        ctx.project_id,
        ctx.archive,
        ctx.callback
      )
      for (const hash in ctx.streams) {
        const stream = ctx.streams[hash]
        stream.emit('end')
      }
    })

    it('should get the files for the project', function (ctx) {
      return ctx.ProjectEntityHandler.getAllFiles
        .calledWith(ctx.project_id)
        .should.equal(true)
    })

    it('should get a stream for each file', function (ctx) {
      for (const path in ctx.files) {
        const file = ctx.files[path]

        ctx.HistoryManager.requestBlobWithProjectId
          .calledWith(ctx.project_id, file.hash)
          .should.equal(true)
      }
    })

    it('should add each file to the archive', function (ctx) {
      for (let path in ctx.files) {
        const file = ctx.files[path]
        path = path.slice(1) // remove "/"
        ctx.archive.append.should.have.been.calledWith(ctx.streams[file.hash], {
          name: path,
        })
      }
    })
  })

  describe('review state bundle', function () {
    beforeEach(async function (ctx) {
      ctx.logger.warn = sinon.stub()
      const archive = {
        on() {},
        append: sinon.stub(),
        finalize: sinon.stub(),
      }
      ctx.archive = archive
      ctx.archiver.returns(archive)
      ctx.DocstoreManager.promises.getAllDocsWithRanges.resolves([
        {
          _id: 'doc-1',
          lines: ['hello world'],
          ranges: {
            comments: [
              { id: 'thr-1', op: { c: 'world', p: 6, t: 'thr-1' }, metadata: {} },
            ],
            changes: [],
          },
        },
      ])
      ctx.ChatApiHandler.promises.getThreads.resolves({
        'thr-1': {
          resolved: false,
          messages: [
            { user_id: 'user-1', content: 'world', timestamp: 123 },
          ],
        },
      })
      ctx.ProjectZipStreamManager.addAllDocsToArchive = (p, a, cb) => cb(null)
      ctx.ProjectZipStreamManager.addAllFilesToArchive = (p, a, cb) => cb(null)
      ctx.archive = await new Promise(resolve => {
        ctx.ProjectZipStreamManager.createZipStreamForProject(
          'project-1',
          false,
          undefined,
          (err, stream) => resolve(stream)
        )
      })
      // the bundle is appended asynchronously after the files callback
      await new Promise(resolve => setImmediate(resolve))
    })

    it('appends the review state JSON with comments and threads', function (ctx) {
      const call = ctx.archive.append.args.find(
        a => a[1]?.name === 'overleaf-comments-and-changes.json'
      )
      expect(call, 'review JSON append missing').to.not.equal(undefined)
      const parsed = JSON.parse(call[0])
      expect(parsed.format).to.equal('overleaf-comments-and-changes')
      expect(parsed.docs[0].ranges.comments[0].op.t).to.equal('thr-1')
      expect(parsed.threads['thr-1'].messages[0].content).to.equal('world')
      expect(ctx.archive.finalize.called).to.equal(true)
    })

    it('still finalizes the zip when the chat service fails', async function (ctx) {
      ctx.ChatApiHandler.promises.getThreads.rejects(new Error('chat down'))
      const archive = ctx.archive
      archive.append.resetHistory()
      archive.finalize.resetHistory()
      await new Promise(resolve => {
        ctx.ProjectZipStreamManager.createZipStreamForProject(
          'project-1',
          false,
          undefined,
          (err, stream) => resolve(stream)
        )
      })
      await new Promise(resolve => setImmediate(resolve))
      const call = archive.append.args.find(
        a => a[1]?.name === 'overleaf-comments-and-changes.json'
      )
      const parsed = JSON.parse(call[0])
      expect(parsed.threads).to.deep.equal({})
      expect(archive.finalize.called).to.equal(true)
    })

    it('getReviewState propagates a docstore failure', async function (ctx) {
      const { getReviewState } = await import(modulePath)
      ctx.DocstoreManager.promises.getAllDocsWithRanges.rejects(
        new Error('docstore down')
      )
      let threw = null
      try {
        await getReviewState('project-1')
      } catch (err) {
        threw = err
      }
      expect(threw).to.not.equal(null)
      expect(threw.message).to.match(/docstore down/)
    })

    it('does not bundle the review JSON when includeReviewState is false (templates)', async function (ctx) {
      ctx.archive.append.resetHistory()
      ctx.archive.finalize.resetHistory()
      const archive = ctx.archive
      await new Promise(resolve => {
        ctx.ProjectZipStreamManager.createZipStreamForProject(
          'project-1',
          false,
          undefined,
          (err, stream) => resolve(stream),
          { includeReviewState: false }
        )
      })
      await new Promise(resolve => setImmediate(resolve))
      const call = archive.append.args.find(
        a => a[1]?.name === 'overleaf-comments-and-changes.json'
      )
      expect(call).to.equal(undefined)
      expect(archive.finalize.called).to.equal(true)
    })
  })
})
