import { useEffect, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { Compartment, StateEffect } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { useTranslation } from 'react-i18next'
import useTutorial from '@/shared/hooks/promotions/use-tutorial'
import { useTutorialContext } from '@/shared/context/tutorial-context'
import {
  citationHint,
  citationRange,
  setCitationHint,
} from '../extensions/reference-picker-keybinding'

const tutorialKey = 'reference-picker-shortcut'
const eventData = { tutorial: tutorialKey }

export function useCitationHint(view: EditorView | null | undefined, enabled: boolean) {
  const { t } = useTranslation()
  const inputHint = useRef(new Compartment())
  const { dismissTutorial } = useTutorial(tutorialKey, eventData)
  const { inactiveTutorials, currentPopup } = useTutorialContext()
  const active = enabled && !currentPopup && !inactiveTutorials.includes(tutorialKey)

  useEffect(() => {
    if (!view || !active || view.state.field(citationHint, false) === undefined) return
    const doc = view.dom.ownerDocument
    const events = new AbortController()
    const { signal } = events

    const hide = () => {
      if (view.state.field(citationHint, false)) {
        view.dispatch({ effects: setCitationHint.of(null) })
      }
    }

    const open = (pos: number | null) => {
      if (view.state.readOnly || !view.state.selection.main.empty) return
      const range = citationRange(view)
      if (pos === null || !range || pos < range.braceFrom || pos > range.braceTo) {
        hide()
        return
      }

      view.dispatch({
        effects: setCitationHint.of({
          pos,
          above: true,
          create() {
            const dom = doc.createElement('div')
            dom.className = 'reference-picker-shortcut-hint'
            const message = doc.createElement('div')
            message.className = 'reference-picker-shortcut-message'
            const icon = doc.createElement('span')
            icon.className = 'material-symbols'
            icon.setAttribute('aria-hidden', 'true')
            icon.setAttribute('translate', 'no')
            icon.textContent = 'info'
            message.append(icon, t('reference_picker_shortcut_hint', { shortcut: 'Ctrl+Space' }))
            dom.append(message)

            const button = doc.createElement('button')
            button.type = 'button'
            button.className = 'd-inline-grid btn btn-sm btn-danger-ghost'
            button.textContent = t('reference_picker_hide_hint')
            button.onclick = () => {
              hide()
              view.focus()
              void dismissTutorial()
            }
            dom.append(button)
            // Read the editor theme directly; the overall UI theme is independent.
            const syncButtonTheme = () => {
              const dark = view.state.facet(EditorView.darkTheme)
              const colors = {
                color: dark ? '--bg-danger-03' : '--content-danger',
                background: dark ? '--bg-dark-secondary' : '--bg-light-primary',
                'hover-background': dark ? '--bg-dark-tertiary' : '--bg-danger-03',
                border: dark ? '--bg-danger-01' : '--bg-light-primary',
                'hover-border': dark ? '--bg-danger-01' : '--bg-light-primary',
              }
              for (const [name, color] of Object.entries(colors)) {
                button.style.setProperty(`--btn-danger-ghost-${name}`, `var(${color})`)
              }
            }
            syncButtonTheme()
            return {
              dom,
              update(update) {
                if (update.startState.facet(EditorView.darkTheme) !==
                    update.state.facet(EditorView.darkTheme)) syncButtonTheme()
              },
            }
          },
        }),
      })
    }

    const listener = EditorView.updateListener.of(update => {
      if (!update.docChanged) return
      const { state } = update
      const pos = state.selection.main.head
      if (!state.selection.main.empty || pos === 0 || pos >= state.doc.length ||
          state.doc.sliceString(pos - 1, pos + 1) !== '{}') return

      // Only newly inserted braces qualify, not edits elsewhere in the document.
      let insertedOpeningBrace = false
      update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
        if (fromB < pos && toB >= pos) {
          insertedOpeningBrace = true
        }
      })
      if (!insertedOpeningBrace) return

      // Dispatch after CodeMirror finishes processing the input transaction.
      queueMicrotask(() => {
        if (signal.aborted || !view.hasFocus ||
            !view.state.doc.eq(state.doc) ||
            !view.state.selection.eq(state.selection)) return
        // Completion/snippet effects can create a new state without changing
        // the document. Parse the newly inserted argument before inspecting it.
        if (ensureSyntaxTree(view.state, pos + 1, 50)) open(pos)
      })
    })
    const compartment = inputHint.current
    view.dispatch({
      effects: compartment.get(view.state) === undefined
        ? StateEffect.appendConfig.of(compartment.of(listener))
        : compartment.reconfigure(listener),
    })

    const outside = (event: Event) => {
      if (!(event.target instanceof Element)) return
      if (view.contentDOM.contains(event.target) ||
          event.target.closest('.reference-picker-shortcut-hint')) return
      hide()
    }
    view.contentDOM.addEventListener('click', event => {
      if (event.button === 0) {
        open(view.posAtCoords({ x: event.clientX, y: event.clientY }))
      }
    }, { signal })
    doc.addEventListener('pointerdown', outside, { signal })
    doc.addEventListener('focusin', outside, { signal })
    doc.addEventListener('keydown', event => {
      if (event.key === 'Escape') hide()
    }, { signal })

    return () => {
      events.abort()
      view.dispatch({
        effects: [setCitationHint.of(null), compartment.reconfigure([])],
      })
    }
  }, [active, view, t, dismissTutorial])
}
