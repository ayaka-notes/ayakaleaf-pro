import OError from '@overleaf/o-error'

// What the managers throw when they do not do what the admin asked, for
// AdminRequestHelper.adminRoute to answer. An account or project that does not
// exist is core's NotFoundError, an email already in use its EmailExistsError.

// It cannot be done: the message tells the admin why
class RefusedError extends OError {}

class InvalidEmailError extends OError {}

// It went wrong halfway: the message is a locale key for the admin, the cause
// is for the log
class FailedError extends OError {
  constructor(localeKey, cause) {
    super(localeKey, {}, cause)
  }
}

export { RefusedError, InvalidEmailError, FailedError }
