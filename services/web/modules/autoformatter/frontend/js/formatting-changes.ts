import { diffChars } from 'diff'

export type FormattingChange = { from: number; to: number; insert: string }

// Past this many differing non-whitespace characters, diffing them gets slow
// (over half a second for a 2 MB file), so the text is replaced as one change
const MAX_EDIT_LENGTH = 2000

/**
 * The text without whitespace, and the offset of each kept character.
 */
function solidCharacters(text: string) {
  const offsets: number[] = []
  for (let i = 0; i < text.length; i++) {
    if (!/\s/.test(text[i])) {
      offsets.push(i)
    }
  }
  return { text: text.replace(/\s+/g, ''), offsets }
}

/**
 * The changes that turn `before` into `after`. Formatters mostly change
 * whitespace (tex-fmt also adds a % to wrapped comments, bibtex-tidy drops
 * trailing commas), so the texts are lined up on their other characters and
 * only the gaps between them that differ are replaced. This keeps comments,
 * tracked changes and the cursor in place, and is fast on large documents.
 */
export function formattingChanges(
  before: string,
  after: string
): FormattingChange[] {
  const a = solidCharacters(before)
  const b = solidCharacters(after)
  const parts =
    a.text === b.text
      ? [{ value: a.text }]
      : (diffChars(a.text, b.text, { maxEditLength: MAX_EDIT_LENGTH }) ?? [])

  const changes: FormattingChange[] = []
  // Ends of the last characters matched in before and after
  let fromA = 0
  let fromB = 0

  const replaceGap = (toA: number, toB: number) => {
    if (toA === fromA && toB === fromB) {
      return
    }
    const oldText = before.slice(fromA, toA)
    const newText = after.slice(fromB, toB)
    if (oldText === newText) {
      return
    }
    let start = 0
    while (
      start < oldText.length &&
      start < newText.length &&
      oldText[start] === newText[start]
    ) {
      start++
    }
    let end = 0
    while (
      end < oldText.length - start &&
      end < newText.length - start &&
      oldText[oldText.length - 1 - end] === newText[newText.length - 1 - end]
    ) {
      end++
    }
    changes.push({
      from: fromA + start,
      to: toA - end,
      insert: newText.slice(start, newText.length - end),
    })
  }

  let indexA = 0
  let indexB = 0
  for (const part of parts) {
    const length = part.value.length
    if ('added' in part && part.added) {
      indexB += length
    } else if ('removed' in part && part.removed) {
      indexA += length
    } else {
      for (let i = 0; i < length; i++) {
        const offsetA = a.offsets[indexA + i]
        const offsetB = b.offsets[indexB + i]
        replaceGap(offsetA, offsetB)
        fromA = offsetA + 1
        fromB = offsetB + 1
      }
      indexA += length
      indexB += length
    }
  }
  replaceGap(before.length, after.length)

  return changes
}
