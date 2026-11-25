/**
 * SiteSettings secret cipher.
 *
 * Same AES-256-GCM cipher family and the SAME cipher-key file/label as
 * the github-sync / gitlab-sync / dropbox `AccessTokenEncryptorHelper`
 * implementations in this repo (see those modules' TokenManager files):
 * the standard Overleaf cipher layout
 * `{ cipherLabel, cipherPasswords: { [label]: secret } }`, env
 * overrides first, persistent file second (0600).
 *
 * Sharing the cipher means rotating the cipher password has the same
 * effect everywhere: stored secrets must be re-entered — the documented,
 * expected behavior, not a new mechanism.
 */
import logger from '@overleaf/logger'
import fs from 'node:fs'
import crypto from 'node:crypto'
import Path from 'node:path'
import AccessTokenEncryptorClass from '@overleaf/access-token-encryptor'

const CIPHER_FILE =
  (process.env.SITE_SETTINGS_CIPHER_FILE ||
    process.env.TOKEN_CIPHER_FILE ||
    '/var/lib/overleaf/data/.token-cipher.json')
const CIPHER_LABEL =
  (process.env.SITE_SETTINGS_CIPHER_LABEL || process.env.TOKEN_CIPHER_LABEL || 'OL_CEP-v3')

let encryptorInstance = null

function getEncryptorData() {
  const cipherPassword = process.env.TOKEN_CIPHER_PASSWORD
  if (cipherPassword) {
    return {
      cipherLabel: CIPHER_LABEL,
      cipherPasswords: { [CIPHER_LABEL]: cipherPassword },
    }
  }
  try {
    return JSON.parse(fs.readFileSync(CIPHER_FILE, 'utf8'))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    logger.info({ cipherFile: CIPHER_FILE }, 'SiteSettings: creating cipher file')
    const encryptorData = {
      cipherLabel: CIPHER_LABEL,
      cipherPasswords: {
        [CIPHER_LABEL]: crypto.randomBytes(32).toString('base64'),
      },
    }
    fs.mkdirSync(Path.dirname(CIPHER_FILE), { recursive: true })
    fs.writeFileSync(CIPHER_FILE, JSON.stringify(encryptorData, null, 2), { mode: 0o600 })
    return encryptorData
  }
}

function getEncryptor() {
  if (!encryptorInstance) {
    encryptorInstance = new AccessTokenEncryptorClass(getEncryptorData())
  }
  return encryptorInstance
}

export async function encryptText(value) {
  return String(value)
    ? `ss::${await getEncryptor().promises.encryptJson(value)}`
    : ''
}

export async function decryptText(value) {
  if (typeof value !== 'string' || value === '') return ''
  if (value.startsWith('ss::')) {
    return getEncryptor().promises.decryptToJson(value.slice(4))
  }
  // Compatibility with values written by the github-sync / dropbox token
  // ciphers (no ss:: prefix).
  return getEncryptor().promises.decryptToJson(value)
}
