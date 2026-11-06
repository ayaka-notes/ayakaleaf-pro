import { expressify } from '@overleaf/promise-utils'
import { ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import { FailedError, InvalidEmailError, RefusedError } from './AdminErrors.mjs'
import { isObjectId } from './AdminQueryHelper.mjs'

// What the controllers share. The managers do not see the request: controllers
// read it with these and answer what the managers return or throw.

// An id of the route (:userId, :projectId...); anything else is no such page
export function idParam(req, name) {
  const id = req.params[name]
  if (!isObjectId(id)) throw new Errors.NotFoundError(`invalid ${name}`)
  return new ObjectId(id)
}

// The admin asking, as the managers and the audit log need them
export function adminOf(req) {
  return {
    id: SessionManager.getLoggedInUserId(req.session),
    ip: req.ip,
    sessionId: req.sessionID,
  }
}

// The answer of a list, which every action changes: never from a cache
export function sendFresh(res, body) {
  res.set('Cache-Control', 'no-store')
  res.json(body)
}

// expressify, and the one way to answer what a manager refused
export function adminRoute(handler) {
  return expressify(async (req, res) => {
    try {
      await handler(req, res)
    } catch (err) {
      const t = req.i18n.translate
      if (err instanceof RefusedError) {
        HttpErrorHandler.unprocessableEntity(req, res, err.message)
      } else if (err instanceof InvalidEmailError) {
        const message = t('email_address_is_invalid')
        HttpErrorHandler.unprocessableEntity(req, res, message)
      } else if (err instanceof Errors.EmailExistsError) {
        HttpErrorHandler.conflict(req, res, t('email_already_registered'))
      } else if (err instanceof FailedError) {
        HttpErrorHandler.legacyInternal(req, res, t(err.message), err)
      } else {
        throw err
      }
    }
  })
}
