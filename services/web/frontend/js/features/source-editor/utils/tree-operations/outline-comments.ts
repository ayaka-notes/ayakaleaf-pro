import type { Outline } from './outline'

type CommentEntry = {
  line: number
  tag: string
  text: string
  color: string
}

/**
 * Insert special-comment entries (the user's highlight tags found in the
 * document) into the nested file outline, each placed under the deepest
 * (sub)section whose range contains its line. Comments that appear before the
 * first section are placed at the top level. Returns a NEW outline; the input
 * (and its cached ancestors) is not mutated.
 */
export function insertCommentsIntoOutline(
  outline: Outline[],
  comments: CommentEntry[]
): Outline[] {
  if (!comments.length) {
    return outline
  }

  const clone = (nodes: Outline[]): Outline[] =>
    nodes.map(node => ({
      ...node,
      children: node.children ? clone(node.children) : undefined,
    }))

  const result = clone(outline)

  // Find the deepest section whose [line, next-sibling-line) range contains the
  // comment line. `end` is the line that closes the current sibling group
  // (the parent's next sibling, or the document end for the root).
  const findContainer = (
    nodes: Outline[],
    line: number,
    end: number
  ): Outline | null => {
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]
      if (node.line > line) {
        // siblings are in document order, so none after this start before `line`
        break
      }
      const nodeEnd = i + 1 < nodes.length ? nodes[i + 1].line : end
      if (line < nodeEnd) {
        // `line` falls inside this section
        if (node.children && node.children.length) {
          const deeper = findContainer(node.children, line, nodeEnd)
          if (deeper) {
            return deeper
          }
        }
        return node
      }
      // otherwise `line` is at/after this section's end; keep scanning siblings
    }
    return null
  }

  // Resolve all containers against the comment-free tree first, then insert,
  // so insertion order never affects container lookup.
  const placements = [...comments]
    .sort((a, b) => a.line - b.line)
    .map(comment => ({
      comment,
      container: findContainer(result, comment.line, Infinity),
    }))

  for (const { comment, container } of placements) {
    const item: Outline = {
      line: comment.line,
      title: comment.tag,
      level: 99,
      comment: {
        tag: comment.tag,
        color: comment.color,
        text: comment.text,
      },
    }
    if (container) {
      if (!container.children) {
        container.children = []
      }
      container.children.push(item)
    } else {
      result.push(item)
    }
  }

  return result
}
