/**
 * Workbench settings:
 * Shares chat panel state across workbench components.
 * Persists the docking preference so it survives page reloads.
 */
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type FC,
  type PropsWithChildren,
} from 'react'
import customLocalStorage from '@/infrastructure/local-storage'
import { useRailContext } from '@/features/ide-react/context/rail-context'

export type WorkbenchPosition = 'left' | 'right'

const STORAGE = {
  position: 'workbench.position',
} as const

type WorkbenchSettings = {
  position: WorkbenchPosition
  setPosition: (position: WorkbenchPosition) => void
  /** Whether the workbench pane is open. */
  open: boolean
  setOpen: (open: boolean) => void
  panelContainer: HTMLDivElement
}

const WorkbenchSettingsContext = createContext<WorkbenchSettings | undefined>(
  undefined
)

export const WorkbenchSettingsProvider: FC<PropsWithChildren> = ({
  children,
}) => {
  const [open, setOpen] = useState(false)
  // Keep one portal target so docking preserves the chat and its active stream.
  const [panelContainer] = useState(() => {
    const element = document.createElement('div')
    element.className = 'h-100'
    return element
  })
  const [position, setPositionState] = useState<WorkbenchPosition>(
    () => (customLocalStorage.getItem(STORAGE.position) as WorkbenchPosition) ?? 'left'
  )
  const { selectedTab, isOpen, selectTab, setIsOpen } = useRailContext()

  useLayoutEffect(() => {
    if (position === 'right' && selectedTab === 'workbench' && isOpen) {
      setOpen(value => !value)
      selectTab('file-tree')
      setIsOpen(false)
    }
  }, [position, selectedTab, isOpen, selectTab, setIsOpen])

  const setPosition = useCallback((next: WorkbenchPosition) => {
    setPositionState(next)
    customLocalStorage.setItem(STORAGE.position, next)
  }, [])

  const value = useMemo<WorkbenchSettings>(
    () => ({
      position,
      setPosition,
      open,
      setOpen,
      panelContainer,
    }),
    [position, setPosition, open, panelContainer]
  )

  return (
    <WorkbenchSettingsContext.Provider value={value}>
      {children}
    </WorkbenchSettingsContext.Provider>
  )
}

export function useWorkbenchSettings(): WorkbenchSettings {
  const context = useContext(WorkbenchSettingsContext)
  if (!context) {
    throw new Error(
      'useWorkbenchSettings must be used within a WorkbenchSettingsProvider'
    )
  }
  return context
}

export default WorkbenchSettingsProvider
