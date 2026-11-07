import { ExposedSettings } from '../../../../../types/exposed-settings'

export type GitSyncModalStatus =
    'loading'
  | 'need-export'
  | 'cannot-export'
  | 'need-auth'
  | 'need-permission'
  | 'merge-overview'
  | 'confirm-unlink'
  | 'unlink-unavailable'
  | 'run-merge'
  | 'run-merge-resolved'
  | 'show-conflict'

export type ProjectSyncState = {
  mergeStatus: 'clean' | 'conflict' | 'diverged' | 'need-export' | 'need-permission'
  repoFullName: string
  unmergedBranchName: string | null
  ownerEmail?: string
}

// giteaUrl is added to ExposedSettings by GiteaSyncRouter
export type GitSyncExposedSettings = ExposedSettings & { giteaUrl: string }
