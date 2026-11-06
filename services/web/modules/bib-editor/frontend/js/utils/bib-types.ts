import bibtexSchema from './bibtex-schema.json'
import {
  HUMAN_LABELS,
  CAPTURED_FORM_ROWS,
} from './overleaf-type-map.ts'

/**
 * BibTeX entry type definition and field metadata.
 */
export type BibEntry = {
  type: string
  id: string
  fields: Record<string, string>
  /** Library: stable API row id (Mongo _id) — identity for bulk ops. */
  libId?: string
  /** Library: last-updated ISO date (SaaS `bibtex-entry-card-updated-at`). */
  updatedAt?: string | null
}

export type BibEntryType = {
  name: string
  label: string
  requiredFields: Array<string | string[]>
  optionalFields: string[]
  defaultOptionalFields: string[]
}

export type BibtexSchema = {
  source: string
  supportedPublicationTypes: string[]
  allKnownFields: string[]
  publicationTypes: Record<
    string,
    {
      requiredFields: Array<string | string[]>
      optionalFields: string[]
      // Small per-type list of optional fields shown by default for NEW
      // entries (btxdoc-derived); the full optional list stays in optionalFields.
      defaultOptionalFields?: string[]
    }
  >
}

const schema = bibtexSchema as BibtexSchema

/**
 * Display label for a machine type. Source of truth: the 48 captured
 * overleaf.com form labels (overleaf-type-map.ts). Types outside the 48
 * (custom/legacy machine types) fall back to capitalized first letter.
 */
