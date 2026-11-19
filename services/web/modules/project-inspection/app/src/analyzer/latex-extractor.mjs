import { parser as LaTeXParser } from '../../../../../frontend/js/features/source-editor/lezer-latex/latex.mjs'
import { createLineIndex, createLocation } from './source-location.mjs'

const FILE_COMMANDS = new Map([
  ['Input', 'input'],
  ['Include', 'include'],
  ['Subfile', 'subfile'],
])
const PROJECT_CLASS_COMMANDS = new Set([
  'loadclass',
  'loadclasswithoptions',
])
const FIGURE_COMMANDS = new Map([
  ['IncludeGraphics', 'includegraphics'],
  ['IncludeSvg', 'includesvg'],
])
const SUPPORTED_ENVIRONMENTS = new Map([
  ['figure', 'figure'],
  ['figure*', 'figure'],
  ['table', 'table'],
  ['table*', 'table'],
  ['longtable', 'table'],
])
const ENVIRONMENT_NODE_TYPES = new Set([
  'FigureEnvironment',
  'TableEnvironment',
  'TabularEnvironment',
  'Environment',
])

function commandName(raw) {
  return raw.match(/^\\([A-Za-z@]+)/)?.[1]?.toLowerCase() ?? ''
}

function topLevelBraceArguments(raw) {
  const results = []
  let bracketDepth = 0
  let braceDepth = 0
  let start = -1
  let escaped = false

  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '[' && braceDepth === 0) {
      bracketDepth++
      continue
    }
    if (char === ']' && braceDepth === 0 && bracketDepth > 0) {
      bracketDepth--
      continue
    }
    if (bracketDepth > 0) continue
    if (char === '{') {
      if (braceDepth === 0) start = index + 1
      braceDepth++
    } else if (char === '}' && braceDepth > 0) {
      braceDepth--
      if (braceDepth === 0 && start >= 0) {
        results.push({
          value: raw.slice(start, index),
          from: start,
          to: index,
        })
        start = -1
      }
    }
  }
  return results
}

