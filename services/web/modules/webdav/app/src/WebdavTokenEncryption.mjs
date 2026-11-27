import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import AccessTokenEncryptorClass from '@overleaf/access-token-encryptor'

/**
 * Default file path for storing encryption credentials.
 * Used when WEBDAV_TOKEN_CIPHER_FILE is not set in environment.
 */
const defaultFile = '/var/lib/overleaf/data/.webdav-token-cipher.json'

let encryptor

/**
 * Gets or creates the crypto encryptor instance for WebDAV tokens.
 * Reads from WEBDAV_TOKEN_CIPHER_PASSWORD env var if available, otherwise
 * loads from file (creating it if needed).
 * 
 * @returns {AccessTokenEncryptorClass} The initialized encryptor instance
 */
function getEncryptor() {
  if (encryptor) return encryptor

  const file = process.env.WEBDAV_TOKEN_CIPHER_FILE || defaultFile
  const label = process.env.WEBDAV_TOKEN_CIPHER_LABEL || 'OL_WEBDAV-v3'
  const password = process.env.WEBDAV_TOKEN_CIPHER_PASSWORD
  let data

  if (password) {
    const cipherPasswords = { [label]: password }
    // Key-rotation support (P0-3): an optional LEGACY label + password is added
    // to the cipher map so documents encrypted under the old key keep decrypting
    // (the library selects the scheme by the stored string's label prefix),
    // while NEW documents are always encrypted with the default (new) label.
    const prevLabel = process.env.WEBDAV_TOKEN_CIPHER_PREVIOUS_LABEL
    const prevPassword = process.env.WEBDAV_TOKEN_CIPHER_PREVIOUS_PASSWORD
    if (prevLabel && prevPassword) {
      if (prevLabel === label) {
        throw new Error('WEBDAV_TOKEN_CIPHER_PREVIOUS_LABEL must differ from the active label')
      }
      cipherPasswords[prevLabel] = prevPassword
    }
    data = { cipherLabel: label, cipherPasswords }
  } else {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      data = {
        cipherLabel: label,
        cipherPasswords: { [label]: crypto.randomBytes(32).toString('base64') },
      }
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 })
    }
  }

  encryptor = new AccessTokenEncryptorClass(data)
  return encryptor
}

/**
 * Encrypts WebDAV user credentials using the configured encryption method.
 * Stores encrypted data in the webdavUserCredentials collection.
 *
 * @param {Object} credentials - The credentials to encrypt (userId, baseUrl, username, password)
 * @returns {Promise<string>} Base64-encoded encrypted string
 * 
 * @example
 * const encrypted = await encrypt({
 *   userId: 'user123',
 *   baseUrl: 'https://nextcloud.example.com/remote.php/dav',
 *   username: 'alice',
 *   password: 'secret'
 * })
 */
export async function encrypt(credentials) {
  return getEncryptor().promises.encryptJson(credentials)
}

/**
 * Decrypts WebDAV user credentials that were previously encrypted.
 * Used when retrieving stored credentials from the database.
 *
 * @param {string} encryptedData - Base64-encoded encrypted string
 * @returns {Promise<Object>} Decrypted credentials object
 * 
 * @example
 * const credentials = await decrypt('eyJhbGciOi...')
 */
export async function decrypt(credentials) {
  return getEncryptor().promises.decryptToJson(credentials)
}