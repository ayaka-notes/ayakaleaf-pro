import { ReferenceIndex } from '@/features/ide-react/references/reference-index'
import type {
  Changes,
  Bib2JsonEntry,
  AdvancedReferenceSearchResult,
} from '@/features/ide-react/references/types'

export default class AdvancedReferenceIndex extends ReferenceIndex {
  fileIndex: Map<string, Set<string>> = new Map()
  entryIndex: Map<string, Bib2JsonEntry> = new Map()

  updateIndex({ updates, deletes }: Changes): Set<string> {
    for (const path of deletes) {
      const keys = this.fileIndex.get(path)
      if (keys) {
        for (const k of keys) {
          this.entryIndex.delete(k)
        }
      }
      this.fileIndex.delete(path)
    }

    for (const { path, content } of updates) {
      const previous = this.fileIndex.get(path)
      if (previous) {
        for (const k of previous) {
          this.entryIndex.delete(k)
        }
      }

      const fileReferences = new Set<string>()
      const entries = this.parseEntries(content)

      for (const entry of entries) {
        fileReferences.add(entry.EntryKey)
        this.entryIndex.set(entry.EntryKey, entry)
      }

      this.fileIndex.set(path, fileReferences)
    }

    this.keys = new Set(
      this.fileIndex.values().flatMap(entry => Array.from(entry))
    )

    return this.keys
  }

  async search(query: string): Promise<AdvancedReferenceSearchResult> {
    const q = (query || '').toLowerCase().trim()

    // Empty query: return all entries
    if (!q) {
      return this.list()
    }

    const tokens = q.split(/\s+/).filter(Boolean)

    const hits: { _source: Bib2JsonEntry }[] = []

    for (const entry of this.entryIndex.values()) {

      const match = tokens.every(token =>
        this.matchesAnyField(entry, token)
      )

      if (match) {
        hits.push({ _source: entry })
      }
    }

    return { hits }
  }

  private list(limit: number = 0): AdvancedReferenceSearchResult {
    const results: { _source: Bib2JsonEntry }[] = []
    for (const entry of this.entryIndex.values()) {
      if (limit && results.length >= limit) break
      results.push({ _source: entry })
    }
    return { hits: results }
  }

  private matchesAnyField(entry: Bib2JsonEntry, token: string): boolean {
    const t = token.toLowerCase()
    const f = entry.Fields

    return (
      entry.EntryKey.toLowerCase().includes(t) ||
      f.author.toLowerCase().includes(t) ||
      f.journal.toLowerCase().includes(t) ||
      f.title.toLowerCase().includes(t) ||
      f.date.toLowerCase().includes(t) ||
      f.year.toLowerCase().includes(t)
    )
  }
}
