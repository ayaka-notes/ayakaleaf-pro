export function normalizeStrokes(strokes, coordinateSpace) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const stroke of strokes) {
    for (const [x, y] of stroke) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (minX === maxX && minY === maxY) {
    return strokes.map(stroke =>
      stroke.map(() => [coordinateSpace / 2, coordinateSpace / 2])
    )
  }

  const width = maxX - minX || 1
  const height = maxY - minY || 1
  const scale = coordinateSpace / Math.max(width, height)
  const offsetX = (coordinateSpace - width * scale) / 2
  const offsetY = (coordinateSpace - height * scale) / 2
  return strokes.map(stroke =>
    stroke.map(([x, y]) => [
      (x - minX) * scale + offsetX,
      (y - minY) * scale + offsetY,
    ])
  )
}

export function rasterizeStrokes(strokes, config) {
  const size = config.imageSize
  const renderSize = size * config.supersample
  const canvas = new OffscreenCanvas(renderSize, renderSize)
  const context = canvas.getContext('2d')

  const gray = value => `rgb(${value}, ${value}, ${value})`
  context.fillStyle = gray(config.background)
  context.fillRect(0, 0, renderSize, renderSize)
  context.strokeStyle = context.fillStyle = gray(config.foreground)
  context.lineWidth = Math.max(
    1,
    Math.floor(renderSize / config.lineWidthDivisor)
  )
  context.lineJoin = 'round'
  context.lineCap = 'butt'

  const margin = renderSize * config.margin
  const scale = (renderSize * (1 - 2 * config.margin)) / config.coordinateSpace
  for (const stroke of normalizeStrokes(strokes, config.coordinateSpace)) {
    const points = stroke.map(([x, y]) => [
      x * scale + margin,
      y * scale + margin,
    ])
    context.beginPath()
    if (points.length === 1) {
      context.arc(...points[0], context.lineWidth / 2, 0, 2 * Math.PI)
      context.fill()
    } else {
      context.moveTo(...points[0])
      for (const point of points.slice(1)) context.lineTo(...point)
      context.stroke()
    }
  }

  const output = new OffscreenCanvas(size, size).getContext('2d')
  // Match the browser rasterisation used by the original model, including its
  // supersampling; a different stroke width materially changes predictions.
  output.imageSmoothingEnabled = true
  output.imageSmoothingQuality = 'high'
  output.drawImage(canvas, 0, 0, size, size)
  const { data } = output.getImageData(0, 0, size, size)
  return Float32Array.from({ length: size * size }, (_, index) => {
    const value = data[index * 4] * config.normalization.scale
    return config.normalization.invert ? 1 - value : value
  })
}

export function rankCandidates(logits, labels, count) {
  if (logits.length !== labels.length) {
    throw new Error('The model output does not match its symbol labels')
  }
  return labels
    .map((label, index) => ({ label, logit: logits[index] }))
    .sort((a, b) => b.logit - a.logit)
    .slice(0, count)
    .map(({ label }) => label)
}
