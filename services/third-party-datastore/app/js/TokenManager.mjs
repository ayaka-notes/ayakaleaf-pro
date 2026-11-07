import Settings from '@overleaf/settings'
import AccessTokenEncryptor from '@overleaf/access-token-encryptor'
import { db, ObjectId } from './mongodb.mjs'

// The web module dropbox writes the token with the same cipher
const { tokenCipherLabel, tokenCipherPassword } = Settings.dropbox
const accessTokenEncryptor = new AccessTokenEncryptor({
  cipherLabel: tokenCipherLabel,
  cipherPasswords: { [tokenCipherLabel]: tokenCipherPassword },
})

// users.dropbox: { access_token: { uid }, access_token_oauth2: { encrypted }, cursor }
async function getUserDropbox(userId) {
  const user = await db.users.findOne(
    { _id: new ObjectId(userId) },
    { projection: { dropbox: 1 } }
  )
  return user?.dropbox?.access_token?.uid ? user.dropbox : null
}

// Returns { accountId, encrypted, refreshToken } for a linked user, or null
async function getUserTokens(userId) {
  const dropbox = await getUserDropbox(userId)
  const encrypted = dropbox?.access_token_oauth2?.encrypted
  if (!encrypted) {
    return null
  }
  const token = await accessTokenEncryptor.promises.decryptToJson(encrypted)
  return {
    accountId: dropbox.access_token.uid,
    encrypted,
    refreshToken: token.refresh_token,
  }
}

export default { getUserDropbox, getUserTokens }
