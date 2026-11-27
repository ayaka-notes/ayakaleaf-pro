/**
 * Pure helpers for the Toast Image editor module (Filerobot Image Editor).
 *
 * Kept free of React/browser-context dependencies so they can be unit-tested
 * in Node (`modules/toast-image/test/unit`).
 */

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif']

export function fileExtension(name: string): string | null {
  const idx = name.lastIndexOf('.')
  if (idx <= 0 || idx === name.length - 1) {
    return null
  }
  return name.slice(idx + 1).toLowerCase()
}

export function isEditableImage(name: string): boolean {
  const ext = fileExtension(name)
  return !!ext && IMAGE_EXTENSIONS.includes(ext)
}

/**
 * Output format for the edited image (png for .png, jpeg for everything
 * else — the save container follows the original file type).
 */
export function outputFormatForName(name: string): 'png' | 'jpeg' {
  return fileExtension(name) === 'png' ? 'png' : 'jpeg'
}

export interface TreeNode {
  _id?: string
  name?: string
  docs?: TreeNode[]
  fileRefs?: TreeNode[]
  folders?: TreeNode[]
  [key: string]: unknown
}

/** Recursively find the parent folder ID for a given entity in a file tree. */
export function findParentFolderId(
  node: TreeNode,
  entityId: string
): string | null {
  if (node.docs?.some(d => d._id === entityId)) return node._id ?? null
  if (node.fileRefs?.some(f => f._id === entityId)) return node._id ?? null
  for (const sub of node.folders ?? []) {
    if (sub._id === entityId) return node._id ?? null
    const found = findParentFolderId(sub, entityId)
    if (found) return found
  }
  return null
}

export function findFileRefById(node: TreeNode, fileId: string): TreeNode | null {
  const direct = node.fileRefs?.find(f => f._id === fileId)
  if (direct) return direct
  for (const sub of node.folders ?? []) {
    const found = findFileRefById(sub, fileId)
    if (found) return found
  }
  return null
}

/**
 * Heuristic: has the Filerobot Image Editor actually rendered inside this
 * host element? FIE's app root uses stable `FIE_*` class prefixes and the
 * canvas is the editing surface. Used by the mount backstop so a healthy
 * editor is never killed by the watchdog, and by the refresh logic to
 * detect a live editor.
 */
export function looksLikeEditorMounted(
  host: { querySelector(sel: string): Element | null } | null
): boolean {
  if (!host) return false
  try {
    return host.querySelector('canvas, [class*="FIE_"]') !== null
  } catch {
    return false
  }
}

/**
 * Find a file node by name (used to re-select a replaced file after the
 * realtime tree updates). When `avoidHash` is given, a node with a different
 * hash (the freshly uploaded one) is preferred over the stale reference.
 */
export function findFileRefByName(
  node: TreeNode,
  name: string,
  avoidHash?: string
): TreeNode | null {
  const inList = (list: TreeNode[] | undefined): TreeNode | null => {
    if (!list) return null
    const exactHash = list.find(
      f => f.name === name && f._id && (!avoidHash || f.hash !== avoidHash)
    )
    if (exactHash) return exactHash
    // Stale reference with the same name (tree not updated yet) is a
    // fallback — better than no selection at all.
    return list.find(f => f.name === name) ?? null
  }
  const direct = inList(node.fileRefs)
  if (direct) return direct
  for (const sub of node.folders ?? []) {
    const found = findFileRefByName(sub, name, avoidHash)
    if (found) return found
  }
  return null
}
