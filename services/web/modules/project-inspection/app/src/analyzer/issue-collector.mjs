const STATUS_PRIORITY = {
  normal: 0,
  unused: 1,
  unreferenced: 1,
  duplicate: 2,
  missing: 3,
  circular: 4,
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))]
}

export class IssueCollector {
  constructor() {
    this.issues = new Map()
  }

  add(key, issue, entryPointId) {
    const existing = this.issues.get(key)
    if (!existing) {
      this.issues.set(key, {
        ...issue,
        locations: [...(issue.locations || [])],
        nodeIds: unique(issue.nodeIds),
        entryPoints: entryPointId ? [entryPointId] : [],
        cycleEdges: issue.cycleEdges ? [...issue.cycleEdges] : undefined,
      })
      return
    }

    existing.locations.push(...(issue.locations || []))
    existing.nodeIds = unique([...existing.nodeIds, ...(issue.nodeIds || [])])
    existing.entryPoints = unique([
      ...existing.entryPoints,
      ...(entryPointId ? [entryPointId] : []),
    ])
    if (issue.cycleEdges?.length) {
      existing.cycleEdges = [
        ...(existing.cycleEdges || []),
        ...issue.cycleEdges,
      ]
    }
    if (
      (STATUS_PRIORITY[issue.status] || 0) >
      (STATUS_PRIORITY[existing.status] || 0)
    ) {
      existing.status = issue.status
    }
  }

  finalize(maxIssues = 5000) {
    const sorted = [...this.issues.entries()].sort(([keyA], [keyB]) =>
      keyA.localeCompare(keyB)
    )
    const byId = {}
    const keyToId = new Map()
    let truncated = sorted.length > maxIssues

    sorted.slice(0, maxIssues).forEach(([key, issue], index) => {
      const id = `issue-${index + 1}`
      const locations = deduplicateLocations(issue.locations)
      if (locations.length > 200) truncated = true
      keyToId.set(key, id)
      byId[id] = {
        id,
        ...issue,
        locations: locations.slice(0, 200),
        nodeIds: unique(issue.nodeIds),
        entryPoints: unique(issue.entryPoints),
        cycleEdges: issue.cycleEdges
          ? deduplicateCycleEdges(issue.cycleEdges)
          : undefined,
      }
    })

    return { byId, keyToId, truncated }
  }
}

function deduplicateLocations(locations) {
  const seen = new Set()
  return locations
    .filter(location => {
      const key = `${location.entityId}:${location.from}:${location.to}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    .sort(compareLocations)
}

function compareLocations(left, right) {
  return (
    left.path.localeCompare(right.path) ||
    left.line - right.line ||
    left.column - right.column ||
    left.from - right.from
  )
}

function deduplicateCycleEdges(cycleEdges) {
  const seen = new Set()
  return cycleEdges
    .filter(edge => {
      const { location } = edge
      const key = JSON.stringify([
        edge.from,
        edge.to,
        location.entityId,
        location.from,
        location.to,
      ])
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => compareLocations(left.location, right.location))
}
