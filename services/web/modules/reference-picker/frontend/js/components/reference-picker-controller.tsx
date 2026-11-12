import { useCallback, useEffect, useState } from 'react'
import ReferencePickerModal from './reference-picker-modal'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import { useProjectContext } from '@/shared/context/project-context'

export default function ReferencePickerController() {
  const { view } = useEditorViewContext()
  const { project } = useProjectContext()
  // Typst cites are #cite("key", ...); LaTeX uses \cite{key, ...}.
  const isTypst = project?.compiler === 'typst'

  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const [braceFrom, setBraceFrom] = useState<number | null>(null)
  const [braceTo, setBraceTo] = useState<number | null>(null)
  const [initialKeys, setInitialKeys] = useState<string[]>([])

  const onClose = useCallback(() => setOpen(false), [])

  const onApply = useCallback(
    (selectedKeys: string[]) => {
      if (!view || from == null || to == null) return

      const doc = view.state.doc
      const bFrom = braceFrom ?? from
      const bTo = braceTo ?? to

      let insertCore = isTypst
        ? selectedKeys.map((k) => `"${k}"`).join(', ')
        : selectedKeys.join(', ')

      // Expand over spaces/tabs and commas around selection
      let start = from
      let end = to
      while (start > bFrom && /[ \t,]/.test(doc.sliceString(start - 1, start))) start--
      while (end < bTo && /[ \t,]/.test(doc.sliceString(end, end + 1))) end++

      let prefix = ''
      let suffix = ''
      if (start > bFrom && doc.sliceString(start - 1, start) !== '\n') prefix = ', '
      if (end < bTo && insertCore) suffix = ', '

      const insert = prefix + insertCore + suffix

      // Compute cursor position after inserted tokens
      const cursorPos = start + prefix.length + insertCore.length + (end === bTo ? 0 : 1)

      view.dispatch({
        changes: { from: start, to: end, insert },
        selection: { anchor: cursorPos },
      })
      view.focus()
    },
    [view, from, to, braceFrom, braceTo, isTypst]
  )

  useEffect(() => {
    const handler = (evt: CustomEvent) => {
      const detail = evt.detail || {}

      if (detail.insertFrom == null) {
        if (!view) return
        const pos = view.state.selection.main.head
        const insertText = isTypst ? '#cite()' : '\\cite{}'
        const delim = isTypst ? '(' : '{'
        view.dispatch({
          changes: { from: pos, to: pos, insert: insertText }
        })
        const newFrom = pos + insertText.indexOf(delim) + 1
        setFrom(newFrom)
        setTo(newFrom)
        setBraceFrom(newFrom)
        setBraceTo(newFrom)
        setInitialKeys([])
      } else {
        setFrom(detail.insertFrom)
        setTo(detail.insertTo)
        setBraceFrom(detail.braceFrom ?? detail.insertFrom)
        setBraceTo(detail.braceTo ?? detail.insertTo)
        setInitialKeys(detail.selectedTokens || [])
      }

      setOpen(true)
    }

    window.addEventListener('reference:openPicker', handler as EventListener)
    return () => window.removeEventListener('reference:openPicker', handler as EventListener)
  }, [view, isTypst])

  return (
    <ReferencePickerModal
      show={open}
      onClose={onClose}
      onApply={onApply}
      initialKeys={initialKeys}
    />
  )
}
