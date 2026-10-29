/**
 * Pure helpers for the SVG editor module (embedded SVG-Edit app).
 *
 * Kept free of React/browser-context dependencies so they can be
 * unit-tested in Node (`modules/svgeditor/test/unit`).
 */

export const SVG_EXTENSIONS = ['svg']

export function fileExtension(name: string): string | null {
  const idx = name.lastIndexOf('.')
  if (idx <= 0 || idx === name.length - 1) {
    return null
  }
  return name.slice(idx + 1).toLowerCase()
}

export function isSvgFile(name: string): boolean {
  return !!fileExtension(name) && SVG_EXTENSIONS.includes(fileExtension(name)!)
}

/**
 * Heuristic: has the embedded SVG-Edit app actually rendered inside this
 * host document? The embed bridge guarantees the left toolbar
 * (`#tools_left`, see public/static/svgeditor/embed.js) and/or the app
 * container once booted. Used by the mount backstop so a healthy editor
 * is never killed by the watchdog.
 */
export function looksLikeEditorLoaded(
  doc: { querySelector(sel: string): Element | null } | null
): boolean {
  if (!doc) return false
  try {
    return doc.querySelector('#tools_left, .svg-editor-container') !== null
  } catch {
    return false
  }
}

/**
 * Dirty check between two serialised SVG states. Whitespace is
 * normalised for the comparison (serialisers may reflow text between
 * load and serialise), everything else must match exactly.
 */
export function isDirty(current: string, baseline: string): boolean {
  const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim()
  return norm(current) !== norm(baseline)
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
