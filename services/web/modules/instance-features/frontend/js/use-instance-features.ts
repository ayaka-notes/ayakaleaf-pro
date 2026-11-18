import { useEffect, useState } from 'react'
import { getJSON } from '@/infrastructure/fetch-json'
import '../stylesheets/settings-linking.scss'
// The settings page has no slot of its own for this module's styles
import '../../../user-emails/frontend/stylesheets/add-email.scss'

export type InstanceFeatures = {
  ai: boolean
  githubSync: boolean
  gitlabSync: boolean
  giteaSync: boolean
  dropbox: boolean
  zotero: boolean
  mendeley: boolean
  gitBridge: boolean
}

const DISABLED: InstanceFeatures = {
  ai: false,
  githubSync: false,
  gitlabSync: false,
  giteaSync: false,
  dropbox: false,
  zotero: false,
  mendeley: false,
  gitBridge: false,
}

// The frontend is compiled once, so it can't read the operator's env vars.
// Instead it asks the server (GET /system/features) which features this user
// can use: those the instance has, unless an admin turned them off for the
// user. Statically bundled UI (github-sync, gitlab-sync, gitea-sync, dropbox,
// zotero, mendeley, git-bridge) hides itself when its feature is off. Fetched
// at most once per page load and shared across every caller.
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
          gitlabSync: Boolean(data?.gitlabSync),
          giteaSync: Boolean(data?.giteaSync),
          dropbox: Boolean(data?.dropbox),
          zotero: Boolean(data?.zotero),
          mendeley: Boolean(data?.mendeley),
          gitBridge: Boolean(data?.gitBridge),
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
