/**
 * Manual pluralization helper.
 *
 * The CE core i18n runs i18next with `compatibilityJSON: 'v3'`
 * (frontend/js/i18n.ts), which DISABLES the modern `_one`/`_other`
 * suffix plural handling — a count-based lookup always returns
 * base key. So we pick the singular/plural key explicitly and pass
 * `count` for `__count__` interpolation (v3-style `__var__` works).
 */
type TFunc = (key: string, opts?: Record<string, unknown>) => string

export function plural(
  t: TFunc,
  count: number,
  singularKey: string,
  pluralKey: string
): string {
  return t(count === 1 ? singularKey : pluralKey, { count })
}
