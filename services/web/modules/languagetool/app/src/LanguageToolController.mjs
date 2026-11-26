import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import fetch from 'node-fetch'

const MAX_TEXT_SIZE = 100_000 // 100 KB limit for safety

/**
 * Truncate an annotated `data` payload so its serialized text stays within
 * MAX_TEXT_SIZE. Offsets are computed over the text LT will actually receive
 * (annotations reconstructed as `a.text ?? a.markup`, joined), so we must
 * never hand LT a truncated JSON envelope (it would reject the request and
 * offsets could no longer map to the client document).
 *
 * Annotation item shape (see LTAnnotation in the frontend):
 *   { text?: string, markup?: string }   (text and markup are exclusive)
 *
 * Returns:
 *  - { ok: true, value }     — safe value (string or { annotation: [...] })
 *  - { ok: false, code }     — payload cannot be represented within the limit;
 *                              caller should answer with the given status
 */
function truncateData(data) {
  const envelopeSize = ann => JSON.stringify({ annotation: ann }).length

  // Truncate the first item's text (or markup) in place until the serialized
  // envelope fits. Bisection needed because JSON escaping (quotes, backslashes)
  // can make the serialized text larger than the raw string.
  function truncateFirstItem(first) {
    if (!first || typeof first !== 'object') return null
    const field = typeof first.text === 'string' ? 'text' : typeof first.markup === 'string' ? 'markup' : null
    if (!field) return null
    const fits = v => JSON.stringify({ annotation: [{ ...first, [field]: v }] }).length <= MAX_TEXT_SIZE
    if (fits(first[field])) return { ...first, [field]: first[field] }
    let lo = 0
    let hi = first[field].length
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (fits(first[field].slice(0, mid))) lo = mid
      else hi = mid
    }
    if (lo === 0) return null
    return { ...first, [field]: first[field].slice(0, lo) }
  }

  let ann = null
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data)
      if (parsed && Array.isArray(parsed.annotation)) ann = parsed.annotation
    } catch {
      // Plain text — truncate as text
      return { ok: true, value: data.slice(0, MAX_TEXT_SIZE) }
    }
  } else if (data && Array.isArray(data.annotation)) {
    ann = data.annotation
  } else {
    return { ok: true, value: JSON.stringify(data).slice(0, MAX_TEXT_SIZE) }
  }

  if (!ann || ann.length === 0) {
    return { ok: false, code: 413 }
  }

  if (envelopeSize(ann) <= MAX_TEXT_SIZE) {
    return { ok: true, value: { annotation: ann } }
  }

  // Per-item serialized overhead (envelope, braces, escaping) for the
  // early-break heuristic; the final size is verified exactly below.
  const emptyEnvelope = JSON.stringify({ annotation: [] }).length
  const itemSize = item => JSON.stringify({ annotation: [item] }).length - emptyEnvelope

  const out = []
  let used = 0
  for (const item of ann) {
    const size = itemSize(item)
    if (used + size >= MAX_TEXT_SIZE - emptyEnvelope) break
    used += size
    out.push(item)
  }

  if (out.length === 0) {
    // Even the first annotation is over budget: truncate its text/markup so
    // the payload is still a valid JSON envelope and the sent text remains a
    // true prefix of the client document (offsets stay valid).
    const item = truncateFirstItem(ann[0])
    if (item) return { ok: true, value: { annotation: [item] } }
    return { ok: false, code: 413 }
  }

  // Exact final check (commas/escaping between items can add bytes):
  // pop trailing items until the envelope fits. Dropping trailing
  // annotations shifts nothing — LT offsets are computed over the
  // reconstructed text and the kept prefix is unchanged.
  while (envelopeSize(out) > MAX_TEXT_SIZE) {
    out.pop()
    if (out.length === 0) {
      // Fall through to single-item truncation of the first annotation
      const item = truncateFirstItem(ann[0])
      if (item) return { ok: true, value: { annotation: [item] } }
      return { ok: false, code: 413 }
    }
  }
  return { ok: true, value: { annotation: out } }
}

// Levels understood by the LanguageTool fork we deploy
// (erikvl87/languagetool supports: default and picky).
const ALLOWED_LEVELS = new Set([
  'default',
  'normal',
  'careful',
  'meticulous',
  'picky',
])

const LanguageToolController = {

  /**
   * GET /languagetool/languages
   * Returns the list of supported languages from the LT service
   */
  async getLanguages(req, res, next) {
    try {
      const response = await fetch(`${Settings.languageToolURL}/v2/languages`, {
        headers: { Accept: 'application/json' },
        timeout: 5000,
      })

      if (!response.ok) {
        logger.error(
          { status: response.status },
          'LanguageTool languages request failed'
        )
        return res.status(502).json({ error: 'LanguageTool request failed' })
      }

      const data = await response.json()
      res.json(data)
    } catch (err) {
      logger.error({ err }, 'Error fetching LanguageTool languages')
      next(err)
    }
  },

  /**
   * POST /languagetool/check
   * Proxies text/annotation data to the LanguageTool service and returns matches.
   * Accepts JSON body: { language, level?, text?, data? }
   *
   * `level` is optional; when omitted the LanguageTool default level is used.
   * The client sends `picky` when the project's "picky mode" is enabled —
   * picky is the recommended default in this deployment.
   */
  async check(req, res, next) {
    const { language = 'auto', level, text, data } = req.body

    if (!text && !data) {
      return res.status(400).json({ error: 'text or data is required' })
    }

    if (level && !ALLOWED_LEVELS.has(level)) {
      return res.status(400).json({ error: `unknown level: ${level}` })
    }

    try {
      const params = new URLSearchParams()
      params.set('language', language)

      if (level) {
        params.set('level', level)
      }

      if (data) {
        const truncated = truncateData(data)
        if (!truncated.ok) {
          return res.status(truncated.code).json({
            error: 'document is too large to check',
          })
        }
        const value = truncated.value
        params.set('data', typeof value === 'string' ? value : JSON.stringify(value))
      } else {
        params.set('text', (text || '').slice(0, MAX_TEXT_SIZE))
      }

      // Disable rules that produce excessive false positives in LaTeX documents
      params.set(
        'disabledRules',
        'WHITESPACE_RULE,COMMA_PARENTHESIS_WHITESPACE,CONSECUTIVE_SPACES,DASH_RULE,UPPERCASE_SENTENCE_START'
      )

      const response = await fetch(`${Settings.languageToolURL}/v2/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params.toString(),
        timeout: 60_000,
      })

      if (!response.ok) {
        const body = await response.text()
        logger.error(
          { status: response.status, level, body: body.slice(0, 500) },
          'LanguageTool check failed'
        )
        return res
          .status(502)
          .json({ error: 'LanguageTool check failed', serverStatus: response.status })
      }

      const result = await response.json()
      res.json(result)
    } catch (err) {
      // On timeout or network error return empty results so the linter stays silent
      if (err.type === 'request-timeout' || err.name === 'FetchError') {
        logger.warn({ err }, 'LanguageTool check timed out or failed, returning empty results')
        return res.json({ matches: [] })
      }
      logger.error({ err }, 'Error checking text with LanguageTool')
      next(err)
    }
  },
}

export default LanguageToolController
