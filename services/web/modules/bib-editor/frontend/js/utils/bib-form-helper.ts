/**
 * Per-row helper text mapping for the shared bib entry form (C2 §1.2).
 *
 * Returns the i18n KEY for the field's helper line, or null when the field
 * has none. The component renders `t(key)`; keeping the mapping pure (no
 * i18n import) makes it unit-testable.
 *
 * P0 (plan §2.4, 2026-08-28): the `Separate multiple names with "and"`
 * helper shown under Author/Editor was user-reported as a stray string and
 * removed on both surfaces (project + library). author/editor (incl.
 * derived name rows) intentionally map to null now — this file is the
 * single source of truth so the line cannot silently resurface.
 */
export function helperKeyForField(fieldName: string): string | null {
  if (fieldName === 'pages') return 'Page range'
  if (fieldName === 'doi') {
    return 'The identifier only, not the full URL, e.g. 10.1000/xyz123'
  }
  if (fieldName === 'eprint') {
    return 'The preprint archive identifier, e.g. math/0307200v3'
  }
  return null
}
