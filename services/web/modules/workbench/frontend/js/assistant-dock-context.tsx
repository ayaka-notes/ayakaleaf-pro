/**
 * Where the assistant sits: in the left rail or in a panel on the right.
 * One DOM node holds the panel and moves between the two places, so a chat
 * and its stream survive the move.
 */
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type PropsWithChildren,
} from 'react'
import customLocalStorage from '@/infrastructure/local-storage'
import { useRailContext } from '@/features/ide-react/context/rail-context'

export type DockSide = 'left' | 'right'

const SIDE_KEY = 'assistant.dock-side'

type AssistantDock = {
  side: DockSide
  moveTo: (side: DockSide) => void
  /** Whether the right-hand panel is shown. */
  open: boolean
  setOpen: (open: boolean) => void
  host: HTMLDivElement
}

const DockContext = createContext<AssistantDock | null>(null)

export function useAssistantDock() {
  const dock = useContext(DockContext)
  if (!dock) throw new Error('useAssistantDock needs AssistantDockProvider')
  return dock
}

/** Puts the shared panel node into this place while the assistant is docked here. */
export function DockSlot({ side }: { side: DockSide }) {
  const dock = useAssistantDock()
  const slot = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const place = slot.current
    if (!place || dock.side !== side) return
    place.append(dock.host)
    return () => dock.host.remove()
  }, [dock.side, dock.host, side])
  return <div ref={slot} className="h-100" />
}

const AssistantDockProvider: FC<PropsWithChildren> = ({ children }) => {
  const [side, setSide] = useState<DockSide>(() =>
    customLocalStorage.getItem(SIDE_KEY) === 'right' ? 'right' : 'left'
  )
  const [open, setOpen] = useState(false)
  const [host] = useState(() => Object.assign(document.createElement('div'), { className: 'h-100' }))
  const { selectedTab, isOpen, openTab, selectTab, setIsOpen } = useRailContext()

  // With the panel on the right, the rail tab only toggles that panel
  useLayoutEffect(() => {
    if (side === 'right' && selectedTab === 'workbench' && isOpen) {
      setOpen(shown => !shown)
      selectTab('file-tree')
      setIsOpen(false)
    }
  }, [side, selectedTab, isOpen, selectTab, setIsOpen])

  const moveTo = useCallback(
    (next: DockSide) => {
      setSide(next)
      customLocalStorage.setItem(SIDE_KEY, next)
      setOpen(true)
      if (next === 'left') {
        openTab('workbench')
      } else {
        selectTab('file-tree')
        setIsOpen(false)
      }
    },
    [openTab, selectTab, setIsOpen]
  )

  const value = useMemo(() => ({ side, moveTo, open, setOpen, host }), [side, moveTo, open, host])
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>
}

export default AssistantDockProvider
