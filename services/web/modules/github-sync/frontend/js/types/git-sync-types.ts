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

// githubUrl is added to ExposedSettings by GitHubSyncRouter
export type GitSyncExposedSettings = ExposedSettings & { githubUrl: string }
