import OError from '@overleaf/o-error'

export class TemplateNameConflictError extends OError {
  constructor(ownerId, message = 'template_with_this_title_exists_and_owned_by_x') {
    super(message, { ownerId })
  }
}

export class RecompileRequiredError extends OError {
  constructor(message = 'Recompile required') {
    super(message, { status: 400 })
  }
}

export class MainFileRequiredError extends OError {
  constructor(message = 'Main file required') {
    super(message, { status: 400 })
  }
}
