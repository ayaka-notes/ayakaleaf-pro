import path from 'node:path'
import { extractLatex } from './latex-extractor.mjs'
import { extractBibtex } from './bibtex-extractor.mjs'
import { resolveProjectPath } from './resource-resolver.mjs'
import { findCycles } from './cycles.mjs'
import { GraphBuilder } from './graph-builder.mjs'
import { IssueCollector } from './issue-collector.mjs'

const TEX_EXTENSIONS = new Set([
  '.tex',
  '.ltx',
  '.latex',
  '.rtex',
  '.rnw',
  '.sty',
  '.cls',
  '.def',
  '.clo',
  '.dtx',
  '.ins',
  '.tikz',
  '.inc',
])
const IMAGE_EXTENSIONS = [
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.eps',
  '.svg',
]
const BIB_EXTENSIONS = ['.bib', '.bibtex']
const PROJECT_CLASS_RELATIONS = new Set([
  'documentclass',
  'loadclass',
  'loadclasswithoptions',
])
const PATH_TARGET_ISSUE_TYPES = new Set([
  'missing-file',
  'missing-figure',
  'missing-bibliography',
  'unreferenced-figure',
  'possibly-unused-file',
])

const fileNodeId = filePath => `file:${filePath}`
const occurrenceNodeId = (kind, location, identity = '') =>
  `${kind}:${location.entityId}:${location.from}:${encodeURIComponent(identity)}`
const figureResourceNodeId = item =>
  occurrenceNodeId('figure-file', item.location, item.target)
const citationGroupNodeId = citation =>
  'citation-group:' +
  citation.location.entityId +
  ':' +
  encodeURIComponent(citation.key)

