// @ts-check

const OError = require('@overleaf/o-error')

/**
 * @typedef {import('zod').ZodError} ZodError
 */

class InvalidRequestError extends OError {
  /**
   * @param {ZodError} zodError
   */
  constructor(zodError) {
    super('Invalid request', {}, zodError)
    this.zodError = zodError
  }
}

class InvalidParamsError extends OError {
  /**
   * @param {ZodError} zodError
   */
  constructor(zodError) {
    super('Invalid request parameters', {}, zodError)
    this.zodError = zodError
  }
}

module.exports = { InvalidParamsError, InvalidRequestError }
