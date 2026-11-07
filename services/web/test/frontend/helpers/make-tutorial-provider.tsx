import React, {
  type FC,
  type PropsWithChildren,
  useCallback,
  useRef,
  useState,
} from 'react'
import { TutorialContext } from '@/shared/context/tutorial-context'

export const makeTutorialProvider = (opts?: {
  inactiveTutorials: string[]
}) => {
  const TutorialProvider: FC<PropsWithChildren> = ({ children }) => {
    const [inactiveTutorials, setInactiveTutorials] = useState<string[]>(
      opts?.inactiveTutorials ?? []
    )
    const currentPopupRef = useRef<string | null>(null)
    const deactivateTutorial = useCallback((key: string) => {
      setInactiveTutorials(prev => (prev.includes(key) ? prev : [...prev, key]))
    }, [])
    const value = {
      deactivateTutorial,
      inactiveTutorials,
      currentPopup: null,
      currentPopupRef,
      setCurrentPopup: () => {},
    }
    return (
      <TutorialContext.Provider value={value}>
        {children}
      </TutorialContext.Provider>
    )
  }
  return TutorialProvider
}
