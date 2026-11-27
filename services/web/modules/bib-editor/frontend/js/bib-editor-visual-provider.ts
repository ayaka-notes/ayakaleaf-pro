/**
 * Visual editor provider for the bib-editor module.
 * Registered via overleafModuleImports.visualEditorProviders in settings.
 *
 * This enables the Code/Visual toggle for .bib files so that clicking
 * "Visual" opens the bibliography editor inside the main editor window
 * instead of a separate sidebar rail panel.
 */
import React from 'react'
import { getFileExtension } from '@/features/source-editor/utils/file'

/**
 * Stable lazy-loaded reference to the visual editor component.
 * Must be created at module level so the reference is stable across renders.
 */
const BibEditorVisual = React.lazy(() => import('./components/bib-editor-panel'))

/** Unique id used for the per-file editor mode storage key. */
export const id = 'bib-editor'

export function isVisualEditorAvailable(filename: string): boolean {
    return getFileExtension(filename) === 'bib'
}

export function getVisualEditorComponent(
    filename: string
): typeof BibEditorVisual | null {
    return isVisualEditorAvailable(filename) ? BibEditorVisual : null
}
