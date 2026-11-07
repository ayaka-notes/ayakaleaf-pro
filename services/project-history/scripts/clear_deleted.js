#!/usr/bin/env node

import async from 'async'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import redis from '@overleaf/redis-wrapper'
import path from 'node:path'
import { db, ObjectId } from '../app/js/mongodb.js'

logger.logger.level('fatal')

const rclient = redis.createClient(Settings.redis.project_history)
const Keys = Settings.redis.project_history.key_schema

const argv = process.argv.slice(2)
const limit = parseInt(argv[0], 10) || null
const force = argv[1] === 'force' || false
let delay = 0

function checkAndClear(project, callback) {
  const projectId = project.project_id
  function checkDeleted(cb) {
    db.projects.findOne(
      { _id: new ObjectId(projectId) },
      { projection: { _id: 1 } },
      (err, result) => {
        if (err) {
          cb(err)
        } else if (!result) {
          // project not found, but we still need to look at deletedProjects
          cb()
        } else {
          console.log(`Project ${projectId} found in projects`)
          cb(new Error('error: project still exists'))
        }
      }
    )
  }

  function checkRecoverable(cb) {
    db.deletedProjects.findOne(
      {
        // this condition makes use of the index
        'deleterData.deletedProjectId': new ObjectId(projectId),
        // this condition checks if the deleted project has expired
        'project._id': new ObjectId(projectId),
      },
      { projection: { _id: 1 } },
      (err, result) => {
        if (err) {
          cb(err)
        } else if (!result) {
          console.log(
            `project ${projectId} has been deleted - safe to clear queue`
          )
          cb()
        } else {
          console.log(`Project ${projectId} found in deletedProjects`)
          cb(new Error('error: project still exists'))
        }
      }
    )
  }

  function clearRedisQueue(cb) {
    const key = Keys.projectHistoryOps({ project_id: projectId })
    delay++
    if (force) {
      console.log('setting redis key', key, 'to expire in', delay, 'seconds')
      // use expire to allow redis to delete the key in the background
      rclient.expire(key, delay, err => {
        cb(err)
      })
    } else {
      console.log(
        'dry run, would set key',
        key,
        'to expire in',
        delay,
        'seconds'
      )
      cb()
    }
  }

  function clearMongoEntry(cb) {
    if (force) {
      console.log('deleting key in mongo projectHistoryFailures', projectId)
      db.projectHistoryFailures.deleteOne({ project_id: projectId }, cb)
    } else {
      console.log('would delete failure record for', projectId, 'from mongo')
      cb()
    }
  }

  // do the checks and deletions
  async.waterfall(
    [checkDeleted, checkRecoverable, clearRedisQueue, clearMongoEntry],
    err => {
      if (!err || err.message === 'error: project still exists') {
        callback()
      } else {
        console.log('error:', err)
        callback(err)
      }
    }
  )
}

// find all the broken projects from the failure records
async function main() {
  const results = await db.projectHistoryFailures.find({}).toArray()
  processFailures(results)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})

function processFailures(results) {
  if (limit === null) {
    console.log(`
Usage: node clear_deleted.js [QUEUES] [FORCE]

where
    QUEUES is the number of queues to process
    FORCE is the string "force" when we're ready to delete the queues. Without it, this script does a dry-run
`)
    process.exit(0)
  }
  console.log('number of stuck projects', results.length)
  console.log('force mode', force ? 'enabled' : 'disabled (dry run)')
  const projectsToProcess = results.slice(0, limit)
  const unprocessedProjects = results.length - projectsToProcess.length
  const scriptFileName = path.basename(process.argv[1])
  const limitOrPlaceholder = limit ?? 100
  const forceExampleCommand = `node scripts/${scriptFileName} ${limitOrPlaceholder} force`
  // now check if the project is truly deleted in mongo
  async.eachSeries(projectsToProcess, checkAndClear, err => {
    console.log('DONE', err)
    if (unprocessedProjects > 0) {
      console.warn(
        `WARNING: ${unprocessedProjects} project(s) were not processed in this run`
      )
    }
    if (!force) {
      console.warn(
        `Dry run only. Rerun with force to apply changes, for example: ${forceExampleCommand}`
      )
    }
    process.exit()
  })
}
