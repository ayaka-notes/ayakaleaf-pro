import type { ProjectStatus } from '../shared/project-status'

type Person = { id: string; email?: string; firstName?: string; lastName?: string }

export type ProjectEntry = {
  path: string
  type: 'folder' | 'doc' | 'file'
  // docs: their id, for the main document menu
  id?: string
  createdAt?: string
}

// What AdminProjectController.projectPage renders into ol-adminProject
export type AdminProjectMeta = {
  project: {
    id: string
    name: string
    status: ProjectStatus
    createdAt: string
    lastUpdated?: string
    lastOpened?: string
    linkSharing: boolean
    compiler?: string
    imageName?: string
    texLiveVersion?: string
    mainDocument?: string
    rootDocId?: string
    historyId?: string
    size?: number
    deletedAt?: string
    entries: ProjectEntry[]
  }
  owner?: Person
  // the owner of a deleted project, also when the owner is gone
  ownerId?: string
  members?: (Person & {
    privilegeLevel: 'owner' | 'readAndWrite' | 'readOnly' | 'review'
    source: 'owner' | 'invite' | 'token'
  })[]
  invites?: { id: string; email: string; privilegeLevel: string }[]
  deletedDocs?: { id: string; name: string; deletedAt: string }[]
  imageNames?: { imageName: string; imageDesc: string }[]
  deleter?: { id?: string; email?: string; ipAddress?: string }
  sessionUserId: string
}
