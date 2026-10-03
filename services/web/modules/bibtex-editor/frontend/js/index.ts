// Public entry point for the visual BibTeX editor module.
export { BibtexEditor } from './components/BibtexEditor'
export type { BibtexEditorProps } from './components/BibtexEditor'
export { BibtexEntryTable } from './components/BibtexEntryTable'
export { default as BibtexEntryModal } from './components/BibtexEntryModal'
export { default as BibtexImportModal } from './components/BibtexImportModal'
export { useUndoableValue } from './hooks/useUndoableValue'
export * from './bibtex/field-schema'

// data layer (also usable headless)
export * from './bibtex'
