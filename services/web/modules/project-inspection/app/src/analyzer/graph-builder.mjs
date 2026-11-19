const STATUS_PRIORITY = {
  normal: 0,
  unused: 1,
  unreferenced: 1,
  duplicate: 2,
  missing: 3,
  circular: 4,
}

export class GraphBuilder {
  constructor() {
    this.nodes = new Map()
    this.edges = new Map()
  }

  addNode(node) {
    const existing = this.nodes.get(node.id)
    if (!existing) {
      this.nodes.set(node.id, { status: 'normal', ...node })
      return node.id
    }
    this.nodes.set(node.id, { ...existing, ...node, status: existing.status })
    return node.id
  }

  addEdge(edge) {
    const id = edge.id || `${edge.kind}:${edge.from}:${edge.to}`
    if (!this.edges.has(id)) {
      this.edges.set(id, { ...edge, id })
    }
    return id
  }

  markNodes(nodeIds, status) {
    for (const nodeId of nodeIds || []) {
      const node = this.nodes.get(nodeId)
      if (
        node &&
        (STATUS_PRIORITY[status] || 0) >
          (STATUS_PRIORITY[node.status] || 0)
      ) {
        node.status = status
      }
    }
  }

  serialize({ roots, cycles, maxNodes = 5000, maxEdges = 10000 }) {
    const sortedNodes = [...this.nodes.values()].sort((a, b) =>
      a.id.localeCompare(b.id)
    )
    const sortedEdges = [...this.edges.values()].sort((a, b) =>
      a.id.localeCompare(b.id)
    )
    const outgoing = new Map()
    for (const edge of sortedEdges) {
      const edges = outgoing.get(edge.from) ?? []
      edges.push(edge)
      outgoing.set(edge.from, edges)
    }

    const orderedIds = []
    const visited = new Set()
    const queue = [...roots]
    while (queue.length > 0) {
      const nodeId = queue.shift()
      if (visited.has(nodeId) || !this.nodes.has(nodeId)) continue
      visited.add(nodeId)
      orderedIds.push(nodeId)
      for (const edge of outgoing.get(nodeId) ?? []) queue.push(edge.to)
    }
    for (const node of sortedNodes) {
      if (!visited.has(node.id)) orderedIds.push(node.id)
    }

    const allNodes = orderedIds.map(nodeId => this.nodes.get(nodeId))
    const includedNodes = allNodes.slice(0, maxNodes)
    const includedIds = new Set(includedNodes.map(node => node.id))
    const eligibleEdges = sortedEdges.filter(
      edge => includedIds.has(edge.from) && includedIds.has(edge.to)
    )
    const includedEdges = eligibleEdges.slice(0, maxEdges)

    return {
      roots: roots.filter(root => includedIds.has(root)),
      nodes: includedNodes,
      edges: includedEdges,
      cycles: cycles.filter(cycle =>
        cycle.every(nodeId => includedIds.has(nodeId))
      ),
      truncated:
        includedNodes.length < allNodes.length ||
        includedEdges.length < eligibleEdges.length,
    }
  }
}
