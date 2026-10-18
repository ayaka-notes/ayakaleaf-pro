import {
  createContext,
  FC,
  useContext,
  useState,
  useMemo,
} from 'react'
import getMeta from '@/utils/meta'
import { Template } from '../../types/template'

type TemplateContextType = {
  template: Template
  setTemplate: (template: Template) => void
}

export const TemplateContext = createContext<TemplateContextType | undefined>(
  undefined
)

type TemplateProviderProps = {
  loadedTemplate: Template
}

export const TemplateProvider: FC<TemplateProviderProps> = ({ children }) => {
  const loadedTemplate = useMemo(() => getMeta('ol-template'), [])
  const [template, setTemplate] = useState(loadedTemplate)

  const value = useMemo(
    () => ({
      template,
      setTemplate,
    }),
    [template, setTemplate]
  )

  return (
    <TemplateContext.Provider value={value}>
      {children}
    </TemplateContext.Provider>
  )
}

export const useTemplateContext = () => {
  const context = useContext(TemplateContext)
  if (!context) {
    throw new Error(
      `useTemplateContext must be used within a TemplateProvider`
    )
  }
  return context
}
