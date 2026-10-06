/**
 * Workbench settings:
 * Shares chat panel, model, and tool state across workbench components.
 * Persists model, tool, and docking preferences so they survive page reloads.
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
import getMeta from '@/utils/meta'
import { useRailContext } from '@/features/ide-react/context/rail-context'

declare module '@/utils/meta' {
  interface Meta {
    'ol-workbenchDefaultModel': string | undefined
    'ol-workbenchDefaultTools': string[] | undefined
  }
}

export type WorkbenchTab = 'chat' | 'citation-reviewer'
export type WorkbenchPosition = 'left' | 'right'

const STORAGE = {
  model: 'workbench.model',
  tools: 'workbench.enabledTools',
  position: 'workbench.position',
} as const

// Prefer the saved model, then the instance default.
function defaultModel(): string {
  return (
    customLocalStorage.getItem(STORAGE.model) ??
    getMeta('ol-workbenchDefaultModel') ??
    'default'
  )
}

function defaultEnabledTools(): Set<string> {
  const persisted = customLocalStorage.getItem(STORAGE.tools) as
    | string[]
    | null
  if (Array.isArray(persisted)) return new Set(persisted)
  const fromMeta = getMeta('ol-workbenchDefaultTools') as string[] | undefined
  // Default to web and documentation search when no preferences are saved.
  return new Set(fromMeta ?? ['search_documentation', 'web_search'])
}

type WorkbenchSettings = {
  tab: WorkbenchTab
  setTab: (tab: WorkbenchTab) => void
  position: WorkbenchPosition
  setPosition: (position: WorkbenchPosition) => void
  /** Whether the workbench pane is open. */
  open: boolean
  setOpen: (open: boolean) => void
  panelContainer: HTMLDivElement
  model: string
  setModel: (model: string) => void
  enabledTools: Set<string>
  toggleTool: (tool: string) => void
  setEnabledTools: (tools: Set<string>) => void
}

const WorkbenchSettingsContext = createContext<WorkbenchSettings | undefined>(
  undefined
)

export const WorkbenchSettingsProvider: FC<PropsWithChildren> = ({
  children,
}) => {
  const [tab, setTab] = useState<WorkbenchTab>('chat')
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
  const [model, setModelState] = useState<string>(defaultModel)
  const [enabledTools, setEnabledToolsState] =
    useState<Set<string>>(defaultEnabledTools)
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

  const setModel = useCallback((next: string) => {
    setModelState(next)
    customLocalStorage.setItem(STORAGE.model, next)
  }, [])

  const setEnabledTools = useCallback((next: Set<string>) => {
    setEnabledToolsState(next)
    customLocalStorage.setItem(STORAGE.tools, Array.from(next))
  }, [])

  const toggleTool = useCallback((tool: string) => {
    setEnabledToolsState(prev => {
      const next = new Set(prev)
      if (next.has(tool)) next.delete(tool)
      else next.add(tool)
      customLocalStorage.setItem(STORAGE.tools, Array.from(next))
      return next
    })
  }, [])

  const value = useMemo<WorkbenchSettings>(
    () => ({
      tab,
      setTab,
      position,
      setPosition,
      open,
      setOpen,
      panelContainer,
      model,
      setModel,
      enabledTools,
      toggleTool,
      setEnabledTools,
    }),
    [tab, position, setPosition, open, panelContainer, model, setModel, enabledTools, toggleTool, setEnabledTools]
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
