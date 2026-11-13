import { useCallback, useEffect } from 'react'
import { useIdeContext } from '../../../shared/context/ide-context'
import { useProjectContext } from '@/shared/context/project-context'
import type { ProjectSettings } from '../utils/api'

export default function useProjectWideSettingsSocketListener() {
  const { socket } = useIdeContext()

  const { project, updateProject } = useProjectContext()

  const setCompiler = useCallback(
    (compiler: ProjectSettings['compiler']) => {
      if (project) {
        updateProject({ compiler })
      }
    },
    [project, updateProject]
  )

  const setImageName = useCallback(
    (imageName: ProjectSettings['imageName']) => {
      if (project) {
        updateProject({ imageName })
      }
    },
    [project, updateProject]
  )

  const setPng2pdf = useCallback(
    (png2pdf: ProjectSettings['png2pdf']) => {
      if (project) {
        updateProject({ png2pdf })
      }
    },
    [project, updateProject]
  )

  const setSpellCheckLanguage = useCallback(
    (spellCheckLanguage: ProjectSettings['spellCheckLanguage']) => {
      if (project) {
        updateProject({ spellCheckLanguage })
      }
    },
    [project, updateProject]
  )

  const setReferenceFormat = useCallback(
    (referenceFormat: ProjectSettings['referenceFormat']) => {
      if (project) {
        updateProject({ referenceFormat })
      }
    },
    [project, updateProject]
  )

  const setLanguageToolEnabled = useCallback(
    (languageToolEnabled: ProjectSettings['languageToolEnabled']) => {
      if (project) {
        updateProject({ languageToolEnabled })
      }
    },
    [project, updateProject]
  )

  const setLanguageToolPicky = useCallback(
    (languageToolPicky: ProjectSettings['languageToolPicky']) => {
      if (project) {
        updateProject({ languageToolPicky })
      }
    },
    [project, updateProject]
  )

  const setLanguageToolLanguage = useCallback(
    (languageToolLanguage: ProjectSettings['languageToolLanguage']) => {
      if (project) {
        updateProject({ languageToolLanguage })
      }
    },
    [project, updateProject]
  )

  useEffect(() => {
    // data is not available on initial mounting
    const dataAvailable = !!project

    if (dataAvailable && socket) {
      socket.on('compilerUpdated', setCompiler)
      socket.on('imageNameUpdated', setImageName)
      socket.on('png2pdfUpdated', setPng2pdf)
      socket.on('spellCheckLanguageUpdated', setSpellCheckLanguage)
      socket.on('referenceFormatUpdated', setReferenceFormat)
      socket.on('languageToolEnabledUpdated', setLanguageToolEnabled)
      socket.on('languageToolPickyUpdated', setLanguageToolPicky)
      socket.on('languageToolLanguageUpdated', setLanguageToolLanguage)
      return () => {
        socket.removeListener('compilerUpdated', setCompiler)
        socket.removeListener('imageNameUpdated', setImageName)
        socket.removeListener('png2pdfUpdated', setPng2pdf)
        socket.removeListener(
          'spellCheckLanguageUpdated',
          setSpellCheckLanguage
        )
        socket.removeListener('referenceFormatUpdated', setReferenceFormat)
        socket.removeListener(
          'languageToolEnabledUpdated',
          setLanguageToolEnabled
        )
        socket.removeListener('languageToolPickyUpdated', setLanguageToolPicky)
        socket.removeListener(
          'languageToolLanguageUpdated',
          setLanguageToolLanguage
        )
      }
    }
  }, [
    socket,
    project,
    setCompiler,
    setImageName,
    setReferenceFormat,
    setPng2pdf,
    setSpellCheckLanguage,
    setLanguageToolEnabled,
    setLanguageToolPicky,
    setLanguageToolLanguage,
  ])
}
