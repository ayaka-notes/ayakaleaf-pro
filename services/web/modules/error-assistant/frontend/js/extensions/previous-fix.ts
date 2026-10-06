import { StateEffect, StateField, type Extension } from '@codemirror/state'
import type { AssistantMessage, SuggestFixLogEntry } from '../hooks/use-suggest-fix'

/**
 * Stores the last suggested or applied AI fix in CodeMirror editor state.
 * Keeping it outside the log panel lets the suggestion survive recompiles.
 */

export type PreviousFix = {
  messages: AssistantMessage[]
  logEntry: SuggestFixLogEntry
  applied: boolean
}

export const previousFixEffect = StateEffect.define<PreviousFix | null>()

export const previousFixState = StateField.define<PreviousFix | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(previousFixEffect)) {
        value = effect.value
      }
    }
    return value
  },
})

// overleafModuleImports.sourceEditorExtensions expects `item.import.extension`,
// a factory returning the CodeMirror Extension.
export const extension = (): Extension => [previousFixState]
