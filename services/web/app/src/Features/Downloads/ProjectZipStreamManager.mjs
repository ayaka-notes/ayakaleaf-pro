import archiver from 'archiver'
import async from 'async'
import logger from '@overleaf/logger'
import ProjectEntityHandler from '../Project/ProjectEntityHandler.mjs'
import ProjectGetter from '../Project/ProjectGetter.mjs'
import HistoryManager from '../History/HistoryManager.mjs'
import Metrics from '@overleaf/metrics'
import DocstoreManager from '../Docstore/DocstoreManager.mjs'
import ChatApiHandler from '../Chat/ChatApiHandler.mjs'
let ProjectZipStreamManager

// A project's review state (comment threads + tracked changes) lives outside
// the project files (docstore ranges + chat service), so a zip of the files
// alone would lose it. Every project zip therefore bundles this JSON, which
// scripts/import-project-review.mjs reconstitutes on import.
export const REVIEW_JSON_NAME = 'overleaf-comments-and-changes.json'

// Snapshot of a project's comment threads and tracked changes, read from
// docstore and the chat service (same sources the editor uses). Throws on
// failure — callers that must not break (zip downloads) catch and skip.
export async function getReviewState(projectId) {
  const [docs, threads] = await Promise.all([
    DocstoreManager.promises.getAllDocsWithRanges(projectId),
    ChatApiHandler.promises
      .getThreads(projectId)
      .catch(err => {
        // Threads are optional: a failed chat service must not break the
        // download, but it means comments would be lost on import.
        logger.warn(
          { err, projectId },
          'could not read comment threads for export; comments will be missing from the bundle'
        )
        return {}
      }),
  ])
  // Only threads that are anchored by a comment range in some doc; global
  // messages and orphan threads are not part of the review state.
  const anchoredThreadIds = new Set()
  for (const doc of docs) {
    for (const comment of doc.ranges?.comments ?? []) {
      if (comment?.op?.t != null) anchoredThreadIds.add(String(comment.op.t))
    }
  }
  const outThreads = {}
  for (const [threadId, thread] of Object.entries(threads ?? {})) {
    if (!anchoredThreadIds.has(threadId)) continue
    outThreads[threadId] = {
      resolved: Boolean(thread.resolved),
      resolved_at: thread.resolved_at ?? null,
      resolved_by_user_id: thread.resolved_by_user_id ?? null,
      messages: (thread.messages ?? [])
        .map(message => ({
          user_id: message.user_id,
          content: message.content,
          timestamp: message.timestamp,
        }))
        .filter(message => message.user_id != null && message.content != null),
    }
  }
  return {
    format: 'overleaf-comments-and-changes',
    version: 1,
    project_id: projectId,
    exported_at: new Date().toISOString(),
    docs: docs.map(doc => ({
      id: typeof doc._id === 'string' ? doc._id : doc._id.toString(),
      ranges: {
        comments: doc.ranges?.comments ?? [],
        changes: doc.ranges?.changes ?? [],
      },
    })),
    threads: outThreads,
  }
}

