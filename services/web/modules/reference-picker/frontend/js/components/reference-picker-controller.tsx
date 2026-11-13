import React, { useEffect, useState } from 'react'
import { useCitationHint } from '../hooks/use-citation-hint'
import ReferencePickerModal from './reference-picker-modal'
import { citationRange } from '../extensions/reference-picker-keybinding'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'

type Picker = {
  from: number
  to: number
  initialKeys: string[]
  newCitation: boolean
}

export default function ReferencePickerController() {
  const { view } = useEditorViewContext()
  const [picker, setPicker] = useState<Picker | null>(null)

  useCitationHint(view, picker === null)

  useEffect(() => {
    if (!view) return

    const open = (event: Event) => {
      const detail = (event as CustomEvent).detail
      const range = detail?.braceFrom != null ? detail : citationRange(view)
      const from = range?.braceFrom ?? view.state.selection.main.head
      const to = range?.braceTo ?? from
      const content = view.state.doc.sliceString(from, to)
      const initialKeys = content.replace(/%[^\n]*/g, '').match(/[^\s,]+/g) ?? []
      setPicker({ from, to, initialKeys, newCitation: !range })
    }

    window.addEventListener('reference:openPicker', open)
    return () => window.removeEventListener('reference:openPicker', open)
  }, [view])

  if (!picker || !view) return null

  function save(keys: string[]) {
    if (!picker || !view) return
    const { from, to, initialKeys, newCitation } = picker
    const changed = keys.length !== initialKeys.length ||
      keys.some((key, index) => key !== initialKeys[index])
    if (newCitation || changed) {
      const content = keys.join(', ')
      const insert = newCitation ? `\\cite{${content}}` : content
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: newCitation ? from + insert.length - 1 : from + insert.length },
      })
    }
    view.focus()
  }

  return (
    <ReferencePickerModal
      show
      onClose={() => setPicker(null)}
      onApply={save}
      initialKeys={picker.initialKeys}
    />
  )
}
