import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
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
 *   1. ZOTERO_CIPHER_PASSWORD env var (explicit user config)
 *   2. JSON file with encryptor data in the persistent volume (/var/lib/overleaf/data/)
 *      — auto-generated on first use, survives container rebuilds
 */
function _getEncryptorData() {
  const cipherPassword = process.env.ZOTERO_TOKEN_CIPHER_PASSWORD || process.env.TOKEN_CIPHER_PASSWORD
  const cipherLabel = process.env.ZOTERO_TOKEN_CIPHER_LABEL ||
                      process.env.TOKEN_CIPHER_LABEL ||
                      TOKEN_CIPHER_LABEL
  if (cipherPassword) {
    return {
      cipherLabel,
      cipherPasswords: {
        [cipherLabel]: cipherPassword
      }
    }
  }
  // cipherPassword is not set, use file
  const cipherFile = process.env.ZOTERO_TOKEN_CIPHER_FILE ||
                     process.env.TOKEN_CIPHER_FILE ||
                     TOKEN_CIPHER_FILE
  try {
    return JSON.parse(fs.readFileSync(cipherFile, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.info({ cipherFile }, 'Creating new cipherFile')
    } else {
      logger.error({ err, cipherFile }, 'Bad cipherFile')
      throw err
    }
  }
  // File doesn't exist yet — generate one
  try {
    const encryptorData = {
      cipherLabel,
      cipherPasswords: {
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
