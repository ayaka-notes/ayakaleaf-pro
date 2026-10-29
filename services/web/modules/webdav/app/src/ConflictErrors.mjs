import OError from '@overleaf/o-error'

class ConflictError extends OError {
  constructor(message, details = {}) {
    super(message, { ...details, type: 'ConflictError' })
    this.name = 'ConflictError'
    this.details = details
  }
}

export { ConflictError }