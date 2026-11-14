import { useCallback, useEffect, useState } from 'react'
import TypstPickerModal from './typst-picker-modal'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'

/**
 * Typst reference picker controller.
 * Mirrors the LaTeX reference-picker (same modal, same preselected-key row);
 * the only difference is the insert syntax: `@key @key` instead of `key, key`.
 */
export default function TypstPickerController() {
  const { view } = useEditorViewContext()

  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const [initialKeys, setInitialKeys] = useState<string[]>([])

  const onClose = useCallback(() => setOpen(false), [])

  const onApply = useCallback(
    (selectedKeys: string[]) => {
      if (!view || from == null || to == null) return
      if (selectedKeys.length === 0) return

      const doc = view.state.doc
      // Always use @key syntax (works for all keys in Typst 0.15.x)
      const insertCore = selectedKeys.map(k => `@${k}`).join(' ')

      // Expand over spaces/tabs around selection
      let start = from
      let end = to
      while (start > 0 && /[ \t]/.test(doc.sliceString(start - 1, start))) start--
      while (end < doc.length && /[ \t]/.test(doc.sliceString(end, end + 1))) end++

      // Add a space if needed
      let prefix = ''
      let suffix = ''
      if (start > 0 && doc.sliceString(start - 1, start) !== ' ' && doc.sliceString(start - 1, start) !== '\n') prefix = ' '
      if (end < doc.length && insertCore && doc.sliceString(end, end + 1) !== ' ' && doc.sliceString(end, end + 1) !== '\n') suffix = ' '

      const insert = prefix + insertCore + suffix
      const cursorPos = start + prefix.length + insertCore.length + (suffix ? 1 : 0)

      view.dispatch({
        changes: { from: start, to: end, insert },
        selection: { anchor: cursorPos },
      })
      view.focus()
    },
    [view, from, to]
  )

  useEffect(() => {
    const handler = (evt: CustomEvent) => {
      const detail = evt.detail || {}
      setFrom(detail.insertFrom ?? detail.from ?? 0)
      setTo(detail.insertTo ?? detail.to ?? 0)
      setInitialKeys(detail.selectedKeys || [])
      setOpen(true)
    }

    window.addEventListener('typst:openPicker', handler as EventListener)
    return () => window.removeEventListener('typst:openPicker', handler as EventListener)
  }, [view])

  return (
    <TypstPickerModal
      show={open}
      onClose={onClose}
      onApply={onApply}
      initialKeys={initialKeys}
    />
  )
}
