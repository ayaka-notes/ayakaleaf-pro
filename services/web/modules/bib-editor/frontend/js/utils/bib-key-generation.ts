/**
 * Deterministic citation-key generation for the visual bib editor.
 *
 * Policy (aligned with the Overleaf reference manager and yu-i-i's editor,
 * overleaf-cep @ ca8fd03): "Generate" never no-ops and never falls back to
 * randomness —
 *
 *  - no usable first author  -> `Unknown`
 *  - no 4-digit year         -> `0000`
 *
 * so every entry yields a stable, testable key. Collision resolution always
 * goes through the shared `pickAvailableKey` suffix generator (bijective
 * base-26: `base`, `basea`, `baseb`, …), and an entry being renamed never
 * collides with itself (`ownKey` is excluded from the taken set).
 *
 * Non-ASCII letters/digits are kept in the key: btparse/biber accept them
 * (see shared/bibtex/bibtex-identifier.mts), so CJK/accented surnames still
 * yield a usable key. Generated keys are additionally lowercased to match
 * existing module-generated keys (`Unknown` reads `unknown0000` here).
 */
import { BibtexNameList } from '@shared/bibtex/bibtex-name.mts'
import { pickAvailableKey } from '@/features/bibtex/citation-key'

/** Same non-key class as the shared unicode-aware key generator. */
const NON_KEY_CHARS = /[^\p{L}\p{N}]/gu
const VALID_YEAR = /^\d{4}$/

export function generateCitationKey(fields: Record<string, string>): string {
  const first = new BibtexNameList((fields.author || '').trim()).names[0]
  let surname = first ? first.toLast().replace(NON_KEY_CHARS, '') : ''
  if (!surname) surname = 'Unknown'
  const year = (fields.year || '').trim()
  const yearPart = VALID_YEAR.test(year) ? year : '0000'
  return (surname + yearPart).toLowerCase()
}

/**
 * Pick the first available suffix for `base`, excluding `ownKey` (an entry
 * being renamed must not be rejected by its own old key).
 */
export function pickAvailableForEntry(
  base: string,
  existingKeys: readonly string[],
  ownKey?: string
): string {
  const taken =
    ownKey === undefined
      ? existingKeys
      : existingKeys.filter(key => key !== ownKey)
  return pickAvailableKey(base, [...taken])
}

/** Generate a unique key using the same policy for every editor write path. */
export function generateAvailableCitationKey(
  fields: Record<string, string>,
  existingKeys: readonly string[],
  ownKey?: string
): string {
  return pickAvailableForEntry(
    generateCitationKey(fields),
    existingKeys,
    ownKey
  )
}

/**
 * Display-only suggestion (form placeholder). The source key stays empty
 * until explicitly edited.
 */
export function displayCitationKey(
  entry: { id?: string; fields?: Record<string, string> },
  existingKeys: readonly string[]
): string {
  const id = (entry.id || '').trim()
  if (id) return id
  return generateAvailableCitationKey(entry.fields || {}, existingKeys, id)
}
