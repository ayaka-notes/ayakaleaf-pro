const { fromError } = require('zod-validation-error')
const { InvalidParamsError, InvalidRequestError } = require('./Errors')

function createHandleValidationError(statusCode = 400) {
  return (err, req, res, next) => {
    if (err instanceof InvalidParamsError) {
      res
        .status(404)
        .json({ error: fromError(err.zodError).toString(), statusCode: 404 })
    } else if (err instanceof InvalidRequestError) {
      res
        .status(statusCode)
        .json({ error: fromError(err.zodError).toString(), statusCode })
    } else {
      next(err)
    }
  }
}

const handleValidationError = createHandleValidationError(400)

module.exports = { handleValidationError, createHandleValidationError }
