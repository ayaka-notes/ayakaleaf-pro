import {
  Range,
  StateEffect,
  StateField,
  Text,
  TransactionSpec,
} from '@codemirror/state'
import {
  Decoration,
  DecorationSet,
  EditorView,
} from '@codemirror/view'
import type { HighlightTag } from '@ol-types/user-settings'

type TagHighlightSettings = HighlightTag[]

export const tagHighlightEffect = StateEffect.define<TagHighlightSettings>()

// Append a semi-transparent alpha to #rrggbb colours so that highlighted
// lines stay readable over both light and dark editor backgrounds; any other
// value is used as-is.
function withAlpha(color: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}4D` : color
}

export function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Match the tag in a comment: the tag right after the %, ignoring any
// whitespace in between, case-insensitively, and not as part of a longer
// word (so tag "TODO" matches "% TODO:" but not "% TODOIST").
export function tagRegexFor(tag: string) {
  return new RegExp(`%\\s*${escapeRegExp(tag)}(?![\\w-])`, 'i')
}

// A single line decoration that paints the line with the given colour.
function lineDecorationFor(color: string) {
  return Decoration.line({
    class: 'cm-tag-highlight',
    attributes: { style: `background-color: ${withAlpha(color)}` },
  })
}

export function buildDecorations(
  doc: Text,
  tags: TagHighlightSettings
): DecorationSet {
  const validTags = tags.filter(
    tag => tag && typeof tag.tag === 'string' && tag.tag.trim() !== ''
  )
  if (validTags.length === 0) {
    return Decoration.none
  }
  // The first matching tag (in the user's order) wins for a given line, so
  // each tag's colour takes priority according to its list position.
  const matchers = validTags.map(tag => ({
    color: tag.color,
    regex: tagRegexFor(tag.tag.trim()),
  }))
  const decorations: Range<Decoration>[] = []
  for (let i = 0; i < doc.lines; i += 1) {
    const line = doc.line(i + 1)
    for (const { color, regex } of matchers) {
      if (regex.test(line.text)) {
        decorations.push(lineDecorationFor(color).range(line.from))
        break
      }
    }
  }
  return Decoration.set(decorations)
}

// The settings and decorations are singletons (like `documentOutline`) so
// that they can be read from outside the extension (e.g. the comment outline
// publisher). The initial tags are applied via `setTagHighlight` when the
// editor state is created.
export const tagHighlightSettingsField =
  StateField.define<TagHighlightSettings>({
    create: () => [],
    update(value, tr) {
      for (const effect of tr.effects) {
        if (effect.is(tagHighlightEffect)) {
          value = effect.value
        }
      }
      return value
    },
  })

export const tagHighlightDecorationsField =
  StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      if (
        !tr.docChanged &&
        !tr.effects.some(effect => effect.is(tagHighlightEffect))
      ) {
        return value
      }
      const tags = tr.state.field(tagHighlightSettingsField)
      return buildDecorations(tr.state.doc, tags)
    },
    provide(field) {
      return EditorView.decorations.from(field)
    },
  })

export function tagHighlight() {
  return [tagHighlightSettingsField, tagHighlightDecorationsField]
}

export const setTagHighlight = (
  tags: TagHighlightSettings
): TransactionSpec => ({
  effects: tagHighlightEffect.of(tags),
})
