import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FlatOutlineState,
  PartialFlatOutline,
  useOutlineContext,
} from '@/features/ide-react/context/outline-context'
import {
  nestOutline,
  Outline,
} from '@/features/source-editor/utils/tree-operations/outline'
import { insertCommentsIntoOutline } from '@/features/source-editor/utils/tree-operations/outline-comments'
import { debugConsole } from '@/utils/debugging'

const outlineChanged = (
  a: PartialFlatOutline | undefined,
  b: PartialFlatOutline
): boolean => {
  if (!a) {
    return true
  }

  if (a.length !== b.length) {
    return true
  }

  for (let i = 0; i < a.length; i++) {
    const aItem = a[i]
    const bItem = b[i]
    if (
      aItem.level !== bItem.level ||
      aItem.line !== bItem.line ||
      aItem.title !== bItem.title
    ) {
      return true
    }
  }

  return false
}

export default function useNestedOutline() {
  const { flatOutline, commentHighlights } = useOutlineContext()

  const [nestedOutline, setNestedOutline] = useState<{
    items: Outline[]
    partial: boolean
  }>(() => ({ items: [], partial: false }))

  const prevFlatOutlineRef = useRef<FlatOutlineState>(undefined)

  // when the flat outline changes, calculate the nested outline
  // TODO: only calculate when outlineExpanded is true
  useEffect(() => {
    const prevFlatOutline = prevFlatOutlineRef.current
    prevFlatOutlineRef.current = flatOutline

    if (flatOutline) {
      if (outlineChanged(prevFlatOutline?.items, flatOutline.items)) {
        debugConsole.log('Rebuilding changed outline')
        setNestedOutline({
          items: nestOutline(flatOutline.items),
          partial: flatOutline.partial,
        })
      }
    } else {
      setNestedOutline({ items: [], partial: false })
    }
  }, [flatOutline])

  // insert the user's highlight-tag comments (special comments) under the
  // (sub)section each one belongs to, so the outline shows them in context
  const items = useMemo(
    () => insertCommentsIntoOutline(nestedOutline.items, commentHighlights),
    [nestedOutline.items, commentHighlights]
  )

  return { items, partial: nestedOutline.partial }
}