function normalizedBibliographyTitle(title) {
  const display = title
    .normalize('NFKC')
    .replace(/~/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return { display, key: display.toLocaleLowerCase('en-US') }
}

function normalizedCaption(caption) {
  const key = caption
    .normalize('NFKC')
    .replace(/~/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
  return key
}

function bibliographyEntrySignature(entries) {
  return entries
    .map(
      entry =>
        entry.location.entityId +
        ':' +
        entry.location.from +
        ':' +
        entry.location.to
    )
    .sort()
    .join(',')
}

function componentIssueKey(type, target) {
  let identity = String(target ?? '')
  if (PATH_TARGET_ISSUE_TYPES.has(type)) {
    identity = path.posix.normalize(identity.replace(/^\.\//, ''))
  }
  return `${type}:${encodeURIComponent(identity)}`
}

function collectBibliographyEntry(entriesByKey, entriesByTitle, entry) {
  const keyEntries = entriesByKey.get(entry.key) ?? []
  keyEntries.push(entry)
  entriesByKey.set(entry.key, keyEntries)

  if (entry.title == null || !entry.titleLocation) return
  const normalizedTitle = normalizedBibliographyTitle(entry.title)
  if (!normalizedTitle.key) return
  const titleEntries = entriesByTitle.get(normalizedTitle.key) ?? []
  titleEntries.push({ ...entry, displayTitle: normalizedTitle.display })
  entriesByTitle.set(normalizedTitle.key, titleEntries)
}

function extension(filePath) {
  return path.posix.extname(filePath).toLowerCase()
}

function isTexLike(filePath) {
  return TEX_EXTENSIONS.has(extension(filePath))
}

function isBibliography(filePath) {
  return BIB_EXTENSIONS.includes(extension(filePath))
}

function relationNode(graph, kind, item, parentPath, label, identity = label) {
  const id = occurrenceNodeId(kind, item.location, identity)
  graph.addNode({
    id,
    kind,
    label,
    path: parentPath,
    location: item.location,
    parentId: fileNodeId(parentPath),
  })
  graph.addEdge({
    kind: 'contains',
    from: fileNodeId(parentPath),
    to: id,
  })
  return id
}

function environmentNodeId(environment) {
  return occurrenceNodeId(
    environment.kind,
    environment.location,
    environment.name
  )
}

function environmentLabel(environment, sourcePath) {
  const prefix = environment.kind === 'figure' ? 'Figure' : 'Table'
  return (
    environment.labels[0] ??
    `${prefix} ${sourcePath}:${environment.location.line}`
  )
}

function resolveRelations(parsed, availablePaths) {
  const result = {
    includes: [],
    figures: [],
    bibliographies: [],
  }
  for (const item of parsed.includes) {
    const resolve = extensions =>
      resolveProjectPath({
        target: item.target,
        sourcePath: parsed.path,
        availablePaths,
        extensions,
      })
    let resolution = resolve(
      PROJECT_CLASS_RELATIONS.has(item.relation) ? ['.cls'] : ['.tex']
    )
    if (item.relation === 'input' && resolution.status === 'missing') {
      resolution = resolve(
        [...TEX_EXTENSIONS].filter(extension => extension !== '.tex')
      )
    }
    if (
      PROJECT_CLASS_RELATIONS.has(item.relation) &&
      resolution.status === 'missing'
    ) {
      continue
    }
    result.includes.push({
      ...item,
      resolution,
    })
  }
  for (const item of parsed.figures) {
    result.figures.push({
      ...item,
      resolution: resolveProjectPath({
        target: item.target,
        sourcePath: parsed.path,
        availablePaths,
        extensions: IMAGE_EXTENSIONS,
        additionalRoots: parsed.graphicPaths,
      }),
    })
  }
  for (const item of parsed.bibliographyFiles) {
    result.bibliographies.push({
      ...item,
      resolution: resolveProjectPath({
        target: item.target,
        sourcePath: parsed.path,
        availablePaths,
        extensions: BIB_EXTENSIONS,
      }),
    })
  }
  return result
}

function buildCycleEdges(cycle, relationsByPath) {
  return cycle.path.slice(0, -1).flatMap((from, index) => {
    const to = cycle.path[index + 1]
    const relation = relationsByPath
      .get(from)
      ?.includes.find(
        item =>
          item.resolution.status === 'resolved' &&
          item.resolution.path === to
      )
    return relation ? [{ from, to, location: relation.location }] : []
  })
}

function addResolvedRelationToGraph(graph, sourcePath, kind, item) {
  const commandId = relationNode(
    graph,
    kind,
    item,
    sourcePath,
    item.target
  )
  if (item.resolution.status === 'resolved') {
    graph.addEdge({
      kind,
      from: commandId,
      to: fileNodeId(item.resolution.path),
    })
  } else if (item.resolution.status === 'missing') {
    const missingId = `missing:${kind}:${sourcePath}:${item.target}`
    graph.addNode({
      id: missingId,
      kind: 'missing-resource',
      label: item.target,
      status: 'missing',
      path: sourcePath,
    })
    graph.addEdge({ kind, from: commandId, to: missingId })
  }
  return commandId
}

function attachNodeToFile(graph, nodeId, filePath) {
  graph.addNode({ id: nodeId, parentId: fileNodeId(filePath) })
  graph.addEdge({
    kind: 'contains',
    from: fileNodeId(filePath),
    to: nodeId,
  })
}

function addFigureResourceToGraph(
  graph,
  sourcePath,
  item,
  environmentsByFrom,
  entityByPath
) {
  const id = figureResourceNodeId(item)
  const environment = environmentsByFrom.get(item.environmentFrom)
  const parentId = environment
    ? environmentNodeId(environment)
    : fileNodeId(sourcePath)
  const node = {
    id,
    kind: 'figure-file',
    label: item.target,
    parentId,
  }
  if (item.resolution.status === 'resolved') {
    node.path = item.resolution.path
    node.entityId = entityByPath.get(item.resolution.path)?.id
  } else {
    node.path = sourcePath
    node.location = item.location
  }
  graph.addNode(node)
  graph.addEdge({ kind: 'contains', from: parentId, to: id })
  return id
}

function collectScope(rootPath, latexByPath, relationsByPath, bibByPath) {
  const documents = new Set()
  const images = new Set()
  const bibliographies = new Set()
  const queue = [rootPath]
  let bibliographyIncomplete = false

  while (queue.length > 0) {
    const current = queue.shift()
    if (documents.has(current) || !latexByPath.has(current)) continue
    documents.add(current)
    const parsed = latexByPath.get(current)
    if (
      parsed.dynamicReferences.some(reference =>
        ['bibliography', 'addbibresource', 'bibliography-entry'].includes(
          reference.kind
        )
      )
    ) {
      bibliographyIncomplete = true
    }
    const relations = relationsByPath.get(current)
    for (const relation of relations.includes) {
      if (
        relation.resolution.status === 'resolved' &&
        latexByPath.has(relation.resolution.path)
      ) {
        queue.push(relation.resolution.path)
      }
    }
    for (const relation of relations.figures) {
      if (relation.resolution.status === 'resolved') {
        images.add(relation.resolution.path)
      } else if (relation.resolution.status === 'ambiguous') {
        for (const candidate of relation.resolution.candidates) {
          images.add(candidate)
        }
      }
    }
    for (const relation of relations.bibliographies) {
      if (relation.resolution.status === 'resolved') {
        bibliographies.add(relation.resolution.path)
        if (bibByPath.get(relation.resolution.path)?.unavailable) {
          bibliographyIncomplete = true
        }
      } else {
        bibliographyIncomplete = true
      }
    }
  }

  return { documents, images, bibliographies, bibliographyIncomplete }
}

function issueTitle(type, target) {
  const titles = {
    'missing-file': 'Missing included file',
    'missing-figure': 'Missing figure resource',
    'missing-bibliography': 'Missing bibliography file',
    'missing-reference': 'Reference has no matching label',
    'missing-citation': 'Citation has no matching bibliography entry',
    'duplicate-label': 'Duplicate label',
    'duplicate-figure-caption': 'Duplicate figure caption',
    'duplicate-table-caption': 'Duplicate table caption',
    'duplicate-bibliography-key': 'Duplicate bibliography key',
    'duplicate-bibliography-title': 'Duplicate bibliography title',
    'unreferenced-label': 'Label is not referenced',
    'unreferenced-figure': 'Figure is not referenced',
    'unreferenced-table': 'Table is not referenced',
    'unlabeled-figure': 'Figure has no label',
    'unlabeled-table': 'Table has no label',
    'unused-bibliography-entry': 'Bibliography entry is not cited',
    'possibly-unused-file': 'File is possibly unused',
    'circular-dependency': 'Circular file dependency',
  }
  return target ? `${titles[type] ?? type}: ${target}` : titles[type] ?? type
}

export function analyzeProject(snapshot) {
  const entities = [
    ...snapshot.documents.map(item => ({ ...item, entityKind: 'document' })),
    ...snapshot.files.map(item => ({ ...item, entityKind: 'file' })),
  ]
  const entityByPath = new Map(entities.map(entity => [entity.path, entity]))
  const entityById = new Map(entities.map(entity => [entity.id, entity]))
  const availablePaths = new Set(entityByPath.keys())
  const graph = new GraphBuilder()
  const issues = new IssueCollector()
  const issueGroups = {
    missing: new Set(),
    unused: new Set(),
    duplicate: new Set(),
    citationMissing: new Set(),
    citationUnused: new Set(),
    citationDuplicate: new Set(),
    circular: new Set(),
  }
  const addIssue = (key, issue, entryPointId, groups = []) => {
    issues.add(
      key,
      { ...issue, title: issueTitle(issue.type, issue.target) },
      entryPointId
    )
    for (const group of groups) issueGroups[group].add(key)
  }

  for (const entity of entities) {
    graph.addNode({
      id: fileNodeId(entity.path),
      kind: entity.entityKind,
      label: path.posix.basename(entity.path),
      path: entity.path,
      entityId: entity.id,
    })
  }

  const latexByPath = new Map()
  for (const doc of snapshot.documents) {
    if (isTexLike(doc.path)) latexByPath.set(doc.path, extractLatex(doc))
  }

  const bibByPath = new Map()
  for (const doc of snapshot.documents) {
    if (isBibliography(doc.path)) bibByPath.set(doc.path, extractBibtex(doc))
  }
  for (const file of snapshot.binaryBibliographies) {
    bibByPath.set(file.path, extractBibtex(file))
  }

  const relationsByPath = new Map()
  const ambiguousReferences = []
  for (const [sourcePath, parsed] of latexByPath) {
    const relations = resolveRelations(parsed, availablePaths)
    relationsByPath.set(sourcePath, relations)
    for (const [kind, items] of [
      ['include', relations.includes],
      ['bibliography', relations.bibliographies],
    ]) {
      for (const item of items) {
        addResolvedRelationToGraph(graph, sourcePath, kind, item)
        if (item.resolution.status === 'ambiguous') {
          ambiguousReferences.push({
            kind,
            target: item.target,
            candidates: item.resolution.candidates,
            location: item.location,
          })
        }
      }
    }

    const environmentsByFrom = new Map(
      parsed.environments.map(environment => [environment.from, environment])
    )
    for (const environment of parsed.environments) {
      relationNode(
        graph,
        environment.kind,
        environment,
        sourcePath,
        environmentLabel(environment, sourcePath),
        environment.name
      )
    }
    for (const item of relations.figures) {
      addFigureResourceToGraph(
        graph,
        sourcePath,
        item,
        environmentsByFrom,
        entityByPath
      )
      if (item.resolution.status === 'ambiguous') {
        ambiguousReferences.push({
          kind: 'figure',
          target: item.target,
          candidates: item.resolution.candidates,
          location: item.location,
        })
      }
    }

    for (const label of parsed.labels) {
      relationNode(graph, 'label', label, sourcePath, label.key)
    }
    for (const reference of parsed.references) {
      graph.addNode({
        id: occurrenceNodeId(
          'reference',
          reference.location,
          reference.key
        ),
        kind: 'reference',
        label: reference.key,
        path: sourcePath,
        location: reference.location,
      })
    }
    for (const citation of parsed.citations) {
      if (citation.key === '*') continue
      const citationId = occurrenceNodeId(
        'citation-occurrence',
        citation.location,
        citation.key
      )
      const groupId = citationGroupNodeId(citation)
      graph.addNode({
        id: citationId,
        kind: 'citation-occurrence',
        label: sourcePath + ':' + citation.location.line,
        path: sourcePath,
        location: citation.location,
        parentId: groupId,
      })
      graph.addEdge({ kind: 'contains', from: groupId, to: citationId })
    }
  }

  for (const [bibPath, bibliography] of bibByPath) {
    for (const entry of bibliography.entries) {
      relationNode(graph, 'bibliography-entry', entry, bibPath, entry.key)
    }
  }

  const selectedRoots = snapshot.entryPointIds
    .map(id => entityById.get(id))
    .filter(Boolean)
  const scopes = selectedRoots.map(root => ({
    root,
    ...collectScope(root.path, latexByPath, relationsByPath, bibByPath),
  }))
  const reachableDocuments = new Set()
  const reachableImages = new Set()
  const reachableBibliographies = new Set()
  const usedLabels = new Set()
  const usedBibliographyEntries = new Set()
  const createdCitationGroups = new Set()
  const resolvedCitationGroups = new Set()
  const includeAdjacency = new Map()

  for (const scope of scopes) {
    for (const value of scope.documents) reachableDocuments.add(value)
    for (const value of scope.images) reachableImages.add(value)
    for (const value of scope.bibliographies) reachableBibliographies.add(value)

    const labelsByKey = new Map()
    const captionsByKind = {
      figure: new Map(),
      table: new Map(),
    }
    const entriesByKey = new Map()
    const entriesByTitle = new Map()
    const references = []
    const citations = []
    let labelsIncomplete = false

    for (const sourcePath of scope.documents) {
      const parsed = latexByPath.get(sourcePath)
      const relations = relationsByPath.get(sourcePath)
      if (!includeAdjacency.has(sourcePath)) includeAdjacency.set(sourcePath, [])

      for (const relation of relations.includes) {
        if (
          relation.resolution.status === 'resolved' &&
          scope.documents.has(relation.resolution.path)
        ) {
          includeAdjacency.get(sourcePath).push(relation.resolution.path)
        }
      }

      for (const [type, items] of [
        ['missing-file', relations.includes],
        ['missing-figure', relations.figures],
        ['missing-bibliography', relations.bibliographies],
      ]) {
        for (const item of items) {
          if (item.resolution.status !== 'missing') continue
          const kind = type.replace('missing-', '')
          const commandId =
            type === 'missing-figure'
              ? figureResourceNodeId(item)
              : occurrenceNodeId(
                  kind === 'file' ? 'include' : kind,
                  item.location,
                  item.target
                )
          const missingId = `missing:${kind === 'file' ? 'include' : kind}:${sourcePath}:${item.target}`
          const nodeIds =
            type === 'missing-figure'
              ? [commandId]
              : [commandId, missingId]
          addIssue(
            componentIssueKey(type, item.target),
            {
              type,
              status: 'missing',
              category: kind,
              target: item.target,
              locations: [item.location],
              nodeIds,
            },
            scope.root.id,
            ['missing']
          )
        }
      }

      for (const label of parsed.labels) {
        const values = labelsByKey.get(label.key) ?? []
        values.push(label)
        labelsByKey.set(label.key, values)
      }
      for (const environment of parsed.environments) {
        for (const caption of environment.captions) {
          const normalized = normalizedCaption(caption.value)
          if (!normalized) continue
          const captions = captionsByKind[environment.kind]
          const values = captions.get(normalized) ?? []
          values.push({
            caption,
            environment,
          })
          captions.set(normalized, values)
        }
      }
      references.push(...parsed.references)
      citations.push(...parsed.citations)
      labelsIncomplete ||= parsed.dynamicReferences.some(
        reference => reference.kind === 'label'
      )
      for (const entry of parsed.bibliographyEntries) {
        collectBibliographyEntry(entriesByKey, entriesByTitle, entry)
      }
    }

    for (const bibPath of scope.bibliographies) {
      const bibliography = bibByPath.get(bibPath)
      if (!bibliography || bibliography.unavailable) continue
      for (const entry of bibliography.entries) {
        collectBibliographyEntry(entriesByKey, entriesByTitle, entry)
      }
    }

    for (const [key, definitions] of labelsByKey) {
      if (definitions.length < 2) continue
      const nodeIds = definitions.map(definition =>
        occurrenceNodeId('label', definition.location, definition.key)
      )
      addIssue(
        componentIssueKey('duplicate-label', key),
        {
          type: 'duplicate-label',
          status: 'duplicate',
          category: 'label',
          target: key,
          locations: definitions.map(item => item.location),
          nodeIds,
        },
        scope.root.id,
        ['duplicate']
      )
    }

    for (const kind of ['figure', 'table']) {
      for (const [normalizedValue, definitions] of captionsByKind[kind]) {
        if (definitions.length < 2) continue
        const type = `duplicate-${kind}-caption`
        addIssue(
          componentIssueKey(type, normalizedValue),
          {
            type,
            status: 'duplicate',
            category: kind,
            target: definitions[0].caption.value,
            locations: definitions.map(item => item.caption.location),
            nodeIds: definitions.map(item =>
              environmentNodeId(item.environment)
            ),
          },
          scope.root.id,
          ['duplicate']
        )
      }
    }

    for (const reference of references) {
      const definitions = labelsByKey.get(reference.key) ?? []
      const referenceId = occurrenceNodeId(
        'reference',
        reference.location,
        reference.key
      )
      if (definitions.length === 0) {
        attachNodeToFile(graph, referenceId, reference.location.path)
        if (!labelsIncomplete) {
          addIssue(
            componentIssueKey('missing-reference', reference.key),
            {
              type: 'missing-reference',
              status: 'missing',
              category: 'reference',
              target: reference.key,
              locations: [reference.location],
              nodeIds: [referenceId],
            },
            scope.root.id,
            ['missing']
          )
        }
        continue
      }

      graph.addNode({
        id: referenceId,
        label: `${reference.location.path}:${reference.location.line}`,
      })
      for (const definition of definitions) {
        const labelId = occurrenceNodeId(
          'label',
          definition.location,
          definition.key
        )
        usedLabels.add(labelId)
        graph.addEdge({
          kind: 'references',
          from: labelId,
          to: referenceId,
        })
      }
    }

    const duplicateKeyEntrySignatures = new Set()
    for (const [key, entries] of entriesByKey) {
      if (entries.length < 2) continue
      const entrySignature = bibliographyEntrySignature(entries)
      duplicateKeyEntrySignatures.add(entrySignature)
      const nodeIds = entries.map(entry =>
        occurrenceNodeId('bibliography-entry', entry.location, entry.key)
      )
      addIssue(
        componentIssueKey('duplicate-bibliography-key', key),
        {
          type: 'duplicate-bibliography-key',
          status: 'duplicate',
          category: 'bibliography',
          target: key,
          locations: entries.map(item => item.location),
          nodeIds,
        },
        scope.root.id,
        ['duplicate', 'citationDuplicate']
      )
    }

    for (const [normalizedTitle, entries] of entriesByTitle) {
      if (entries.length < 2) continue
      const entrySignature = bibliographyEntrySignature(entries)
      if (duplicateKeyEntrySignatures.has(entrySignature)) continue
      const nodeIds = entries.map(entry =>
        occurrenceNodeId('bibliography-entry', entry.location, entry.key)
      )
      addIssue(
        componentIssueKey('duplicate-bibliography-title', normalizedTitle),
        {
          type: 'duplicate-bibliography-title',
          status: 'duplicate',
          category: 'bibliography',
          target: entries[0].displayTitle,
          locations: entries.map(item => item.titleLocation),
          nodeIds,
        },
        scope.root.id,
        ['duplicate', 'citationDuplicate']
      )
    }

    const citeAll = citations.some(item => item.nocite && item.key === '*')
    if (citeAll) {
      for (const entries of entriesByKey.values()) {
        for (const entry of entries) {
          usedBibliographyEntries.add(
            occurrenceNodeId('bibliography-entry', entry.location, entry.key)
          )
        }
      }
    }
    for (const citation of citations) {
      if (citation.key === '*') continue
      const entries = entriesByKey.get(citation.key) ?? []
      const groupId = citationGroupNodeId(citation)
      if (
        !createdCitationGroups.has(groupId) ||
        (!resolvedCitationGroups.has(groupId) && entries.length > 0)
      ) {
        graph.addNode({
          id: groupId,
          kind: 'citation',
          label: citation.key,
          path: citation.location.path,
          location: entries[0]?.location ?? citation.location,
          parentId: fileNodeId(citation.location.path),
        })
        createdCitationGroups.add(groupId)
        if (entries.length > 0) resolvedCitationGroups.add(groupId)
      }
      graph.addEdge({
        kind: 'contains',
        from: fileNodeId(citation.location.path),
        to: groupId,
      })
      if (entries.length === 0 && !scope.bibliographyIncomplete) {
        addIssue(
          componentIssueKey('missing-citation', citation.key),
          {
            type: 'missing-citation',
            status: 'missing',
            category: 'citation',
            target: citation.key,
            locations: [citation.location],
            nodeIds: [groupId],
          },
          scope.root.id,
          ['missing', 'citationMissing']
        )
      }
      for (const entry of entries) {
        const entryId = occurrenceNodeId(
          'bibliography-entry',
          entry.location,
          entry.key
        )
        usedBibliographyEntries.add(entryId)
      }
    }

    const scopeCycles = findCycles([...scope.documents], includeAdjacency)
    for (const cycle of scopeCycles) {
      const nodeIds = cycle.files.map(fileNodeId)
      const cycleEdges = buildCycleEdges(cycle, relationsByPath)
      addIssue(
        componentIssueKey('circular-dependency', cycle.files.join('|')),
        {
          type: 'circular-dependency',
          status: 'circular',
          category: 'file',
          target: cycle.path.slice(0, -1).join(' ↔ '),
          locations: [],
          nodeIds,
          cycleEdges,
        },
        scope.root.id,
        ['circular']
      )
    }
  }

  const reachableDynamicKinds = new Set(
    [...reachableDocuments].flatMap(sourcePath =>
      latexByPath
        .get(sourcePath)
        .dynamicReferences.map(reference => reference.kind)
    )
  )

  for (const sourcePath of reachableDocuments) {
    const parsed = latexByPath.get(sourcePath)
    for (const label of parsed.labels) {
      const nodeId = occurrenceNodeId('label', label.location, label.key)
      if (
        usedLabels.has(nodeId) ||
        reachableDynamicKinds.has('reference')
      ) {
        continue
      }
      addIssue(
        componentIssueKey('unreferenced-label', label.key),
        {
          type: 'unreferenced-label',
          status: 'unreferenced',
          category: 'label',
          target: label.key,
          locations: [label.location],
          nodeIds: [nodeId],
        },
        null,
        ['unused']
      )
    }
    for (const environment of parsed.environments) {
      const nodeId = occurrenceNodeId(
        environment.kind,
        environment.location,
        environment.name
      )
      if (environment.labels.length === 0) {
        const type = `unlabeled-${environment.kind}`
        addIssue(
          `${type}:${environment.location.entityId}:${environment.location.from}`,
          {
            type,
            status: 'unreferenced',
            category: environment.kind,
            target: environment.name,
            locations: [environment.location],
            nodeIds: [nodeId],
          },
          null,
          ['unused']
        )
      } else if (
        !reachableDynamicKinds.has('reference') &&
        environment.labels.every(labelKey => {
          const label = parsed.labels.find(item => item.key === labelKey)
          return (
            !label ||
            !usedLabels.has(
              occurrenceNodeId('label', label.location, label.key)
            )
          )
        })
      ) {
        const type = `unreferenced-${environment.kind}`
        addIssue(
          `${type}:${environment.location.entityId}:${environment.location.from}`,
          {
            type,
            status: 'unreferenced',
            category: environment.kind,
            target: environment.labels.join(', '),
            locations: [environment.location],
            nodeIds: [nodeId],
          },
          null,
          ['unused']
        )
      }
    }
  }

  for (const bibPath of reachableBibliographies) {
    const bibliography = bibByPath.get(bibPath)
    if (!bibliography || bibliography.unavailable) continue
    for (const entry of bibliography.entries) {
      const nodeId = occurrenceNodeId(
        'bibliography-entry',
        entry.location,
        entry.key
      )
      if (
        usedBibliographyEntries.has(nodeId) ||
        reachableDynamicKinds.has('citation')
      ) {
        continue
      }
      addIssue(
        componentIssueKey('unused-bibliography-entry', entry.key),
        {
          type: 'unused-bibliography-entry',
          status: 'unused',
          category: 'bibliography',
          target: entry.key,
          locations: [entry.location],
          nodeIds: [nodeId],
        },
        null,
        ['unused', 'citationUnused']
      )
    }
  }

  for (const sourcePath of reachableDocuments) {
    const parsed = latexByPath.get(sourcePath)
    for (const entry of parsed.bibliographyEntries) {
      const nodeId = occurrenceNodeId(
        'bibliography-entry',
        entry.location,
        entry.key
      )
      if (
        usedBibliographyEntries.has(nodeId) ||
        reachableDynamicKinds.has('citation')
      ) {
        continue
      }
      addIssue(
        componentIssueKey('unused-bibliography-entry', entry.key),
        {
          type: 'unused-bibliography-entry',
          status: 'unused',
          category: 'bibliography',
          target: entry.key,
          locations: [entry.location],
          nodeIds: [nodeId],
        },
        null,
        ['unused', 'citationUnused']
      )
    }
  }

  for (const entity of entities) {
    if (
      IMAGE_EXTENSIONS.includes(extension(entity.path)) &&
      !reachableImages.has(entity.path) &&
      !reachableDynamicKinds.has('includegraphics') &&
      !reachableDynamicKinds.has('includesvg') &&
      !reachableDynamicKinds.has('graphicspath')
    ) {
      addIssue(
        componentIssueKey('unreferenced-figure', entity.path),
        {
          type: 'unreferenced-figure',
          status: 'unreferenced',
          category: 'figure',
          target: entity.path,
          locations: [],
          nodeIds: [fileNodeId(entity.path)],
        },
        null,
        ['unused']
      )
    }

    const eligible = isTexLike(entity.path) || isBibliography(entity.path)
    const reachable =
      reachableDocuments.has(entity.path) ||
      reachableBibliographies.has(entity.path)
    if (eligible && !reachable) {
      addIssue(
        componentIssueKey('possibly-unused-file', entity.path),
        {
          type: 'possibly-unused-file',
          status: 'unused',
          category: 'file',
          target: entity.path,
          locations: [],
          nodeIds: [fileNodeId(entity.path)],
        },
        null,
        ['unused']
      )
    }
  }

  const cycles = findCycles([...reachableDocuments], includeAdjacency)
  const finalized = issues.finalize()
  for (const issue of Object.values(finalized.byId)) {
    graph.markNodes(issue.nodeIds, issue.status)
  }
  const idsFor = group =>
    [...issueGroups[group]]
      .map(key => finalized.keyToId.get(key))
      .filter(Boolean)

  const reachableEntityPaths = new Set([
    ...reachableDocuments,
    ...reachableImages,
    ...reachableBibliographies,
  ])
  const reachableLatex = [...reachableDocuments]
    .map(filePath => latexByPath.get(filePath))
    .filter(Boolean)
  const dynamicReferences = reachableLatex.flatMap(item =>
    item.dynamicReferences.map(reference => ({
      ...reference,
      sourcePath: item.path,
    }))
  )
  const parseErrors = [
    ...reachableLatex,
    ...[...reachableBibliographies]
      .map(filePath => bibByPath.get(filePath))
      .filter(Boolean),
  ]
    .filter(item => item.parseErrorCount > 0)
    .map(item => ({ path: item.path, count: item.parseErrorCount }))
  const skippedFiles = [...bibByPath.values()]
    .filter(
      item => item.unavailable && reachableBibliographies.has(item.path)
    )
    .map(item => ({ path: item.path, reason: item.skippedReason }))
  const reachableAmbiguousReferences = ambiguousReferences.filter(item =>
    reachableDocuments.has(item.location.path)
  )

  return {
    entryPoints: selectedRoots.map(root => ({ id: root.id, path: root.path })),
    overview: {
      fileCount: reachableEntityPaths.size,
      figureCount: reachableLatex.reduce(
        (count, item) =>
          count + item.environments.filter(env => env.kind === 'figure').length,
        0
      ),
      tableCount: reachableLatex.reduce(
        (count, item) =>
          count + item.environments.filter(env => env.kind === 'table').length,
        0
      ),
      citationCount: reachableLatex.reduce(
        (count, item) => count + item.citations.length,
        0
      ),
      missing: idsFor('missing').length,
      unusedUnreferenced: idsFor('unused').length,
      duplicate: idsFor('duplicate').length,
      circular: idsFor('circular').length,
    },
    graph: graph.serialize({
      roots: selectedRoots.map(root => fileNodeId(root.path)),
      cycles: cycles.map(cycle => cycle.path.map(fileNodeId)),
    }),
    issues: { byId: finalized.byId, truncated: finalized.truncated },
    views: {
      missing: idsFor('missing'),
      unused: idsFor('unused'),
      duplicate: idsFor('duplicate'),
      circular: idsFor('circular'),
      citation: {
        missing: idsFor('citationMissing'),
        unused: idsFor('citationUnused'),
        duplicate: idsFor('citationDuplicate'),
      },
    },
    coverage: {
      parsedFiles: reachableLatex.length + reachableBibliographies.size,
      parseErrors,
      dynamicReferences: dynamicReferences.slice(0, 500),
      ambiguousReferences: reachableAmbiguousReferences.slice(0, 500),
      skippedFiles,
      suppressedCitationChecks: scopes
        .filter(scope => scope.bibliographyIncomplete)
        .map(scope => scope.root.id),
      truncated:
        dynamicReferences.length > 500 ||
        reachableAmbiguousReferences.length > 500 ||
        finalized.truncated,
    },
  }
}

export default analyzeProject
