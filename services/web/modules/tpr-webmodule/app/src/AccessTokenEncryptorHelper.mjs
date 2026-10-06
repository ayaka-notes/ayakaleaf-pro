import AccessTokenEncryptorClass from '@overleaf/access-token-encryptor'
import Settings from '@overleaf/settings'
import fs from 'node:fs'
import crypto from 'node:crypto'
import Path from 'node:path'

const CIPHER_LABEL = '2024.1-v3'

const encryptorInstances = new Map()

function _cipherKeyFile(provider) {
  return `/var/lib/overleaf/data/.${provider}-cipher-key`
}

/**
 * Get or create a stable cipher password that persists across container
 * recreations. Priority:
 *   1. <PROVIDER>_CIPHER_PASSWORD env var (explicit user config)
 *   2. Key file in the persistent volume (/var/lib/overleaf/data/)
 *      — auto-generated on first use, survives container rebuilds
 */
function _getStableCipherPassword(provider) {
  const fromEnv = process.env[`${provider.toUpperCase()}_CIPHER_PASSWORD`]
  if (fromEnv) {
    return fromEnv
  }
  const cipherKeyFile = _cipherKeyFile(provider)
  try {
    const existing = fs.readFileSync(cipherKeyFile, 'utf8').trim()
    if (existing.length >= 16) {
      return existing
    }
  } catch {
    // File doesn't exist yet — generate one
  }
  const newKey = crypto.randomBytes(32).toString('base64')
  const dir = Path.dirname(cipherKeyFile)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(cipherKeyFile, newKey, { mode: 0o600 })
  return newKey
}

function _getEncryptor(provider) {
  let encryptorInstance = encryptorInstances.get(provider)
  if (!encryptorInstance) {
    const encryptorSettings =
      Settings[provider]?.encryptor || Settings.oauthProviders?.encryptor
    if (!encryptorSettings) {
      const cipherLabel =
        process.env[`${provider.toUpperCase()}_CIPHER_LABEL`] || CIPHER_LABEL
      const cipherPassword = _getStableCipherPassword(provider)
      encryptorInstance = new AccessTokenEncryptorClass({
        cipherLabel,
        cipherPasswords: {
          [cipherLabel]: cipherPassword,
        },
      })
    } else {
      encryptorInstance = new AccessTokenEncryptorClass(encryptorSettings)
    }
    encryptorInstances.set(provider, encryptorInstance)
  }
  return encryptorInstance
}

/**
 * Per-provider token encryptor. Each reference manager keeps its own cipher
 * key file and its own <PROVIDER>_CIPHER_PASSWORD / <PROVIDER>_CIPHER_LABEL
 * env vars, so tokens stored by one provider are never readable with another's
 * key.
 */
export function createAccessTokenEncryptor(provider) {
  return {
    promises: {
      async encryptJson(json) {
        return await _getEncryptor(provider).promises.encryptJson(json)
      },
      async decryptToJson(encryptedJson) {
        return await _getEncryptor(provider).promises.decryptToJson(
          encryptedJson
        )
      },
    },
  }
}
