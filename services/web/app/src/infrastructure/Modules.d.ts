import type { RequestInit, Response } from 'node-fetch'

export type V1RequestOptions = Omit<RequestInit, 'method'> & {
  uri: string
  qs?: Record<string, string | undefined>
  expectJson?: boolean
  expectedStatusCodes?: number[]
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
}

export interface KnownHookSignatures {
  makeV1Request: (
    options: V1RequestOptions
  ) => Promise<{ body: unknown; response: Response }>
}

export type HookName = keyof KnownHookSignatures | string

export type HookParameters<K extends HookName> =
  K extends keyof KnownHookSignatures
    ? Parameters<KnownHookSignatures[K]>
    : any[]

export type HookReturnType<K extends HookName> =
  K extends keyof KnownHookSignatures
    ? Awaited<ReturnType<KnownHookSignatures[K]>>
    : any
