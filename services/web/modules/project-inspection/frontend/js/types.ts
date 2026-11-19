export type InspectionStatus =
  | 'normal'
  | 'missing'
  | 'unused'
  | 'unreferenced'
  | 'duplicate'
  | 'circular'

export type SourceLocation = {
  entityId: string
  path: string
  line: number
  column: number
  from: number
  to: number
  sourceText?: string
}

export type InspectionIssue = {
  id: string
  type: string
  status: InspectionStatus
  category: string
  title: string
  target?: string
  locations: SourceLocation[]
  entryPoints: string[]
  nodeIds: string[]
  cycleEdges?: Array<{
    from: string
    to: string
    location: SourceLocation
  }>
}

export type InspectionGraphNode = {
  id: string
  kind: string
  label: string
  status: InspectionStatus
  path?: string
  entityId?: string
  parentId?: string
  location?: SourceLocation
}

export type InspectionGraphEdge = {
  id: string
  kind: string
  from: string
  to: string
}

export type ProjectInspectionResult = {
  schemaVersion: number
  analysisId: string
  analyzedAt: string
  entryPoints: Array<{ id: string; path: string }>
  overview: {
    fileCount: number
    figureCount: number
    tableCount: number
    citationCount: number
    missing: number
    unusedUnreferenced: number
    duplicate: number
    circular: number
  }
  graph: {
    roots: string[]
    nodes: InspectionGraphNode[]
    edges: InspectionGraphEdge[]
    cycles: string[][]
    truncated: boolean
  }
  issues: { byId: Record<string, InspectionIssue>; truncated: boolean }
  views: {
    missing: string[]
    unused: string[]
    duplicate: string[]
    circular: string[]
    citation: {
      missing: string[]
      unused: string[]
      duplicate: string[]
    }
  }
  coverage: {
    parsedFiles: number
    parseErrors: Array<{ path: string; count: number }>
    dynamicReferences: unknown[]
    ambiguousReferences: unknown[]
    skippedFiles: Array<{ path: string; reason: string }>
    suppressedCitationChecks: string[]
    truncated: boolean
  }
}
