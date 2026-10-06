/**
 * Defines chat errors for rate limits, unavailable AI access, and rejected tools.
 */

/** Server responded 429 — request/token quota exhausted (drives the paywall). */
export class RateLimitError extends Error {
  secondsToReset: number | null = null

  constructor(rateLimitReset?: string | null) {
    super('Rate limit exceeded')
    this.name = 'RateLimitError'
    if (rateLimitReset) {
      const seconds = parseInt(rateLimitReset, 10)
      if (!isNaN(seconds)) {
        this.secondsToReset = seconds
      }
    }
  }
}

/** Server responded 403 — AI features are disabled for this user/instance. */
export class ForbiddenError extends Error {
  constructor() {
    super('Access forbidden')
    this.name = 'ForbiddenError'
  }
}

export class ToolCallLimitError extends Error {
  constructor() {
    super('Tool call limit reached for this message. Send another message to continue.')
    this.name = 'ToolCallLimitError'
  }
}

/** A client-side tool declined to run (e.g. the user rejected an edit). */
export class ToolRejectionError extends Error {
  constructor(message?: string) {
    super(message)
    this.name = 'ToolRejectionError'
  }
}
