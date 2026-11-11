import type { Text } from '@codemirror/state'
import type { HighlightTag } from '@ol-types/user-settings'
import { tagRegexFor } from './tag-highlight'

// A special comment (one of the user's highlight tags) found in the open
// document, listed in the File outline panel.
export type CommentOutlineEntry = {
  line: number // 1-based line number
  tag: string // the matched tag, upper-cased
  text: string // the rest of the comment after the tag
  color: string // the tag's highlight colour
}

const MAX_ENTRY_TEXT_LENGTH = 120

// Scan every line of the document and return an entry for each line whose
// comment contains one of the user's highlight tags. The first matching tag
// (in the user's list order) wins, mirroring the source-editor highlighting.
export function computeCommentOutline(
  doc: Text,
  tags: HighlightTag[]
): CommentOutlineEntry[] {
  const validTags = tags.filter(
    tag => tag && typeof tag.tag === 'string' && tag.tag.trim() !== ''
  )
  if (validTags.length === 0) {
    return []
  }
  const matchers = validTags.map(tag => ({
    tag: tag.tag.trim(),
    color: tag.color,
    regex: tagRegexFor(tag.tag.trim()),
  }))
  const entries: CommentOutlineEntry[] = []
  for (let i = 0; i < doc.lines; i += 1) {
    const line = doc.line(i + 1)
    for (const { tag, color, regex } of matchers) {
      const match = regex.exec(line.text)
      if (match) {
        const rest = line.text
          .slice(match.index + match[0].length)
          .replace(/^[^a-zA-Z0-9]*/, '')
          .trim()
          .slice(0, MAX_ENTRY_TEXT_LENGTH)
        entries.push({
          line: i + 1,
          tag: tag.toUpperCase(),
          text: rest,
          color,
        })
        break
      }
    }
  }
  return entries
}
