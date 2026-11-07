import { foldAll, toggleFold, unfoldAll } from '@codemirror/language'

/**
 * A custom extension that binds keyboard shortcuts to folding actions.
 */
export const foldingKeymap = [
  {
    key: 'F2',
    run: toggleFold,
  },
  {
    key: 'Alt-Shift-1',
    mac: 'Alt-Shift-⁄', // Opt-Shift-1 on macOS
    run: foldAll,
  },
  {
    key: 'Alt-Shift-0',
    mac: 'Alt-Shift-‚', // Opt-Shift-0 on macOS
    run: unfoldAll,
  },
]
