// @ts-check

import minimist from 'minimist'
import { scriptRunner } from '../lib/ScriptRunner.mjs'
import logger from '@overleaf/logger'
import {
  db,
  ObjectId,
  READ_PREFERENCE_SECONDARY,
} from '../../app/src/infrastructure/mongodb.mjs'
import HistoryManager from '../../app/src/Features/History/HistoryManager.mjs'
import DocstoreManager from '../../app/src/Features/Docstore/DocstoreManager.mjs'
import DocumentUpdaterHandler from '../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'

function usage() {
  console.error(`Usage: resync_projects.mjs [OPTIONS]

Options:

    --help                 Print this help
    --project-id           Migrate this project
    --min-id               Migrate projects from this id
    --max-id               Migrate projects to this id
    --last-updated-after   Migrate projects last updated after this date
    --last-updated-before  Migrate projects last updated before this date
    --skip-resynced-after  Skip projects that have already been resynced after this date
    --commit               Actually perform the resync, instead of just checking which projects would be resynced
    --skip-metadata-checks Skip doing Mongo/Redis-level only checks to determine if the projects needs resyncing (has ranges or linked file data)
    --concurrency          How many jobs to run in parallel
`)
}

/**
 *
 * @returns {{ projectIds?: string[]; minId?: string; maxId?: string; concurrency: number; commit: boolean; skipMetadataChecks: boolean; lastUpdatedAfter?: string; lastUpdatedBefore?: string; skipResyncedAfter?: string; }}
 */
function parseArgs() {
  const args = minimist(process.argv.slice(2), {
    boolean: ['help', 'commit', 'skip-metadata-checks'],
    string: [
      'project-id',
      'min-id',
      'max-id',
      'last-updated-after',
      'last-updated-before',
      'skip-resynced-after',
    ],
  })

  if (args.help) {
    usage()
    process.exit(0)
  }

  const projectIds = arrayOpt(args['project-id'])
  const minId = args['min-id']
  const maxId = args['max-id']
  const lastUpdatedAfter = args['last-updated-after']
  const lastUpdatedBefore = args['last-updated-before']
  const concurrency = parseInt(args.concurrency, 10) || 1
  const commit = args.commit
  const skipMetadataChecks = args['skip-metadata-checks']
  const skipResyncedAfter = args['skip-resynced-after']

  if (
    projectIds == null &&
    minId == null &&
    maxId == null &&
    lastUpdatedAfter == null &&
    lastUpdatedBefore == null &&
    skipResyncedAfter == null
  ) {
    console.error('Please specify at least one filter\n')
    usage()
    process.exit(1)
  }

  return {
    projectIds,
    minId,
    maxId,
    concurrency,
    commit,
    skipMetadataChecks,
    lastUpdatedAfter,
    lastUpdatedBefore,
    skipResyncedAfter,
  }
}

async function main() {
  const {
    projectIds,
    minId,
    maxId,
    concurrency,
    commit,
    skipMetadataChecks,
    lastUpdatedAfter,
    lastUpdatedBefore,
    skipResyncedAfter,
  } = parseArgs()

  // skip projects that don't have full project history
  /** @type {any[]} */
  const clauses = [{ 'overleaf.history.id': { $exists: true } }]

  if (projectIds != null) {
    clauses.push({ _id: { $in: projectIds.map(id => new ObjectId(id)) } })
  }
  if (minId) {
    clauses.push({ _id: { $gte: new ObjectId(minId) } })
  }
  if (maxId) {
    clauses.push({ _id: { $lte: new ObjectId(maxId) } })
  }
  if (lastUpdatedAfter) {
    clauses.push({ lastUpdated: { $gt: new Date(lastUpdatedAfter) } })
  }
  if (lastUpdatedBefore) {
    clauses.push({ lastUpdated: { $lt: new Date(lastUpdatedBefore) } })
  }
  if (skipResyncedAfter) {
    clauses.push({
      'overleaf.history.lastResyncedAt': {
        $not: { $gt: new Date(skipResyncedAfter) },
      },
    })
  }
  const filter = { $and: clauses }

  const projects = db.projects
    .find(filter, {
      readPreference: READ_PREFERENCE_SECONDARY,
      projection: { _id: 1, overleaf: 1 },
    })
    .sort({ _id: -1 })

  /** @type {{ skipped: number; resync: number; total: number;}} */
  const projectsProcessed = {
    skipped: 0,
    resync: 0,
    total: 0,
  }
  /** @type {Map<string, Promise<void>>} */
  const jobsByProjectId = new Map()
  let errors = 0

  let terminating = false
  /**
   * @param {any} signal
   */
  const handleSignal = signal => {
    logger.info({ signal }, 'History resync job received signal')
    terminating = true
  }
  process.on('SIGINT', handleSignal)
  process.on('SIGTERM', handleSignal)

  for await (const project of projects) {
    if (terminating) {
      break
    }

    const projectId = project._id.toString()
    if (jobsByProjectId.size >= concurrency) {
      // Wait until the next job finishes
      await Promise.race(jobsByProjectId.values())
    }
    const job = processProject(projectId, { commit, skipMetadataChecks })
      .then(
        /** @param {'skipped' | 'resync'} migrationType */ migrationType => {
          jobsByProjectId.delete(projectId)
          projectsProcessed[migrationType] += 1
          projectsProcessed.total += 1
          logger.debug(
            {
              projectId,
              projectsProcessed,
              errors,
              migrationType,
            },
            'History resync'
          )
          if (projectsProcessed.total % 10000 === 0) {
            logger.info(
              { projectsProcessed, errors, lastProjectId: projectId },
              'History resync progress'
            )
          }
        }
      )
      .catch(
        /** @param {any} err */ err => {
          jobsByProjectId.delete(projectId)
          errors += 1
          logger.error(
            { err, projectId, projectsProcessed, errors },
            'Failed to resync project history'
          )
        }
      )

    jobsByProjectId.set(projectId, job)
  }

  // Clear the remaining backlog of jobs
  await Promise.all(jobsByProjectId.values())
  logger.info({ projectsProcessed, errors }, 'History resync completion')
}

