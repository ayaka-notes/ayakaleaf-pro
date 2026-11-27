import { useFileTreeActionable } from '@/features/file-tree/contexts/file-tree-actionable'
import FileTreeModalCreateFileMode from '@/features/file-tree/components/file-tree-create/file-tree-modal-create-file-mode'
import FileTreeCreateNameProvider from '@/features/file-tree/contexts/file-tree-create-name'
import FileTreeCreateNameInput from '@/features/file-tree/components/file-tree-create/file-tree-create-name-input'
import { useFileTreeCreateName } from '@/features/file-tree/contexts/file-tree-create-name'
import { useFileTreeCreateForm } from '@/features/file-tree/contexts/file-tree-create-form'
import ErrorMessage from '@/features/file-tree/components/file-tree-create/error-message'
import { useTranslation } from 'react-i18next'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { FormEventHandler, useCallback, useEffect } from 'react'

function CreateTikzFilePane () {
  const { newFileCreateMode, error, finishCreatingDoc, inFlight } =
    useFileTreeActionable()

  if (newFileCreateMode !== 'tikz') {
    return null
  }

  return (
    // The name keeps the `.tikz` extension so it opens in the canvas
    // editor (the provider claim is extension-based).
    <FileTreeCreateNameProvider initialName="drawing">
      <CreateTikzForm
        error={error}
        inFlight={inFlight}
        finishCreatingDoc={finishCreatingDoc}
      />
    </FileTreeCreateNameProvider>
  )
}

function CreateTikzForm ({
  error,
  inFlight,
  finishCreatingDoc
}: {
  // TODO: Update the error type when we properly type FileTreeActionableContext
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: string | Record<string, any>
  inFlight: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  finishCreatingDoc: (entity: { name: string }) => Promise<any>
}) {
  const { name, validName } = useFileTreeCreateName()
  const { setValid } = useFileTreeCreateForm()
  const { openDoc } = useEditorManagerContext()

  useEffect(() => {
    setValid(validName)
  }, [setValid, validName])

  const handleSubmit: FormEventHandler = useCallback(async event => {
    event.preventDefault()
    // Guarantee the `.tikz` extension (the canvas editor key is the name).
    const finalName = /\.tikz$|\.pgf$/i.test(name)
      ? name
      : `${name}.tikz`
    const doc = await finishCreatingDoc({ name: finalName })
    if (doc) {
      return await openDoc(doc)
    }
  }, [finishCreatingDoc, name, openDoc])

  return (
    <form noValidate id="create-file" onSubmit={handleSubmit}>
      <FileTreeCreateNameInput focusName error={error} inFlight={inFlight} />
      {error && <ErrorMessage error={error} />}
    </form>
  )
}

function TikzCreateFileMode () {
  const { t } = useTranslation()
  return (
    <FileTreeModalCreateFileMode
      mode="tikz"
      icon="schema"
      label={t('tikz_new_file', 'TikZ diagram')}
    />
  )
}

export const CreateFilePane = CreateTikzFilePane
export const CreateFileMode = TikzCreateFileMode
export default CreateTikzFilePane
