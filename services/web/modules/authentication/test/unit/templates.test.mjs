import { expect, describe, it } from 'vitest'
import {
  providerTemplate,
  prettyTemplate,
  normalizeProvider,
} from '../../providers/index.mjs'

describe('provider templates', () => {
  it('produces valid SAML provider JSON', () => {
    const template = providerTemplate('saml', 'uni', 'Uni Bremen')
    const normalized = normalizeProvider(template)
    expect(normalized.type).toBe('saml')
    expect(normalized.saml.entryPoint).toBeTruthy()
    expect(normalized.attrs.userId).toBeTruthy()
  })

  it('produces valid OIDC provider JSON', () => {
    const template = providerTemplate('oidc', 'kc', 'Keycloak')
    const normalized = normalizeProvider(template)
    expect(normalized.type).toBe('oidc')
    expect(normalized.oidc.issuer).toBeTruthy()
  })

  it('produces a valid EduGAIN SAML template', () => {
    const template = providerTemplate('saml', 'edu', 'EduGAIN', 'edugain')
    expect(template.preset).toBe('edugain')
    expect(template.attrs.userId).toBe('eduPersonPrincipalName')
    expect(template.filter.allow.length).toBeGreaterThan(0)
    // still valid JSON after normalization
    normalizeProvider(template)
  })

  it('produces a valid EduGAIN OIDC template', () => {
    const template = providerTemplate('oidc', 'edu', 'EduGAIN', 'edugain')
    normalizeProvider(template)
  })

  it('prettyTemplate returns parseable JSON', () => {
    const json = prettyTemplate('saml', 'uni', 'Uni Bremen', 'edugain')
    const parsed = JSON.parse(json)
    expect(parsed.id).toBe('uni')
  })
})
