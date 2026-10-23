import OError from '@overleaf/o-error'

class GitNotLinkedError extends OError {
  constructor(projectId) {
    super('git server is not linked to project', { projectId })
  }
}

class AlreadyExistsError extends OError {}
class GitConflictError extends OError {}
class InvalidTokenError extends OError {}
class NotFoundError extends OError {}
class PermissionDeniedError extends OError {}
class RateLimitError extends OError {}
class ProviderRequestError extends OError {}

export {
  AlreadyExistsError,
  GitNotLinkedError,
  GitConflictError,
  InvalidTokenError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ProviderRequestError,
}
