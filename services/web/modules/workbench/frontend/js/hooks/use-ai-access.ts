import { useEffect, useState } from 'react'
import { getJSON } from '@/infrastructure/fetch-json'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'

// Share the permission request across chat and compile-log components.
type AiAccess = { chat: boolean; errorAssistant: boolean; textExtract: boolean; textOnly: boolean }
let access: Promise<AiAccess> | undefined

function loadAccess(): Promise<AiAccess> {
  access ??= getJSON('/workbench/access')
    .then((data: { allowed: boolean; errorAssistant: boolean; textExtract?: boolean; textOnly?: boolean }) => ({
      chat: data.allowed === true,
      errorAssistant: data.errorAssistant === true,
      // overleaf-lab (2026-11): per-user text-extraction mode — page text
      // instead of page images for render_pdf_page; the server does the same
      // for attachments.
      textExtract: data.textExtract === true,
      // overleaf-lab (2026-11-05): the resolved lane is text-only (server-
      // probed once, cached) — same page-text behavior, no user setting.
      textOnly: data.textOnly === true,
    }))
    .catch(() => {
      access = undefined
      return { chat: false, errorAssistant: false, textExtract: false, textOnly: false }
    })
  return access
}

export default function useAiAccess(feature: keyof AiAccess = 'chat') {
  const { ai } = useInstanceFeatures()
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    if (!ai) return
    let active = true
    loadAccess().then(value => {
      if (active) setAllowed(value[feature])
    })
    return () => {
      active = false
    }
  }, [ai, feature])

  return ai && allowed
}

// overleaf-lab (2026-11): text-extraction mode for render_pdf_page (the tool
// hands the model extracted page text instead of a rendered page image).
// overleaf-lab (2026-11-05): page text when the user setting is on OR the
// resolved lane is text-only (image parts would be rejected by the provider).
export function useTextExtract(): boolean {
  const { ai } = useInstanceFeatures()
  const [on, setOn] = useState(false)

  useEffect(() => {
    if (!ai) return
    let active = true
    loadAccess().then(value => {
      if (active) setOn(value.textExtract || value.textOnly)
    })
    return () => {
      active = false
    }
  }, [ai])

  return ai && on
}
