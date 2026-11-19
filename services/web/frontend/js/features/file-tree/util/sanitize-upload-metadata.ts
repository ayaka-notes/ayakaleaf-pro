export function sanitizeUploadMetadata(name: string, relativePath?: string) {
  const sanitizedName = name.trim()

  if (!relativePath || relativePath === 'null') {
    return { name: sanitizedName, relativePath }
  }

  const trimmedPath = relativePath.trim()
  const isAbsolute = trimmedPath.startsWith('/')
  const segments: string[] = []

  for (const segment of trimmedPath.split('/')) {
    if (!segment || segment === '.') {
      continue
    }
    if (segment === '..') {
      segments.pop()
    } else {
      segments.push(segment)
    }
  }

  return {
    name: sanitizedName,
    relativePath: `${isAbsolute ? '/' : ''}${segments.join('/')}`,
  }
}

type UploadDestinationFile = {
  name: string
  meta: {
    name?: string
    relativePath?: string
    targetFolderId?: string
  }
}

export function sortUploadFilesByName<T extends UploadDestinationFile>(
  files: Record<string, T>,
  defaultTargetFolderId: string
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(files).sort(([firstId, first], [secondId, second]) => {
      const byName = (first.meta.name ?? first.name).localeCompare(
        second.meta.name ?? second.name
      )
      if (byName !== 0) {
        return byName
      }

      const firstTargetFolderId =
        first.meta.targetFolderId ?? defaultTargetFolderId
      const secondTargetFolderId =
        second.meta.targetFolderId ?? defaultTargetFolderId
      const byTargetFolder =
        firstTargetFolderId.localeCompare(secondTargetFolderId)
      if (byTargetFolder !== 0) {
        return byTargetFolder
      }

      const firstRelativePath = first.meta.relativePath ?? ''
      const secondRelativePath = second.meta.relativePath ?? ''
      const byRelativePath = firstRelativePath.localeCompare(secondRelativePath)
      return byRelativePath || firstId.localeCompare(secondId)
    })
  )
}

export function findDuplicateUploadDestinations(
  files: Record<string, UploadDestinationFile>,
  defaultTargetFolderId: string
): string[] {
  const destinations = new Map<string, { path: string; count: number }>()

  for (const file of Object.values(files)) {
    const { name: metadataName, relativePath, targetFolderId } = file.meta
    const name = metadataName ?? file.name
    const relativeDirectory =
      relativePath && relativePath !== 'null'
        ? relativePath.replace(/^\//, '').split('/').slice(0, -1).join('/')
        : ''
    const destination = JSON.stringify([
      targetFolderId ?? defaultTargetFolderId,
      relativeDirectory.toLowerCase(),
      name,
    ])
    const path = relativeDirectory ? `${relativeDirectory}/${name}` : name
    const existing = destinations.get(destination)

    if (existing) {
      existing.count += 1
    } else {
      destinations.set(destination, { path, count: 1 })
    }
  }

  return [...destinations.values()]
    .filter(destination => destination.count > 1)
    .map(destination => destination.path)
}
