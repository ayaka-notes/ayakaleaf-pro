import { TimedOutError } from './Errors.js'

// ContentCacheManager stub for clsi-typst.
//
// PDF content caching (per-range chunked streaming of the PDF) is a TeX
// feature of the main clsi; clsi-typst does not enable it. The shared
// OutputCacheManager still imports this module, so `update` reports a soft
// timeout, which OutputCacheManager degrades gracefully to (status
// 'timed-out', the full-PDF streaming path).
export default {
  update(options, callback) {
    setImmediate(() => callback(new TimedOutError('pdf caching not enabled for typst')))
  },
}
