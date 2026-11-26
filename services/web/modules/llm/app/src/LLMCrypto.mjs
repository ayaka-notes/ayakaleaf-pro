import crypto from 'node:crypto'
import logger from '@overleaf/logger'

// overleaf-lab: at-rest encryption for per-user LLM API keys (AES-256-GCM).
// The key is derived from LLM_KEY_SECRET (auto-generated & persisted by
// configure.sh). Values are stored as `enc:v1:<iv>:<tag>:<ciphertext>` (base64).
// Legacy plaintext values (no `enc:v1:` prefix) are read back unchanged, and a
// missing LLM_KEY_SECRET degrades gracefully (keys stored/read as plaintext)
// instead of crashing.

const ENC_PREFIX = 'enc:v1:'
const KEK_SALT = 'overleaf-lab-llm-key-v1'
const IV_BYTES = 12

// Guard so we only warn once about the missing secret (avoids log spam).
let warnedMissingSecret = false

function deriveKey(secret) {
    return crypto.scryptSync(secret, KEK_SALT, 32)
}

export function encryptSecret(plain) {
    if (!plain) {
        return plain
    }

    const secret = process.env.LLM_KEY_SECRET
    if (!secret) {
        if (!warnedMissingSecret) {
            warnedMissingSecret = true
            logger.warn(
                {},
                '[LLM] LLM_KEY_SECRET is not set: per-user API keys are stored UNENCRYPTED at rest'
            )
        }
        return plain
    }

    const key = deriveKey(secret)
    const iv = crypto.randomBytes(IV_BYTES)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()

    return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

export function decryptSecret(stored) {
    if (!stored) {
        return stored
    }

    return storedToPlaintext(stored)
}

/*
 * F20 helpers (legacy-row migration safety):
 * - normalizeStoredSecret: value already encrypted -> as-is;
 *   legacy plaintext -> encrypt now (so rows never persist plaintext keys).
 * - storedToPlaintext: encrypted -> decrypt; legacy plaintext -> as-is.
 */
export function hasEncPrefix(v) {
    return typeof v === 'string' && v.startsWith(ENC_PREFIX)
}

export function normalizeStoredSecret(v) {
    if (!v) return ''
    if (hasEncPrefix(v)) return v
    return encryptSecret(String(v))
}

export function storedToPlaintext(stored) {
    if (!stored) {
        return stored
    }

    // Legacy plaintext back-compat: values written before encryption was added
    // (or while LLM_KEY_SECRET was unset) have no prefix and are returned as-is.
    if (!stored.startsWith(ENC_PREFIX)) {
        return stored
    }

    const secret = process.env.LLM_KEY_SECRET
    if (!secret) {
        logger.error(
            {},
            '[LLM] Cannot decrypt stored API key: value is encrypted but LLM_KEY_SECRET is not set'
        )
        return ''
    }

    try {
        const [ivB64, tagB64, ctB64] = stored.slice(ENC_PREFIX.length).split(':')
        if (!ivB64 || !tagB64 || !ctB64) {
            throw new Error('malformed encrypted value')
        }

        const key = deriveKey(secret)
        const iv = Buffer.from(ivB64, 'base64')
        const tag = Buffer.from(tagB64, 'base64')
        const ct = Buffer.from(ctB64, 'base64')

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
        decipher.setAuthTag(tag)
        const plain = Buffer.concat([decipher.update(ct), decipher.final()])
        return plain.toString('utf8')
    } catch (err) {
        // Wrong key (rotated/lost secret) or tampering: fail closed so chat
        // reports "not configured" rather than crashing the request.
        logger.error({ err }, '[LLM] Failed to decrypt stored API key')
        return ''
    }
}
