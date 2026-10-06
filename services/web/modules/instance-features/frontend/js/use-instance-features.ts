import { useEffect, useState } from 'react'
import { getJSON } from '@/infrastructure/fetch-json'

export type InstanceFeatures = {
  ai: boolean
  githubSync: boolean
  zotero: boolean
  mendeley: boolean
}

const DISABLED: InstanceFeatures = {
  ai: false,
  githubSync: false,
  zotero: false,
  mendeley: false,
}

// The frontend is compiled once, so it can't read the operator's env vars.
// Instead it asks the server (GET /system/features) which instance-level
// features are enabled, and statically bundled UI (github-sync, zotero,
// mendeley) hides itself when its feature is off. Fetched at most once per page
// load and shared across every caller.
let cache: InstanceFeatures | null = null
let inflight: Promise<InstanceFeatures> | null = null

function loadInstanceFeatures(): Promise<InstanceFeatures> {
  if (cache) {
    return Promise.resolve(cache)
  }
  if (!inflight) {
    inflight = getJSON('/system/features')
      .then((data: Partial<InstanceFeatures>) => {
        cache = {
          ai: Boolean(data?.ai),
          githubSync: Boolean(data?.githubSync),
          zotero: Boolean(data?.zotero),
          mendeley: Boolean(data?.mendeley),
        }
        return cache
      })
      .catch(() => DISABLED)
  }
  return inflight
}

// Defaults to all-disabled until the request resolves, so we never briefly
// flash UI for a feature that might be turned off.
export default function useInstanceFeatures(): InstanceFeatures {
  const [features, setFeatures] = useState<InstanceFeatures>(cache || DISABLED)

  useEffect(() => {
    let mounted = true
    loadInstanceFeatures().then(f => {
      if (mounted) {
        setFeatures(f)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  return features
}
