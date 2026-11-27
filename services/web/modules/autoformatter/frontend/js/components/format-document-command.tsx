import { useTranslation } from 'react-i18next'
import {
  useCodeMirrorStateContext,
  useCodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import { useCommandProvider } from '@/features/ide-react/hooks/use-command-provider'
import { useLayoutContext } from '@/shared/context/layout-context'
import { canFormat, formatDocument } from '../format-document'

/**
 * Registers "Format document" for the Format menu and the command palette,
 * like the editor's own commands in useToolbarMenuBarEditorCommands.
 */
export default function FormatDocumentCommand() {
  const { t } = useTranslation()
  const view = useCodeMirrorViewContext()
  const state = useCodeMirrorStateContext()
  const { view: layoutView } = useLayoutContext()
  const available = layoutView === 'editor' && canFormat(state)

  useCommandProvider(() => {
    if (!available) {
      return
    }
    return [
      {
        id: 'format-document',
        label: t('format_document'),
        handler: () => {
          formatDocument(view)
          view.focus()
        },
      },
    ]
  }, [available, t, view])

  return null
}