export default ProjectZipStreamManager = {
  createZipStreamForMultipleProjects(projectIds, zipFromHistory, callback) {
    // We'll build up a zip file that contains multiple zip files
    const archive = archiver('zip')
    archive.on('error', err =>
      logger.err(
        { err, projectIds },
        'something went wrong building archive of project'
      )
    )
    callback(null, archive)

    const jobs = projectIds.map(projectId => cb => {
      ProjectGetter.getProject(
        projectId,
        { name: true, 'overleaf.history.id': true },
        (error, project) => {
          if (error) {
            return cb(error)
          }
          if (!project) {
            logger.debug(
              { projectId },
              'cannot append project to zip stream: project not found'
            )
            return cb()
          }
          logger.debug(
            { projectId, name: project.name },
            'appending project to zip stream'
          )
          ProjectZipStreamManager.createZipStreamForProject(
            projectId,
            zipFromHistory,
            project.overleaf.history.id,
            (error, stream) => {
              if (error) {
                return cb(error)
              }
              archive.append(stream, { name: `${project.name}.zip` })
              stream.on('end', () => {
                logger.debug(
                  { projectId, name: project.name },
                  'zip stream ended'
                )
                cb()
              })
            }
          )
        }
      )
    })

    async.series(jobs, () => {
      logger.debug(
        { projectIds },
        'finished creating zip stream of multiple projects'
      )
      archive.finalize()
    })
  },

  createZipStreamForProject(
    projectId,
    zipFromHistory,
    historyId,
    callback,
    // options.includeReviewState (default true): bundle the comment/thread
    // state JSON into the zip. Templates are created from this manager and
    // must never carry comments or tracked changes, so the template path
    // passes { includeReviewState: false }.
    options = {}
  ) {
    const includeReviewState = options.includeReviewState !== false
    Metrics.inc('project_zip_download', 1, {
      method: zipFromHistory ? 'history-v1' : 'web',
    })
    if (zipFromHistory) {
      return HistoryManager.flushProject(projectId, error => {
        if (error) return callback(error)
        HistoryManager.getLatestZipWithHistoryId(historyId, callback)
      })
    }
    const archive = archiver('zip')
    // return stream immediately before we start adding things to it
    archive.on('error', err =>
      logger.err(
        { err, projectId },
        'something went wrong building archive of project'
      )
    )
    callback(null, archive)
    this.addAllDocsToArchive(projectId, archive, error => {
      if (error) {
        logger.error(
          { err: error, projectId },
          'error adding docs to zip stream'
        )
      }
      this.addAllFilesToArchive(projectId, archive, error => {
        if (error) {
          logger.error(
            { err: error, projectId },
            'error adding files to zip stream'
          )
        }
        if (!includeReviewState) {
          // e.g. template creation: comments and tracked changes must not
          // be carried over into the template.
          archive.finalize()
          return
        }
        // Bundle the review state (comments + tracked changes); a failure
        // must never break the download itself.
        getReviewState(projectId)
          .then(state =>
            archive.append(JSON.stringify(state, null, 2), {
              name: REVIEW_JSON_NAME,
            })
          )
          .catch(err =>
            logger.warn(
              { err, projectId },
              'could not bundle review state into project zip'
            )
          )
          .finally(() => archive.finalize())
      })
    })
  },

  addAllDocsToArchive(projectId, archive, callback) {
    ProjectEntityHandler.getAllDocs(projectId, (error, docs) => {
      if (error) {
        return callback(error)
      }
      const jobs = Object.entries(docs).map(([path, doc]) => cb => {
        if (path[0] === '/') {
          path = path.slice(1)
        }
        logger.debug({ projectId }, 'Adding doc')
        archive.append(doc.lines.join('\n'), { name: path })
        setImmediate(cb)
      })
      async.series(jobs, callback)
    })
  },

  getFileStream: (projectId, file, callback) => {
    HistoryManager.requestBlobWithProjectId(
      projectId,
      file.hash,
      (error, result) => {
        if (error) {
          return callback(error)
        }
        const { stream } = result
        callback(null, stream)
      }
    )
  },

  addAllFilesToArchive(projectId, archive, callback) {
    ProjectEntityHandler.getAllFiles(projectId, (error, files) => {
      if (error) {
        return callback(error)
      }
      const jobs = Object.entries(files).map(([path, file]) => cb => {
        ProjectZipStreamManager.getFileStream(
          projectId,
          file,
          (error, stream) => {
            if (error) {
              logger.warn(
                { err: error, projectId, fileId: file._id },
                'something went wrong adding file to zip archive'
              )
              return cb(error)
            }
            if (path[0] === '/') {
              path = path.slice(1)
            }
            archive.append(stream, { name: path })
            stream.on('end', () => cb())
          }
        )
      })
      async.parallelLimit(jobs, 5, callback)
    })
  },
}
