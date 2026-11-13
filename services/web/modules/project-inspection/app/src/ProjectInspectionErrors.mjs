export class ProjectInspectionError extends Error {
  constructor(message, { code, statusCode, cause } = {}) {
    super(message, { cause })
    this.name = 'ProjectInspectionError'
    this.code = code ?? 'PROJECT_INSPECTION_ERROR'
    this.statusCode = statusCode ?? 500
  }
}

export class InvalidEntryPointError extends ProjectInspectionError {
  constructor(message = 'One or more entry points are invalid') {
    super(message, { code: 'INVALID_ENTRY_POINT', statusCode: 400 })
  }
}

export class ProjectTooLargeError extends ProjectInspectionError {
  constructor(message = 'The project is too large to analyze safely') {
    super(message, { code: 'PROJECT_TOO_LARGE', statusCode: 413 })
  }
}

export class AnalysisTimeoutError extends ProjectInspectionError {
  constructor(message = 'Project inspection timed out') {
    super(message, { code: 'ANALYSIS_TIMEOUT', statusCode: 504 })
  }
}

export class AnalysisCancelledError extends ProjectInspectionError {
  constructor(message = 'Project inspection was cancelled') {
    super(message, { code: 'ANALYSIS_CANCELLED', statusCode: 499 })
  }
}
