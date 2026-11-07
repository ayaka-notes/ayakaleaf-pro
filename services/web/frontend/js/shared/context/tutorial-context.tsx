import getMeta from '@/utils/meta'
import {
  createContext,
  FC,
  MutableRefObject,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'

export const TutorialContext = createContext<
  | {
      deactivateTutorial: (tutorial: string) => void
      inactiveTutorials: string[]
      currentPopup: string | null
      currentPopupRef: MutableRefObject<string | null>
      setCurrentPopup: (value: string | null) => void
    }
  | undefined
>(undefined)

export const TutorialProvider: FC<React.PropsWithChildren> = ({ children }) => {
  const [inactiveTutorials, setInactiveTutorials] = useState(
    () => getMeta('ol-inactiveTutorials') || []
  )

  const [currentPopup, setCurrentPopupState] = useState<string | null>(null)
  const currentPopupRef = useRef<string | null>(null)

  const setCurrentPopup = useCallback((value: string | null) => {
    currentPopupRef.current = value
    setCurrentPopupState(value)
  }, [])

  const deactivateTutorial = useCallback(
    (tutorialKey: string) => {
      setInactiveTutorials([...inactiveTutorials, tutorialKey])
    },
    [inactiveTutorials]
  )

  const value = useMemo(
    () => ({
      deactivateTutorial,
      inactiveTutorials,
      currentPopup,
      currentPopupRef,
      setCurrentPopup,
    }),
    [deactivateTutorial, inactiveTutorials, currentPopup, setCurrentPopup]
  )

  return (
    <TutorialContext.Provider value={value}>
      {children}
    </TutorialContext.Provider>
  )
}

export function useTutorialContext() {
  const context = useContext(TutorialContext)

  if (!context) {
    throw new Error(
      'useTutorialContext is only available inside TutorialProvider'
    )
  }

  return context
}
