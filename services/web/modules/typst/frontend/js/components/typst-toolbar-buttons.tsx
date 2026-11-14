/**
 * Typst toolbar button group.
 *
 * Registered via `Settings.overleafModuleImports.sourceEditorToolbarButtonGroups`
 * (baked into the bundle at build time). The component renders nothing unless
 * the open doc is a `.typ` file, so it is inert on TeX-only documents.
 *
 * Bold/italic use Typst-style `*…*`/`_…_` wrapping (the lezer grammar marks
 * these as Strong/Emph spans); Format runs the in-browser typstyle wasm
 * formatter (`source-editor/extensions/toolbar/typst-format.ts`).
 */
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { ToolbarButton } from '@/features/source-editor/components/toolbar/toolbar-button'
import * as commands from '@/features/source-editor/extensions/toolbar/commands'
import { typstFormatDocument } from '@/features/source-editor/extensions/toolbar/typst-format'
import { isMac } from '@/shared/utils/os'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'

export const overflowGroupId = 'group-format'

const TypstToolbarButtons: FC = () => {
  const { t } = useTranslation()
  const { openDocName } = useEditorOpenDocContext()

  // Only for .typ documents.
  if (!/\.typ$/i.test(openDocName || '')) {
    return null
  }

  return (
    <div
      className="ol-cm-toolbar-button-group"
      data-overflow={overflowGroupId}
      aria-label={t('toolbar_text_style')}
    >
      <ToolbarButton
        id="toolbar-typst-bold"
        label={t('toolbar_bold')}
        command={commands.typstToggleBold}
        icon="format_bold"
        shortcut={isMac ? '⌘B' : 'Ctrl+B'}
      />
      <ToolbarButton
        id="toolbar-typst-italic"
        label={t('toolbar_italic')}
        command={commands.typstToggleItalic}
        icon="format_italic"
        shortcut={isMac ? '⌘I' : 'Ctrl+I'}
      />
      <ToolbarButton
        id="toolbar-typst-heading"
        label={t('toolbar_heading')}
        command={commands.typstInsertHeading}
        icon="format_title_case"
      />
      <ToolbarButton
        id="toolbar-typst-math"
        label={t('toolbar_insert_inline_math')}
        command={commands.typstInsertInlineMath}
        icon="calculate"
      />
      <ToolbarButton
        id="toolbar-typst-code"
        label={t('toolbar_code')}
        command={commands.typstInsertCodeBlock}
        icon="code"
      />
      <ToolbarButton
        id="toolbar-typst-figure"
        label={t('toolbar_insert_figure')}
        command={commands.typstInsertFigure}
        icon="image"
      />
      <ToolbarButton
        id="toolbar-typst-table"
        label={t('toolbar_insert_table')}
        command={commands.typstInsertTable}
        icon="table_rows"
      />
      <ToolbarButton
        id="toolbar-typst-ref"
        label={t('toolbar_ref')}
        command={commands.typstInsertRef}
        icon="tag"
      />
      <ToolbarButton
        id="toolbar-typst-link"
        label={t('toolbar_insert_link')}
        command={commands.typstInsertLink}
        icon="link"
      />
      <ToolbarButton
        id="toolbar-typst-format"
        label={t('toolbar_format_code')}
        command={typstFormatDocument}
        icon="format_shapes"
        shortcut={isMac ? '⇧⌘F' : 'Ctrl+Shift+F'}
      />
    </div>
  )
}

export default TypstToolbarButtons