const toLabel = (name: string): string => {
  const known = HUMAN_LABELS[name.toLowerCase()]
  if (known) return known
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export const ENTRY_TYPES: BibEntryType[] = schema.supportedPublicationTypes.map(
  typeName => ({
    name: typeName,
    label: toLabel(typeName),
    requiredFields: schema.publicationTypes[typeName].requiredFields,
    optionalFields: schema.publicationTypes[typeName].optionalFields,
    defaultOptionalFields:
      schema.publicationTypes[typeName].defaultOptionalFields || [],
  })
)

/** All known BibTeX field names */
export const ALL_FIELDS: readonly string[] = schema.allKnownFields

/**
 * Initial type for the “New Entry” form. The last type used on a new-entry
 * form (Phase B W1) is stored as the preset; when there is none (or the
 * preset is not a supported type — defensive) it falls back to `article`
 * (the upstream default).
 */
export function getNewEntryInitialType(preset: string | null): string {
  if (preset !== null && schema.supportedPublicationTypes.includes(preset)) {
    return preset
  }
  return 'article'
}

/**
 * W3a (§12 P3): is a form re-sync a REBIND (parse-confirmed write landed —
 * new → existing, or an existing entry was renamed) rather than a fresh
 * parse of the SAME bound entry? Only a rebind keeps re-shows Check results
 * (`checked` stays true); a fresh parse of the same entry clears them.
 */
export function isFormRebind(
  prev: { kind: 'existing' | 'new'; originalId: string | null },
  next: { kind: 'existing' | 'new'; originalId: string | null }
): boolean {
  return prev.kind !== next.kind || prev.originalId !== next.originalId
}

export function getEntryType(name: string): BibEntryType | undefined {
  return ENTRY_TYPES.find(t => t.name === name.toLowerCase())
}

/** Get all relevant fields for a given entry type (required + optional), preserving order */
export type RequiredFieldConstraint = string | string[]

export function getFieldsForType(typeName: string): string[] {
  const entryType = getEntryType(typeName)
  if (!entryType) return [...ALL_FIELDS]
  const requiredFields = entryType.requiredFields.flatMap(field =>
    Array.isArray(field) ? field : [field]
  )
  const fields = [...requiredFields, ...entryType.optionalFields]
  for (const f of ALL_FIELDS) {
    if (!fields.includes(f)) fields.push(f)
  }
  return fields
}

export function getMissingRequiredFields(
  requiredFields: Array<string | string[]>,
  fields: Record<string, string>
): Array<string | string[]> {
  return requiredFields.filter(field => {
    if (Array.isArray(field)) {
      return !field.some(f => fields[f]?.trim())
    }
    return !fields[field]?.trim()
  })
}

export function hasAllRequiredFields(
  requiredFields: Array<string | string[]>,
  fields: Record<string, string>
): boolean {
  return getMissingRequiredFields(requiredFields, fields).length === 0
}

/**
 * Flat required member fields for a type (OR-groups flattened).
 * Never contains array values — guard against the pseudo-field rendering bug
 * ("authoreditor"/"chapterpages" rows).
 */
export function flattenRequired(
  requiredFields: Array<string | string[]>
): string[] {
  return requiredFields.flatMap(field =>
    Array.isArray(field) ? field : [field]
  )
}

/**
 * Fields that should display a required-star, given the current values.
 * Rule (reviewer): a standalone required field shows a star while empty;
 * every member of an OR-group shows a star while ALL members are empty.
 * Returns a flat, order-preserving list of field names.
 */
export function requiredStarMembers(
  requiredFields: Array<string | string[]>,
  fields: Record<string, string>
): string[] {
  const members: string[] = []
  for (const field of requiredFields) {
    const list = Array.isArray(field) ? field : [field]
    if (list.every(f => !fields[f]?.trim())) {
      for (const f of list) {
        if (!members.includes(f)) members.push(f)
      }
    }
  }
  return members
}

/**
 * Fields to display for an entry form.
 * kind 'existing': required (flattened) + all optional + any known/unknown
 * field already carrying a value (never repeats a required member).
 * kind 'new':  required (flattened) + defaultOptionalFields only.
 * `showAll` always reveals required + optional + valued fields (allKnown
 * fields beyond that are Code-mode territory).
 */
export function displayFieldsFor(
  typeDef: BibEntryType | undefined,
  kind: 'existing' | 'new',
  valuedFields: Record<string, string>,
  showAll: boolean
): string[] {
  if (!typeDef) {
    const valued = Object.keys(valuedFields).filter(f => valuedFields[f]?.trim())
    return showAll ? valued : []
  }
  const requiredFlat = flattenRequired(typeDef.requiredFields)
  const valued = Object.keys(valuedFields).filter(f => valuedFields[f]?.trim())

  if (showAll) {
    const fields = [...requiredFlat, ...typeDef.optionalFields, ...valued]
    return fields.filter((f, i, all) => all.indexOf(f) === i)
  }

  if (kind === 'existing') {
    const fields = [...requiredFlat, ...typeDef.optionalFields, ...valued]
    return fields.filter((f, i, all) => all.indexOf(f) === i)
  }

  // new entry: required + the small default-optional list
  const fields = [...requiredFlat, ...typeDef.defaultOptionalFields, ...valued]
  return fields.filter((f, i, all) => all.indexOf(f) === i)
}

/**
 * C2 form model (Phase C capture parity, PHASE_C_PLAN.md §1.2/§3-C2/§5).
 *
 * The form is: Entry type selector (48) → Citation key → per-type main
 * fields (CAPTURED_FORM_ROWS.mainFields) → Year → Date → per-type postDate
 * rows (unpublished: Note; electronic/online/www: DOI/Eprint/URL) →
 * collapsed Optional section.
 *
 * Year and Date are ALWAYS present, in that order (48/48 capture).
 *
 * Validation stays in the schema (requiredFields may OR-group
 * author/editor while the form renders both rows — rows and validation
 * are separate concerns; plan §1.2 note).
 */
export function formModelFor(
  type: string,
  _valuedFields: Record<string, string>
): {
  mainFields: string[]
  /** rows after Date (unpublished: Note; electronic/online/www: DOI…) */
  postDate: string[]
} {
  const row = CAPTURED_FORM_ROWS[type.toLowerCase()]
  // mainFields may contain year/date only in degenerate cases; the capture
  // anatomy puts Year/Date rows explicitly, so strip duplicates and return
  // main-without-year/date first, then postDate.
  const main = (row?.mainFields ?? []).filter(f => f !== 'year' && f !== 'date')
  const postDate = row?.postDate ?? []
  return { mainFields: main, postDate }
}

/**
 * Full ordered row list for the form body: main → Year → Date → postDate.
 * (C2 unit-tested: field order per type, Year/Date always present.)
 */
export function formRowsFor(
  type: string,
  valuedFields: Record<string, string>
): string[] {
  const { mainFields, postDate } = formModelFor(type, valuedFields)
  return [...mainFields, 'year', 'date', ...postDate]
}

/**
 * The dynamic Optional rows (C2): captured optional fields that currently
 * have a value OR were explicitly added via the Add-field combobox, in
 * stable schema order. `abstract` is EXCLUDED unless explicitly added
 * (the C4 Abstract tab owns it — the capture form has no abstract row).
 *
 * The Add-field combobox (same section) offers offeredOptionalFields() —
 * the taxonomy minus the current type's main/postDate rows and
 * required-members. Picking one moves it into optionalVisibleFor as
 * its value appears (or immediately, via the added list).
 */
export function optionalVisibleFor(
  type: string,
  valuedFields: Record<string, string>,
  addedFields: string[] = []
): string[] {
  const entryType = getEntryType(type)
  if (!entryType) return []
  const requiredFlat = new Set(flattenRequired(entryType.requiredFields))
  const { mainFields, postDate } = formModelFor(type, valuedFields)
  const formFields = new Set([...mainFields, 'year', 'date', ...postDate])
  const valued = Object.keys(valuedFields).filter(
    f => valuedFields[f]?.trim() !== ''
  )
  return entryType.optionalFields.filter(f => {
    if (formFields.has(f)) return false
    if (requiredFlat.has(f)) return false
    if (f === 'abstract' && !addedFields.includes(f)) return false
    return valued.includes(f) || addedFields.includes(f)
  })
}
