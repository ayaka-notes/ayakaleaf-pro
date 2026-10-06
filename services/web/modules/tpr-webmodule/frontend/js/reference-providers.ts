import type {
  BinaryFile,
  LinkedFileData,
} from '@/features/file-view/types/binary-file'

export type ReferenceProviderId = 'zotero' | 'mendeley'

type ReferenceProvider = {
  id: ReferenceProviderId
  i18n: {
    importedAtDate: string
    loadingError: string
    loadingErrorForbidden: string
    loadingErrorExpired: string
  }
}

/**
 * Everything the shared `tpr-file-view-*` components need to know about a
 * reference manager. Provider-specific UI (create-file pane, settings widget,
 * integration card) stays in its own per-provider file; only the file-view
 * chrome is shared, because core renders just one of those components
 * (`file-view-refresh-button.tsx` and friends take `.map(...)[0]`).
 *
 * The i18n keys MUST be spelled out as string literals here.
 * `scripts/translations/cleanupUnusedLocales.js` decides whether a key is still
 * in use by plain substring search over the source tree, so keys built from a
 * template (`${id}_reference_loading_error`) would be pruned from locales/*.json.
 */
export const REFERENCE_PROVIDERS: Record<ReferenceProviderId, ReferenceProvider> =
  {
    zotero: {
      id: 'zotero',
      i18n: {
        importedAtDate: 'imported_from_zotero_at_date',
        loadingError: 'zotero_reference_loading_error',
        loadingErrorForbidden: 'zotero_reference_loading_error_forbidden',
        loadingErrorExpired: 'zotero_reference_loading_error_expired',
      },
    },
    mendeley: {
      id: 'mendeley',
      i18n: {
        importedAtDate: 'imported_from_mendeley_at_date',
        loadingError: 'mendeley_reference_loading_error',
        loadingErrorForbidden: 'mendeley_reference_loading_error_forbidden',
        loadingErrorExpired: 'mendeley_reference_loading_error_expired',
      },
    },
  }

/**
 * The reference provider that imported this linked file, or undefined for any
 * other linked file (url, project_file, project_output_file), which the shared
 * components must leave alone.
 */
export function getReferenceProvider(
  file: BinaryFile<keyof LinkedFileData>
): ReferenceProvider | undefined {
  const provider = file.linkedFileData?.provider as string | undefined
  if (provider && provider in REFERENCE_PROVIDERS) {
    return REFERENCE_PROVIDERS[provider as ReferenceProviderId]
  }
  return undefined
}

/** Only the importer may refresh; the backend enforces the same rule. */
export function isOriginalImporter(
  file: BinaryFile<keyof LinkedFileData>,
  userId: string | null | undefined
): boolean {
  const importerId = (file.linkedFileData as any)?.importer_id
  return Boolean(importerId && userId && importerId === userId)
}
