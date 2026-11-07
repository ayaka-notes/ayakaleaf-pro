import { useLayoutContext } from '@/shared/context/layout-context'
import { useEffect, useRef, useState } from 'react'

type OrphanState = 'connecting' | 'orphan' | 'not-orphan'

const ORPHAN_UI_TIMEOUT_MS = 5000

export default function useDetachedOrphanDetection(): OrphanState {
  const { detachRole, detachIsLinked } = useLayoutContext()
  const uiTimeoutRef = useRef<number>()
  const [longTimeOrphan, setLongTimeOrphan] = useState(false)

  const orphaned = !detachIsLinked && detachRole === 'detached'

  useEffect(() => {
    if (uiTimeoutRef.current) {
      window.clearTimeout(uiTimeoutRef.current)
    }

    if (orphaned) {
      uiTimeoutRef.current = window.setTimeout(() => {
        setLongTimeOrphan(true)
      }, ORPHAN_UI_TIMEOUT_MS)
    } else {
      setLongTimeOrphan(false)
    }

    return () => {
      if (uiTimeoutRef.current) {
        window.clearTimeout(uiTimeoutRef.current)
      }
    }
  }, [orphaned])

  if (!orphaned) {
    // not detached, or detached but linked
    return 'not-orphan'
  }

  if (longTimeOrphan) {
    return 'orphan'
  } else if (orphaned) {
    return 'connecting'
  } else {
    return 'not-orphan'
  }
}