function staticValue(value) {
  const trimmed = value.trim()
  if (!trimmed || /[\\#]/.test(trimmed)) return null
  return trimmed
}

function splitStaticList(value) {
  return value
    .split(',')
    .map(item => staticValue(item))
    .filter(Boolean)
}

function splitStaticListWithOffsets(value) {
  const results = []
  let offset = 0
  for (const item of value.split(',')) {
    const key = staticValue(item)
    if (key) {
      const from = offset + item.indexOf(key)
      results.push({ key, from, to: from + key.length })
    }
    offset += item.length + 1
  }
  return results
}

function commandTarget(raw) {
  const args = topLevelBraceArguments(raw)
  if (args.length > 0) return staticValue(args.at(-1).value)
  const bare = raw.replace(/^\\[A-Za-z@]+\s*/, '').trim()
  return staticValue(bare)
}

function commandLocation(source, lineStarts, doc, node, raw, value) {
  const relativeOffset = value ? raw.indexOf(value) : 0
  const from = node.from + Math.max(0, relativeOffset)
  return createLocation(source, lineStarts, {
    entityId: doc.id,
    path: doc.path,
    from,
    to: value ? from + value.length : node.to,
  })
}

function fullCommandLocation(source, lineStarts, doc, node) {
  return createLocation(source, lineStarts, {
    entityId: doc.id,
    path: doc.path,
    from: node.from,
    to: node.to,
  })
}

function parseGraphicPaths(value) {
  const paths = []
  for (const argument of topLevelBraceArguments(value)) {
    const path = staticValue(argument.value)
    if (path) paths.push(path)
  }
  return paths
}

export function extractLatex(doc) {
  const source = doc.content
  const lineStarts = createLineIndex(source)
  const tree = LaTeXParser.parse(source)
  const result = {
    path: doc.path,
    entityId: doc.id,
    includes: [],
    figures: [],
    bibliographyFiles: [],
    captions: [],
    labels: [],
    references: [],
    citations: [],
    bibliographyEntries: [],
    environments: [],
    graphicPaths: [],
    dynamicReferences: [],
    parseErrorCount: 0,
  }

  tree.iterate({
    enter(node) {
      const type = node.type.name
      if (node.type.isError) {
        result.parseErrorCount++
        return
      }

      const raw = source.slice(node.from, node.to)
      if (type === 'DocumentClass') {
        const target = commandTarget(raw)
        const location = commandLocation(
          source,
          lineStarts,
          doc,
          node,
          raw,
          target
        )
        if (target) {
          result.includes.push({
            relation: 'documentclass',
            target,
            location,
          })
        }
        return
      }

      const fileRelation = FILE_COMMANDS.get(type)
      if (fileRelation) {
        const target = commandTarget(raw)
        const location = commandLocation(
          source,
          lineStarts,
          doc,
          node,
          raw,
          target
        )
        if (target) {
          result.includes.push({ relation: fileRelation, target, location })
        } else {
          result.dynamicReferences.push({ kind: fileRelation, location })
        }
        return
      }

      const figureRelation = FIGURE_COMMANDS.get(type)
      if (figureRelation) {
        const target = commandTarget(raw)
        const location = commandLocation(
          source,
          lineStarts,
          doc,
          node,
          raw,
          target
        )
        if (target) {
          result.figures.push({ relation: figureRelation, target, location })
        } else {
          result.dynamicReferences.push({ kind: figureRelation, location })
        }
        return
      }

      if (type === 'BibliographyCommand') {
        const value = topLevelBraceArguments(raw).at(-1)?.value ?? ''
        const targets = splitStaticList(value)
        const location = commandLocation(
          source,
          lineStarts,
          doc,
          node,
          raw,
          value
        )
        if (targets.length > 0) {
          for (const target of targets) {
            result.bibliographyFiles.push({
              relation: 'bibliography',
              target,
              location,
            })
          }
        } else {
          result.dynamicReferences.push({ kind: 'bibliography', location })
        }
        return
      }

      if (type === 'Caption') {
        const value = topLevelBraceArguments(raw).at(-1)?.value ?? ''
        if (value.trim()) {
          result.captions.push({
            value: value.trim(),
            location: fullCommandLocation(source, lineStarts, doc, node),
          })
        }
        return
      }

      if (type === 'Label') {
        const value = topLevelBraceArguments(raw).at(-1)?.value ?? ''
        const key = staticValue(value)
        const location = fullCommandLocation(source, lineStarts, doc, node)
        if (key) {
          result.labels.push({
            key,
            location,
          })
        } else {
          result.dynamicReferences.push({ kind: 'label', location })
        }
        return
      }

      if (type === 'Ref') {
        const value = topLevelBraceArguments(raw).at(-1)?.value ?? ''
        const keys = splitStaticList(value)
        const location = fullCommandLocation(source, lineStarts, doc, node)
        if (keys.length > 0) {
          for (const key of keys) result.references.push({ key, location })
        } else {
          result.dynamicReferences.push({ kind: 'reference', location })
        }
        return
      }

      if (type === 'Cite') {
        const value = topLevelBraceArguments(raw).at(-1)?.value ?? ''
        const keys = splitStaticListWithOffsets(value)
        const valueOffset = Math.max(0, raw.indexOf(value))
        const name = commandName(raw)
        if (keys.length > 0) {
          for (const key of keys) {
            const from = node.from + valueOffset + key.from
            result.citations.push({
              key: key.key,
              nocite: name === 'nocite',
              location: createLocation(source, lineStarts, {
                entityId: doc.id,
                path: doc.path,
                from,
                to: node.from + valueOffset + key.to,
              }),
            })
          }
        } else {
          const location = commandLocation(
            source,
            lineStarts,
            doc,
            node,
            raw,
            value
          )
          result.dynamicReferences.push({ kind: 'citation', location })
        }
        return
      }

      if (type === 'UnknownCommand') {
        const name = commandName(raw)
        const value = topLevelBraceArguments(raw).at(-1)?.value ?? ''
        const location = commandLocation(
          source,
          lineStarts,
          doc,
          node,
          raw,
          value
        )
        if (PROJECT_CLASS_COMMANDS.has(name)) {
          const target = staticValue(value)
          if (target) {
            result.includes.push({ relation: name, target, location })
          }
        } else if (name === 'addbibresource') {
          const target = staticValue(value)
          if (target) {
            result.bibliographyFiles.push({
              relation: 'addbibresource',
              target,
              location,
            })
          } else {
            result.dynamicReferences.push({
              kind: 'addbibresource',
              location,
            })
          }
        } else if (name === 'graphicspath') {
          const paths = parseGraphicPaths(value)
          result.graphicPaths.push(...paths)
          if (paths.length === 0) {
            result.dynamicReferences.push({ kind: 'graphicspath', location })
          }
        } else if (name === 'bibitem') {
          const key = staticValue(value)
          if (key) {
            result.bibliographyEntries.push({ key, location })
          } else {
            result.dynamicReferences.push({
              kind: 'bibliography-entry',
              location,
            })
          }
        }
        return
      }

      if (!ENVIRONMENT_NODE_TYPES.has(type)) return
      const name = raw.match(/^\\begin\s*\{([^}]+)\}/)?.[1]?.trim()
      const kind = SUPPORTED_ENVIRONMENTS.get(name)
      if (!kind) return
      result.environments.push({
        kind,
        name,
        from: node.from,
        to: node.to,
        location: createLocation(source, lineStarts, {
          entityId: doc.id,
          path: doc.path,
          from: node.from,
          to: Math.min(node.to, node.from + raw.indexOf('}') + 1),
        }),
        captions: [],
        labels: [],
        figures: [],
      })
    },
  })

  for (const label of result.labels) {
    const containing = result.environments
      .filter(
        environment =>
          label.location.from >= environment.from &&
          label.location.to <= environment.to
      )
      .sort(
        (left, right) =>
          left.to - left.from - (right.to - right.from)
      )[0]
    if (containing) {
      containing.labels.push(label.key)
      label.environmentKind = containing.kind
    }
  }

  for (const caption of result.captions) {
    const containing = result.environments
      .filter(
        environment =>
          caption.location.from >= environment.from &&
          caption.location.to <= environment.to
      )
      .sort(
        (left, right) =>
          left.to - left.from - (right.to - right.from)
      )[0]
    if (containing) {
      containing.captions.push(caption)
      caption.environmentKind = containing.kind
    }
  }

  for (const figure of result.figures) {
    const containing = result.environments
      .filter(
        environment =>
          environment.kind === 'figure' &&
          figure.location.from >= environment.from &&
          figure.location.to <= environment.to
      )
      .sort(
        (left, right) =>
          left.to - left.from - (right.to - right.from)
      )[0]
    if (containing) {
      containing.figures.push(figure)
      figure.environmentFrom = containing.from
    }
  }

  return result
}
