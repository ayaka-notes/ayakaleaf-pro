/**
 * Mendeley access-token encryption — delegate to the base tpr-webmodule
 * helper for provider 'mendeley' (per-provider cipher:
 * MENDELEY_CIPHER_PASSWORD / MENDELEY_CIPHER_LABEL or the shared key file).
 *
 * Same pattern as the vendored zotero helper: one cipher per provider, and
 * never a locally-derived key, so credentials stored from anywhere in this
 * app decrypt consistently.
 */
import {
  createAccessTokenEncryptor,
} from '../../../../../tpr-webmodule/app/src/AccessTokenEncryptorHelper.mjs'

const mendeley = createAccessTokenEncryptor('mendeley')

export const AccessTokenEncryptor = {
  encryptJson: json => mendeley.promises.encryptJson(json),
  decryptToJson: encryptedJson => mendeley.promises.decryptToJson(encryptedJson),
}
