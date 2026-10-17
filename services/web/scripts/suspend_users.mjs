/*
 * Read a list of users from a file and suspend their accounts.
 *
 * Each line is either a user ID or an email address; the two can be mixed in
 * one file. Emails are matched against any of a user's addresses, not just the
 * primary one. An email that matches no account is reported as a failure and
 * the rest of the file is still processed.
 *
 * Use the --reenable option to roll back account suspension.
 *
 * Usage: node scripts/suspend_users.mjs [--reenable] <filename>
 */
import fs from 'node:fs'
import { ObjectId } from '../app/src/infrastructure/mongodb.mjs'
import UserGetter from '../app/src/Features/User/UserGetter.mjs'
import UserUpdater from '../app/src/Features/User/UserUpdater.mjs'
import { promiseMapWithLimit } from '@overleaf/promise-utils'

const ASYNC_LIMIT = 10
const reenable = process.argv.includes('--reenable')
const action = reenable ? 're-enable' : 'suspend'
const updateUser = reenable
  ? UserUpdater.promises.unsuspendUser
  : UserUpdater.promises.suspendUser

const processLogger = {
  failed: [],
  success: [],
  printSummary: () => {
    console.log(
      {
        success: processLogger.success,
        failed: processLogger.failed,
      },
      `\nDONE. ${processLogger.success.length} successful. ${processLogger.failed.length} failed to ${action}.`
    )
  },
}

function _isEmail(identifier) {
  return identifier.includes('@')
}

function _validateIdentifierList(identifiers) {
  if (!Array.isArray(identifiers)) throw new Error('users is not an array')

  identifiers.forEach(identifier => {
    if (!ObjectId.isValid(identifier) && !_isEmail(identifier)) {
      throw new Error(`not a valid user ID or email: ${identifier}`)
    }
  })
}

async function _resolveUserId(identifier) {
  if (!_isEmail(identifier)) return identifier

  const user = await UserGetter.promises.getUserByAnyEmail(identifier, {
    _id: 1,
  })
  if (user == null) {
    throw new Error(`no user found with email ${identifier}`)
  }
  return user._id
}

async function _handleUser(identifier) {
  let userId
  try {
    userId = await _resolveUserId(identifier)
  } catch (error) {
    console.log(`Failed to resolve ${identifier}`, error)
    processLogger.failed.push(identifier)
    return
  }

  try {
    await updateUser(userId, {
      ip: '0.0.0.0',
      info: { script: true },
    })
  } catch (error) {
    console.log(`Failed to ${action} ${identifier}`, error)
    processLogger.failed.push(identifier)
    return
  }
  processLogger.success.push(identifier)
}

async function _loopUsers(identifiers) {
  return promiseMapWithLimit(ASYNC_LIMIT, identifiers, _handleUser)
}

const fileName = process.argv.slice(2).find(arg => arg !== '--reenable')
if (!fileName) throw new Error('missing filename')
const usersFile = fs.readFileSync(fileName, 'utf8')
const identifiers = usersFile
  .trim()
  .split('\n')
  .map(identifier => identifier.trim())
  .filter(Boolean)

async function processUsers(identifiers) {
  console.log('---Starting suspend_users script---')
  _validateIdentifierList(identifiers)
  console.log(`---Starting to ${action} ${identifiers.length} users---`)
  await _loopUsers(identifiers)

  processLogger.printSummary()
  process.exit()
}

processUsers(identifiers)
