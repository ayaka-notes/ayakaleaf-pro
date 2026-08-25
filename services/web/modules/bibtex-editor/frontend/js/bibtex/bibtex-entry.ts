/**
 * Immutable BibTeX entry model.
 *
 * Mirrors the shape used by Overleaf's visual editor: an entry has a type,
 * a citation key and an ordered map of fields. Accessors derive the columns
 * shown in the table (Citation key / Title / Author / Year).
 *
 * Pure, dependency-free.
 */
import { AuthorList } from './author-names'

/** One field's value: a resolved display string plus its raw bib source. */
export interface FieldValue {
  /** cleaned, macro-resolved text for display */
  display: string
  /** exact source between `=` and the field terminator (kept so edits round-trip) */
  raw: string
}

export const EMPTY_FIELD: FieldValue = { display: '', raw: '' }

export interface EntryRange {
  /** char offset of the `@` that starts the entry, in the source document */
  from: number
  /** char offset just after the entry's closing brace */
  to: number
}

export interface BibEntryInit {
  type?: string
  key?: string
  fields?: Map<string, FieldValue>
  range?: EntryRange
  id?: string
}

let AUTO_ID = 0

export class BibEntry {
  readonly type: string
  readonly key: string
  readonly fields: Map<string, FieldValue>
  readonly range?: EntryRange
  /** stable id for React keys / selection (falls back to citation key) */
  readonly id: string

  constructor(init: BibEntryInit = {}) {
    this.type = (init.type ?? 'article').toLowerCase()
    this.key = init.key ?? ''
    this.fields = init.fields ?? new Map()
    this.range = init.range
    // The id defaults to the citation key so it stays STABLE across re-parses
    // (selection, React keys and save-time lookups survive commits). Auto-id is
    // only used for keyless entries.
    this.id = init.id || this.key || `entry-${AUTO_ID++}`
  }

  getField(name: string): FieldValue {
    return this.fields.get(name.toLowerCase()) ?? EMPTY_FIELD
  }

  hasField(name: string): boolean {
    return this.fields.has(name.toLowerCase())
  }

  getFieldNames(): string[] {
    return Array.from(this.fields.keys())
  }

  /**
   * Author list (falls back to `editor`). Returns an AuthorList whose `.join()`
   * produces the "A, B, and C" display and `.summarize()` the compact form.
   */
  getAuthors(): AuthorList {
    const raw =
      this.getField('author').display || this.getField('editor').display
    return new AuthorList(raw)
  }

  /** Title column: falls back to `subtitle`. */
  getTitle(): string {
    return this.getField('title').display || this.getField('subtitle').display
  }

  /** Year column: `year`, else the year that STARTS the `date` field. */
  getYear(): string {
    const y = this.getField('year').display
    if (y) return y
    const m = this.getField('date').display.match(/^\d{4}/)
    return m ? m[0] : ''
  }

  // ----- immutable updates (return a new entry, preserve id) -----

  private clone(patch: Partial<BibEntryInit>): BibEntry {
    return new BibEntry({
      type: patch.type ?? this.type,
      key: patch.key ?? this.key,
      fields: patch.fields ?? new Map(this.fields),
      range: 'range' in patch ? patch.range : this.range,
      id: this.id,
    })
  }

  setType(type: string): BibEntry {
    return this.clone({ type })
  }

  setKey(key: string): BibEntry {
    return this.clone({ key })
  }

  /** Set/replace a field from a plain display string (raw becomes `{value}`). */
  setField(name: string, display: string): BibEntry {
    const fields = new Map(this.fields)
    fields.set(name.toLowerCase(), { display, raw: `{${display}}` })
    return this.clone({ fields })
  }

  /** Set/replace a field keeping an explicit FieldValue (preserves raw source). */
  setFieldValue(name: string, value: FieldValue): BibEntry {
    const fields = new Map(this.fields)
    fields.set(name.toLowerCase(), value)
    return this.clone({ fields })
  }

  removeField(name: string): BibEntry {
    const fields = new Map(this.fields)
    fields.delete(name.toLowerCase())
    return this.clone({ fields })
  }
}
