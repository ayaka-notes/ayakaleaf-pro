/**
 * BibTeX author/editor name parsing.
 *
 * `AuthorList` splits an `A and B and C` field into `Name`s (handling a trailing
 * "others" → "et al."); each `Name` parses the "von Last, Jr, First" /
 * "First von Last" forms. Input is the rendered display string (outer braces
 * stripped, whitespace collapsed).
 *
 * Pure, dependency-free.
 */

/** Split "von Last" into a von run + last name. */
function splitVonLast(source: string): { von: string; last: string } {
  const words = source.split(/\s+/).filter(Boolean)
  if (words.length === 0) return { von: '', last: '' }
  if (words.length === 1) return { von: '', last: words[0] }
  const last = words[words.length - 1]
  const middle = words.slice(0, -1)
  // index of the LAST lowercase-initial word in the middle run
  let lastLower = -1
  for (let i = middle.length - 1; i >= 0; i--) {
    if (/^[a-z]/.test(middle[i])) {
      lastLower = i
      break
    }
  }
  if (lastLower === -1) {
    return { von: '', last: words.join(' ') }
  }
  return {
    von: middle.slice(0, lastLower + 1).join(' '),
    last: [...middle.slice(lastLower + 1), last].join(' '),
  }
}

/** One parsed name (von / last / first / suffix). */
export class Name {
  first = ''
  von = ''
  last = ''
  suffix = ''

  constructor(source: string) {
    const parts = source
      .trim()
      .split(',')
      .map(part => part.trim())

    if (parts.length >= 3) {
      // "von Last, Jr, First"
      const { von, last } = splitVonLast(parts[0])
      this.von = von
      this.last = last
      this.suffix = parts[1]
      this.first = parts.slice(2).join(' ').trim()
    } else if (parts.length === 2) {
      // "von Last, First"
      const { von, last } = splitVonLast(parts[0])
      this.von = von
      this.last = last
      this.first = parts[1]
    } else {
      // "First von Last" (no comma)
      const { first, von, last } = this.splitFirstVonLast(source.trim())
      this.first = first
      this.von = von
      this.last = last
    }
  }

  private splitFirstVonLast(source: string) {
    const words = source.split(/\s+/).filter(Boolean)
    if (words.length === 0) return { first: '', von: '', last: '' }
    if (words.length === 1) return { first: '', von: '', last: words[0] }
    const last = words[words.length - 1]
    const middle = words.slice(0, -1)
    // von = span from the first lowercase-initial middle word to the last one
    let firstLower = -1
    let lastLower = -1
    for (let i = 0; i < middle.length; i++) {
      if (/^[a-z]/.test(middle[i])) {
        if (firstLower === -1) firstLower = i
        lastLower = i
      }
    }
    if (lastLower === -1) {
      return { first: middle.join(' '), von: '', last }
    }
    return {
      first: middle.slice(0, firstLower).join(' '),
      von: middle.slice(firstLower, lastLower + 1).join(' '),
      last: [...middle.slice(lastLower + 1), last].join(' '),
    }
  }

  toFirstLast(): string {
    return [this.first, this.von, this.last, this.suffix].filter(Boolean).join(' ')
  }

  toLast(): string {
    return [this.von, this.last].filter(Boolean).join(' ')
  }

  toLastFirst(): string {
    const base = [this.von, this.last].filter(Boolean).join(' ')
    return this.first ? `${base}, ${this.first}` : base
  }
}

type NameFormatter = (name: Name) => string

/** A parsed `A and B and C` author list. */
export class AuthorList {
  readonly names: Name[]
  readonly hasOthers: boolean

  constructor(source: string) {
    if (!source.trim()) {
      this.names = []
      this.hasOthers = false
      return
    }
    const parts = source
      .split(/\s+and\s+/i)
      .map(part => part.trim())
      .filter(Boolean)
    if (parts.length > 1 && parts[parts.length - 1].toLowerCase() === 'others') {
      this.hasOthers = true
      this.names = parts.slice(0, -1).map(part => new Name(part))
    } else {
      this.hasOthers = false
      this.names = parts.map(part => new Name(part))
    }
  }

  /** Oxford-conjunction display, e.g. "A, B, and C". */
  join(format: NameFormatter = name => name.toFirstLast()): string {
    const { names, hasOthers } = this
    if (names.length === 0) return ''
    const formatted = names.map(format)
    if (hasOthers) {
      return formatted.length === 1
        ? `${formatted[0]} et al.`
        : `${formatted.join(', ')}, et al.`
    }
    if (formatted.length === 1) return formatted[0]
    if (formatted.length === 2) return `${formatted[0]} and ${formatted[1]}`
    return `${formatted.slice(0, -1).join(', ')}, and ${formatted[formatted.length - 1]}`
  }

  /** Compact summary, e.g. "A et al." / "A & B". */
  summarize(): string {
    const { names, hasOthers } = this
    if (names.length === 0) return ''
    const lastNames = names.map(name => name.toLast())
    if (hasOthers || lastNames.length > 2) {
      return `${lastNames[0]} et al.`
    }
    return lastNames.join(' & ')
  }
}

// ---- back-compat helpers (used by other module files / index.ts) ----

/** List of "First von Last" display names. */
export function authorDisplayList(raw: string): string[] {
  return new AuthorList(raw).names.map(name => name.toFirstLast())
}

/** Compact summary string. */
export function summarizeAuthors(raw: string): string {
  return new AuthorList(raw).summarize()
}
