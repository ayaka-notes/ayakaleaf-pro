import { useTranslation } from 'react-i18next'
import { useCodeMirrorStateContext } from '@/features/source-editor/components/codemirror-context'
import { ToolbarButton } from '@/features/source-editor/components/toolbar/toolbar-button'
import { isMac } from '@/shared/utils/os'
import { canFormat, formatDocument } from '../format-document'

export default function FormatDocumentButton() {
  const { t } = useTranslation()
  const state = useCodeMirrorStateContext()

  if (!canFormat(state)) {
    return null
  }

  return (
    <ToolbarButton
      id="toolbar-format-document"
      label={t('format_document')}
      command={formatDocument}
      icon="format_align_left"
      shortcut={isMac ? '⌥⇧F' : 'Shift+Alt+F'}
    />
  )
}