/**
 *
 * @param {string} projectId
 * @param {{skipMetadataChecks: boolean, commit: boolean}} opts
 * @returns
 */
async function processProject(projectId, opts) {
  const shouldProceed = opts.skipMetadataChecks
    ? true
    : await hasHistoryMetadata(projectId)

  if (!shouldProceed) {
    logger.debug(
      { projectId },
      'Skipping project as it has no history relevant data in Mongo'
    )
    return 'skipped'
  }

  if (opts.commit) {
    logger.debug({ projectId }, 'Resyncing project')
    await HistoryManager.promises.flushProject(projectId)
    await HistoryManager.promises.resyncProject(projectId)
  } else {
    logger.debug({ projectId }, 'Project would be resynced')
  }

  return 'resync'
}

/**
 *
 * @param {string} projectId
 * @returns
 */
async function hasHistoryMetadata(projectId) {
  try {
    const blockSuccess =
      await DocumentUpdaterHandler.promises.blockProject(projectId)
    if (!blockSuccess) {
      logger.debug(
        { projectId },
        'Project is currently active, so we cannot skip'
      )
      return true
    }
  } catch (err) {
    logger.warn(
      { projectId, err },
      'Error thrown while acquiring block for project'
    )
    return true
  }

  try {
    if (await hasLinkedFileData(projectId)) {
      return true
    }
    if (await DocstoreManager.promises.projectHasRanges(projectId, true)) {
      return true
    }
    return false
  } catch (err) {
    logger.warn(
      { projectId, err },
      'Error checking for history data in Mongo, proceeding with resync just in case'
    )
  } finally {
    try {
      await DocumentUpdaterHandler.promises.unblockProject(projectId)
    } catch (err) {
      logger.warn(
        { projectId, err },
        'Error unblocking project after checking for history data in Mongo'
      )
    }
  }
  return true
}

/**
 *
 * @param {string} projectId
 * @returns {Promise<boolean>}
 */
async function hasLinkedFileData(projectId) {
  const project = await db.projects.findOne(
    { _id: new ObjectId(projectId) },
    {
      projection: { rootFolder: 1 },
      readPreference: READ_PREFERENCE_SECONDARY,
    }
  )
  if (!project) {
    return false
  }
  return hasLinkedDataInFileTree(project.rootFolder?.[0])
}

/**
 *
 * @param {any} folder
 * @returns {boolean}
 */
function hasLinkedDataInFileTree(folder) {
  if (!folder) {
    return false
  }
  if (Array.isArray(folder.fileRefs)) {
    for (const fileRef of folder.fileRefs) {
      if (fileRef.linkedFileData) {
        return true
      }
    }
  }
  if (Array.isArray(folder.folders)) {
    for (const subfolder of folder.folders) {
      if (hasLinkedDataInFileTree(subfolder)) {
        return true
      }
    }
  }
  return false
}

/**
 * @param {any} value
 * @returns {Array<any> | undefined}
 */
function arrayOpt(value) {
  if (typeof value === 'string') {
    return [value]
  } else if (Array.isArray(value)) {
    return value
  } else {
    return undefined
  }
}

try {
  await scriptRunner(main)
  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
