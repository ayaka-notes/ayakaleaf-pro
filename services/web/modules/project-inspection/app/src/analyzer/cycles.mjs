export function findStronglyConnectedComponents(nodes, adjacency) {
  let index = 0
  const stack = []
  const onStack = new Set()
  const indices = new Map()
  const lowLinks = new Map()
  const components = []

  function visit(node) {
    indices.set(node, index)
    lowLinks.set(node, index)
    index++
    stack.push(node)
    onStack.add(node)

    for (const neighbor of adjacency.get(node) ?? []) {
      if (!indices.has(neighbor)) {
        visit(neighbor)
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node), lowLinks.get(neighbor))
        )
      } else if (onStack.has(neighbor)) {
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node), indices.get(neighbor))
        )
      }
    }

    if (lowLinks.get(node) === indices.get(node)) {
      const component = []
      let current
      do {
        current = stack.pop()
        onStack.delete(current)
        component.push(current)
      } while (current !== node)
      components.push(component)
    }
  }

  for (const node of nodes) {
    if (!indices.has(node)) visit(node)
  }
  return components
}

function representativeCycle(component, adjacency) {
  const allowed = new Set(component)
  const start = component[0]
  const path = []
  const inPath = new Set()

  function search(node) {
    path.push(node)
    inPath.add(node)
    for (const neighbor of adjacency.get(node) ?? []) {
      if (!allowed.has(neighbor)) continue
      if (neighbor === start) return [...path, start]
      if (!inPath.has(neighbor)) {
        const result = search(neighbor)
        if (result) return result
      }
    }
    path.pop()
    inPath.delete(node)
    return null
  }

  return search(start) ?? [...component, component[0]]
}

export function findCycles(nodes, adjacency) {
  return findStronglyConnectedComponents(nodes, adjacency)
    .filter(
      component =>
        component.length > 1 ||
        (adjacency.get(component[0]) ?? []).includes(component[0])
    )
    .map((component, index) => ({
      id: `cycle-${index + 1}`,
      files: [...component].sort(),
      path: representativeCycle(component, adjacency),
    }))
}
