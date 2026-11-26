import type { AdminUser } from '../admin-users/types'

export type UserDetails = AdminUser & {
  hasPassword: boolean
  lastLoginIp?: string
  emails: { email: string; primary: boolean; confirmed: boolean }[]
  identifiers: {
    type: 'saml' | 'oidc'
    providerId?: string
    name?: string
    externalUserId?: string
  }[]
  locked: { details: boolean; isAdmin: boolean }
  features: Record<string, unknown>
  aiEnabled: boolean
}

export type AdminUserMeta = {
  user: UserDetails
  sessionUserId: string
  integrations?: {
    gitTokens: {
      id: string
      prefix: string
      createdAt: string
      expiresAt: string
      lastUsedAt?: string
    }[]
    linked: Record<
      'github' | 'gitlab' | 'gitea' | 'dropbox' | 'zotero' | 'mendeley',
      boolean
    >
  }
  auditLog?: {
    operation: string
    timestamp: string
    initiatorId?: string
    initiatorEmail?: string
    ipAddress?: string
    info?: Record<string, unknown>
  }[]
  sessions?: { ip_address: string; session_created: string }[]
  deleter?: { id?: string; email?: string; ipAddress?: string }
}
