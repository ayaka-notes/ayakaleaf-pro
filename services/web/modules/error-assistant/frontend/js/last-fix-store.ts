/**
 * The last fix the assistant proposed, kept in the editor state so that it
 * is still there after the next compile replaces the log.
 */
import { StateEffect, StateField } from '@codemirror/state'
import type { Fix, FixEntry } from './use-fix-request'

export type LastFix = {
  entry: FixEntry
  explanation: string
  fixes: Fix[]
  applied: boolean
}

export const setLastFix = StateEffect.define<LastFix | null>()

export const lastFixField = StateField.define<LastFix | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setLastFix)) value = effect.value
    }
    return value
  },
})

// sourceEditorExtensions modules export `extension`, a factory
export const extension = () => lastFixField
