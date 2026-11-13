export function createLineIndex(source) {
  const lineStarts = [0]
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 10) lineStarts.push(index + 1)
  }
  return lineStarts
}

function findLineIndex(lineStarts, offset) {
  let low = 0
  let high = lineStarts.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (lineStarts[middle] <= offset) {
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return Math.max(0, high)
}

export function createLocation(
  source,
  lineStarts,
  { entityId, path, from, to }
) {
  const lineIndex = findLineIndex(lineStarts, from)
  const safeTo = Math.max(from, Math.min(to, source.length))
  return {
    entityId,
    path,
    line: lineIndex + 1,
    column: from - lineStarts[lineIndex],
    from,
    to: safeTo,
    sourceText: source.slice(from, safeTo).replace(/\s+/g, ' ').slice(0, 240),
  }
}
