/**
 * Pure validation for the bib visual editor.
 *
 * The "Check" button (reviewer requirement) validates only — it never writes.
 *
 * Model (aligned with the Overleaf reference manager and yu-i-i's editor,
 * overleaf-cep @ ca8fd03):
 *  - an EMPTY citation key is valid source: the visual editor generates
 *    one at materialize time (utils/bib-key-generation.ts), never here.
 *    A non-empty key that is not a legal BibTeX identifier is an error.
 *  - required fields: standalone "X is required"; OR-group "Either A or B
 *    is required" shown next to EVERY empty member of the group.
 *  - format WARNINGS for filled values: year (4 digits), BibLaTeX date /
 *    URL date, DOI, URL. Warnings never block structurally safe writes —
 *    structural guards live in the write planner.
 *
 * validateEntry() is pure: it returns machine-readable messages
 * (ValidationMessage), the view renders them via i18n.
 */
import { getEntryType } from './bib-types'
import { BIBTEX_CITATION_KEY_REGEX } from '@shared/bibtex/bibtex-identifier.mts'

export type ValidationMessage =
  | {
      kind: 'id-invalid'
    }
  | {
      /** One empty standalone required field, or a whole empty OR-group */
      kind: 'required-missing'
      /** Field member(s) this message applies to (standalone: 1) */
      labelFields: string[]
      group: boolean
    }
  | {
      kind: 'year-format'
    }
  | {
      kind: 'date-format'
    }
  | {
      kind: 'doi-format'
    }
  | {
      kind: 'url-invalid'
  }

export type ValidationResult = {
  /** Validation messages keyed by field name (shown under each listed field) */
  byField: Record<string, ValidationMessage>
  /** True when validation passed (no messages at all) */
  valid: boolean
}

export function isValidCitationKey(key: string): boolean {
  const trimmed = key.trim()
  return trimmed !== '' && BIBTEX_CITATION_KEY_REGEX.exec(trimmed)?.[0] === trimmed
}

/** BibLaTeX date/date-range syntax, including partial dates and date-times. */
const DATE_PART_PATTERN = String.raw`(?:[+-]?\d{4}(?:-(?:\d{2}|XX)(?:-(?:\d{2}|XX)(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?)?)?|\d{3}X|\d{2}XX)[?~%]?`
const DATE_PATTERN = new RegExp(
  String.raw`^(?:${DATE_PART_PATTERN}(?:\s*\/\s*(?:${DATE_PART_PATTERN}|\.\.))?|\.\.\s*\/\s*${DATE_PART_PATTERN})$`,
  'i'
)

/** Validate the date syntax only; calendar/range ordering is not checked. */
export function hasValidBiblatexDate(value: string): boolean {
  const date = value.trim()
  return !date || DATE_PATTERN.test(date)
}

function isValidDoi(value: string): boolean {
  return /^10\.\d{4,9}\/\S+$/.test(value.trim())
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value.trim())
    return true
  } catch {
    return false
  }
}

/**
 * All format warnings are non-blocking; values are tested only if nonempty.
 * Required-field errors take precedence over format-only warnings.
 */
const FORMAT_CHECKS: {
  field: string
  kind: 'year-format' | 'date-format' | 'doi-format' | 'url-invalid'
  valid: (value: string) => boolean
}[] = [
  { field: 'year', kind: 'year-format', valid: value => /^\d{4}$/.test(value.trim()) },
  { field: 'date', kind: 'date-format', valid: hasValidBiblatexDate },
  { field: 'urldate', kind: 'date-format', valid: hasValidBiblatexDate },
  { field: 'doi', kind: 'doi-format', valid: isValidDoi },
  { field: 'url', kind: 'url-invalid', valid: isValidUrl },
]

/**
 * Validate an entry draft.
 *
 * An empty citation key is valid here. Generation/commit is managed by the
 * visual editor's key lifecycle (bib-key-generation.ts), never by this
 * validator.
 */
export function validateEntry(
  entry: { type: string; id: string; fields: Record<string, string> },
  kind: 'existing' | 'new'
): ValidationResult {
  const typeDef = getEntryType(entry.type)
  const required = typeDef?.requiredFields || []
  const byField: Record<string, ValidationMessage> = {}

  // 1) citation key: only a NON-EMPTY invalid key is an error.
  if (kind === 'existing' || entry.id.trim()) {
    if (entry.id.trim() && !isValidCitationKey(entry.id)) {
      byField.id = { kind: 'id-invalid' }
    }
  }

  // 2) required fields (OR-group semantics)
  // A group message is attached to every empty member of an empty group.
  for (const req of required) {
    const members: string[] = Array.isArray(req) ? [...req] : [req]
    const allEmpty = members.every(f => !entry.fields[f]?.trim())
    if (!allEmpty) continue
    const group = Array.isArray(req)
    // skip members that have a more specific message already (e.g. format)
    for (const f of members) {
      if (f in byField) continue
      byField[f] = {
        kind: 'required-missing',
        labelFields: members,
        group,
      }
    }
  }

  // 3) format warnings (only for filled values; required wins per field)
  for (const { field: name, kind: messageKind, valid } of FORMAT_CHECKS) {
    const value = entry.fields[name]
    if (value && value.trim() && !(name in byField) && !valid(value)) {
      byField[name] = { kind: messageKind }
    }
  }

  return { byField, valid: Object.keys(byField).length === 0 }
}

const FORMAT_WARNING_KINDS = new Set<ValidationMessage['kind']>([
  'year-format',
  'date-format',
  'doi-format',
  'url-invalid',
])

export function isFormatWarning(message: ValidationMessage | undefined): boolean {
  return message !== undefined && FORMAT_WARNING_KINDS.has(message.kind)
}

/**
 * Format warnings do not block submission or source edits; required fields
 * and invalid nonempty citation keys are the blocking form messages.
 * Structural source writes have separate guards (bib-write.ts).
 */
export function hasBlockingValidationErrors(result: ValidationResult): boolean {
  return Object.values(result.byField).some(message => !isFormatWarning(message))
}
