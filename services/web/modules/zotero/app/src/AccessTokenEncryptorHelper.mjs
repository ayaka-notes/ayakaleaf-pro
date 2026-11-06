import logger from '@overleaf/logger'
import fs from 'node:fs'
import crypto from 'node:crypto'
import Path from 'node:path'
import AccessTokenEncryptorClass from '@overleaf/access-token-encryptor'

const TOKEN_CIPHER_FILE = '/var/lib/overleaf/data/.token-cipher.json'
const TOKEN_CIPHER_LABEL = 'OL_CEP-v3'

let encryptorInstance = null

/**
 * Get or create a stable encryptor data that persists across container
 * recreations. Priority:
 *   1. ZOTERO_TOKEN_CIPHER_PASSWORD env var (explicit user config)
 *   2. JSON file with encryptor data in the persistent volume (/var/lib/overleaf/data/)
 *      — auto-generated on first use, survives container rebuilds
 */
function _legacyCipherPair() {
  // tpr-webmodule-era credentials (the connector that stored zotero tokens
  // before 2026-11-05): label '2024.1-v3' (or ZOTERO_CIPHER_LABEL), key from
  // ZOTERO_CIPHER_PASSWORD or the .zotero-cipher-key file on the data volume.
  const legacyLabel = process.env.ZOTERO_CIPHER_LABEL || '2024.1-v3'
  let legacyPassword = process.env.ZOTERO_CIPHER_PASSWORD
  if (!legacyPassword) {
    try {
      legacyPassword = fs.readFileSync(
        '/var/lib/overleaf/data/.zotero-cipher-key', 'utf8'
      ).trim()
    } catch (err) {
      legacyPassword = undefined
    }
  }
  if (!legacyPassword) return null
  return {
    cipherPasswords: { [legacyLabel]: legacyPassword },
  }
}

function _getEncryptorData() {
  const cipherPassword = process.env.ZOTERO_TOKEN_CIPHER_PASSWORD || process.env.TOKEN_CIPHER_PASSWORD
  const cipherLabel = process.env.ZOTERO_TOKEN_CIPHER_LABEL ||
                      process.env.TOKEN_CIPHER_LABEL ||
                      TOKEN_CIPHER_LABEL
  const legacy = _legacyCipherPair()
  if (cipherPassword) {
    return {
      cipherLabel,
      cipherPasswords: {
        ...(legacy ? legacy.cipherPasswords : {}),
        [cipherLabel]: cipherPassword
      }
    }
  }
  // cipherPassword is not set, use file
  const cipherFile = process.env.ZOTERO_TOKEN_CIPHER_FILE ||
                     process.env.TOKEN_CIPHER_FILE ||
                     TOKEN_CIPHER_FILE
  try {
    const fromFile = JSON.parse(fs.readFileSync(cipherFile, 'utf8'))
    return {
      ...fromFile,
      cipherPasswords: {
        ...(legacy ? legacy.cipherPasswords : {}),
        ...(fromFile.cipherPasswords || {}),
      },
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.info({ cipherFile }, 'Creating new cipherFile')
    } else {
      logger.error({ err, cipherFile }, 'Bad cipherFile')
      throw err
    }
  }
  // File doesn't exist yet — generate one (legacy tpr key is read from its
  // own source at runtime, so old tokens stay decryptable without being
  // copied into the new file)
  try {
    const encryptorData = {
      cipherLabel,
      cipherPasswords: {
        ...((legacy && legacy.cipherPasswords) || {}),
        [cipherLabel]: crypto.randomBytes(32).toString('base64')
      },
    }

    const dir = Path.dirname(cipherFile)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(cipherFile, JSON.stringify(encryptorData, null, 2), { mode: 0o600 })
    return encryptorData

  } catch (err) {
    logger.error({ err, cipherFile }, 'Cannot create cipherFile')
    throw err
  }
}

function _getEncryptor() {
  if (!encryptorInstance) {
    const encryptorData = _getEncryptorData()
    encryptorInstance = new AccessTokenEncryptorClass(encryptorData)
  }
  return encryptorInstance
}

export const AccessTokenEncryptor = {
  async encryptJson(json) {
    return await _getEncryptor().promises.encryptJson(json)
  },
  async decryptToJson(encryptedJson) {
    return await _getEncryptor().promises.decryptToJson(encryptedJson)
  },
}
