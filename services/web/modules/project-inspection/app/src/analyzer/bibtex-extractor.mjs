import { parser as BibTeXParser } from '../../../../../frontend/js/features/source-editor/lezer-bibtex/bibtex.mjs'
import { createLineIndex, createLocation } from './source-location.mjs'

function staticValue(source, valueNode) {
  const parts = []
  const cursor = valueNode.cursor()
  if (!cursor.firstChild()) return ''
  do {
    if (cursor.name === 'StringName') return undefined
    if (cursor.name === 'NumberLiteral') {
      parts.push(source.slice(cursor.from, cursor.to))
      continue
    }
    if (cursor.name !== 'StringLiteral') continue
    const literal = cursor.node.getChild('StringContents')
    parts.push(literal ? source.slice(literal.from, literal.to) : '')
  } while (cursor.nextSibling())
  return parts.join('')
}

function extractEntry(file, lineStarts, entryNode) {
  const body = entryNode.getChild('EntryBody')
  const citationKey = body?.getChild('CitationKey')
  if (!body || !citationKey) return undefined
  const key = file.content.slice(citationKey.from, citationKey.to).trim()
  if (!key) return undefined

  const entry = {
    key,
    location: createLocation(file.content, lineStarts, {
      entityId: file.id,
      path: file.path,
      from: citationKey.from,
      to: citationKey.to,
    }),
  }
  for (const field of body.getChildren('Field')) {
    const fieldName = field.getChild('FieldName')
    const value = field.getChild('Value')
    if (
      !fieldName ||
      !value ||
      file.content.slice(fieldName.from, fieldName.to).toLowerCase() !==
        'title'
    ) {
      continue
    }
    const title = staticValue(file.content, value)
    if (title == null) return entry
    entry.title = title
    entry.titleLocation = createLocation(file.content, lineStarts, {
      entityId: file.id,
      path: file.path,
      from: field.from,
      to: field.to,
    })
    return entry
  }
  return entry
}

export function extractBibtex(file) {
  if (file.content == null) {
    return {
      path: file.path,
      entityId: file.id,
      entries: [],
      parseErrorCount: 0,
      unavailable: true,
      skippedReason: file.skippedReason ?? 'content-unavailable',
    }
  }

  const lineStarts = createLineIndex(file.content)
  const tree = BibTeXParser.parse(file.content)
  const entries = []
  let parseErrorCount = 0

  tree.iterate({
    enter(node) {
      if (node.type.isError) {
        parseErrorCount++
      } else if (node.type.name === 'Entry') {
        const entry = extractEntry(file, lineStarts, node.node)
        if (entry) entries.push(entry)
      }
    },
  })

  return {
    path: file.path,
    entityId: file.id,
    entries,
    parseErrorCount,
    unavailable: false,
  }
}
