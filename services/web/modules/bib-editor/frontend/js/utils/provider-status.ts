/**
 * Which reference managers are configured on this instance.
 *
 * GET /bib/services → { zotero: boolean, mendeley: boolean }
 * The bib-editor panel and the library page use this to HIDE their
 * "Import from Zotero / Mendeley" entries when the connector is not
 * configured (client id and/or secret unset) — instead of offering a
 * menu item that can only 403.
 *
 * `null` = not loaded yet (treated as hidden), `boolean` = known.
 */
import { useEffect, useState } from 'react'
import { getJSON } from '@/infrastructure/fetch-json'

export type BibServices = {
  zotero: boolean | null
  mendeley: boolean | null
}

let cache: BibServices | null = null

export function useBibServices(): BibServices {
  const [services, setServices] = useState<BibServices | null>(cache)

  useEffect(() => {
    if (cache) return
    let alive = true
    void getJSON<{ zotero: boolean; mendeley: boolean }>('/bib/services')
      .then(data => {
        const next = {
          zotero: Boolean(data.zotero),
          mendeley: Boolean(data.mendeley),
        }
        cache = next
        if (alive) setServices(next)
      })
      .catch(() => {
        // Endpoint missing (old server) or not logged in: nothing hidden
        // wrongly — keep the entries visible; clicking them will 403 with
        // a clear message.
        const next = { zotero: null, mendeley: null }
        cache = next
        if (alive) setServices(next)
      })
    return () => {
      alive = false
    }
  }, [])

  if (services) return services
  return { zotero: null, mendeley: null }
}
