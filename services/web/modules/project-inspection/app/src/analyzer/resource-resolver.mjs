import path from 'node:path'

const URL_OR_ABSOLUTE_PATH = /^(?:[a-z][a-z0-9+.-]*:|\/)/i

function normalizeCandidate(value) {
  const normalized = path.posix.normalize(value.replace(/^\.\//, ''))
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    return null
  }
  return normalized.replace(/^\/+/, '')
}

export function isDynamicTarget(target) {
  return (
    !target ||
    URL_OR_ABSOLUTE_PATH.test(target) ||
    /[\\#{}]/.test(target)
  )
}

export function resolveProjectPath({
  target,
  sourcePath,
  availablePaths,
  extensions = [],
  additionalRoots = [],
}) {
  if (isDynamicTarget(target)) {
    return { status: 'dynamic', candidates: [] }
  }

  const sourceDirectory = path.posix.dirname(sourcePath)
  const roots = [
    '',
    ...(sourceDirectory === '.' ? [] : [sourceDirectory]),
    ...additionalRoots.flatMap(root => {
      const fromRoot = normalizeCandidate(root)
      const fromSource = normalizeCandidate(path.posix.join(sourceDirectory, root))
      return [fromRoot, fromSource].filter(Boolean)
    }),
  ]
  const suffixes = path.posix.extname(target) ? [''] : ['', ...extensions]
  const candidates = []

  for (const root of roots) {
    for (const suffix of suffixes) {
      const candidate = normalizeCandidate(
        path.posix.join(root, `${target}${suffix}`)
      )
      if (
        candidate &&
        availablePaths.has(candidate) &&
        !candidates.includes(candidate)
      ) {
        candidates.push(candidate)
      }
    }
  }

  if (candidates.length === 1) {
    return { status: 'resolved', path: candidates[0], candidates }
  }
  if (candidates.length > 1) {
    return { status: 'ambiguous', candidates }
  }
  return { status: 'missing', candidates: [] }
}
