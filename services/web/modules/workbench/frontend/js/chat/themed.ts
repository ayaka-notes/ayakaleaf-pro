/**
 * Colors from the editor's -themed variables, which follow its light and dark
 * themes. Bootstrap's own color utilities (text-body-secondary, bg-body-*,
 * border, list-group, form-control) stay light in the dark editor theme.
 * Where the two themes need different palette colors, a hook picks them.
 */
import type { CSSProperties } from 'react'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'

const divider = 'var(--border-divider-themed)'

/** Secondary text: inline code, line numbers, notes. */
export const muted = { color: 'var(--content-secondary-themed)' }

/** Quieter text: reasoning, tool steps, the disclaimer. */
export const faint = { color: 'var(--content-placeholder-themed)' }

/** Main text, for elements that set their own color (code, form fields). */
export const plain = { color: 'var(--content-primary-themed)' }

/** A box with a thin outline. */
export const boxed = { border: `1px solid ${divider}` }

/** A box around code, a little firmer than boxed. */
export const framed = { border: '1px solid var(--border-primary-themed)' }

/** A separator line above. */
export const ruleAbove = { borderTop: `1px solid ${divider}` }

/** A raised surface: the user's messages, chips, card headers. */
export const surface = { backgroundColor: 'var(--bg-secondary-themed)' }

export const link = { color: 'var(--link-ui-themed)' }

/**
 * Ghost buttons get a grey fill in the dark theme. Clearing Bootstrap's
 * button variables keeps them flat and leaves the hover and pressed states.
 */
export const flatGhost = {
  '--bs-btn-bg': 'transparent',
  '--bs-btn-disabled-bg': 'transparent',
} as CSSProperties

/** Colors of the text a change adds and removes, in the current theme. */
export function useChangeColors() {
  const dark = useActiveOverallTheme() === 'dark'
  return {
    added: {
      backgroundColor: dark ? 'var(--green-70)' : 'var(--green-10)',
      color: dark ? 'var(--white)' : 'var(--green-70)',
      textDecoration: 'none',
    },
    removed: { color: dark ? 'var(--red-30)' : 'var(--red-50)' },
  }
}

/** A notice that wants attention without being an error, like the AI terms. */
export function useNoticeColors() {
  const dark = useActiveOverallTheme() === 'dark'
  return dark
    ? { backgroundColor: 'var(--bg-dark-secondary)', border: '1px solid var(--border-primary)' }
    : { backgroundColor: 'var(--bg-accent-03)', border: '1px solid var(--green-20)' }
}
