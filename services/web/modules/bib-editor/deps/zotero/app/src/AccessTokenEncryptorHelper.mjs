/**
 * Zotero access-token encryption — delegate to the base tpr-webmodule
 * helper for provider 'zotero'.
 *
 * The base connector (modules/tpr-webmodule) and this picker must use the
 * EXACT same cipher for the same user, because both read/write
 * user.refProviders.zotero.apiKeyEncrypted and the settings-panel link flow
 * uses the base connector. The previous locally-duplicated helper derived its
 * cipher password from a different source (TOKEN_CIPHER_PASSWORD /
 * .token-cipher.json vs the base's ZOTERO_CIPHER_PASSWORD /
 * .zotero-cipher-key), so tokens stored by one side failed to decrypt on the
 * other ("zotero_not_linked" 409s for users who were linked).
 */
import {
  createAccessTokenEncryptor,
} from '../../../../../tpr-webmodule/app/src/AccessTokenEncryptorHelper.mjs'

const zotero = createAccessTokenEncryptor('zotero')

export const AccessTokenEncryptor = {
  encryptJson: json => zotero.promises.encryptJson(json),
  decryptToJson: encryptedJson => zotero.promises.decryptToJson(encryptedJson),
}
