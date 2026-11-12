import {
  Compartment,
  Extension,
  Facet,
  TransactionSpec,
} from '@codemirror/state'

const docFolderConf = new Compartment()
const openDocPathConf = new Compartment()

/**
 * Folder of the open document (null at the project root), for resolving
 * document-relative file paths.
 */
export const docFolderFacet = Facet.define<string | null, string | null>({
  combine: values => values[0] ?? null,
})

export const docFolder = (docFolder: string | null): Extension =>
  docFolderConf.of(docFolderFacet.of(docFolder))

export const setDocFolder = (docFolder: string | null): TransactionSpec => ({
  effects: docFolderConf.reconfigure(docFolderFacet.of(docFolder)),
})

/**
 * Full slashed tree path of the open document (e.g. 'chapters/main.typ').
 * 'null' when the editor isn't open on a doc. Used by the Typst #include/
 * #import offers to filter out the doc being edited (a doc can't #include
 * itself in Typst — the compile would error on the cycle).
 */
export const openDocPathFacet = Facet.define<string | null, string | null>({
  combine: values => values[0] ?? null,
})

export const openDocPath = (openDocPath: string | null): Extension =>
  openDocPathConf.of(openDocPathFacet.of(openDocPath))

export const setOpenDocPath = (openDocPath: string | null): TransactionSpec => ({
  effects: openDocPathConf.reconfigure(openDocPathFacet.of(openDocPath)),
})
