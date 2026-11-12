// DraftModeManager stub for clsi-typst.
//
// TeX-specific: draft mode wraps the preamble. Typst has no equivalent — the
// shared HistoryResourceWriter still imports this module, so PREFIX is kept
// and injectDraftMode is a no-op.
const PREFIX = ''

export default {
  PREFIX,
  async injectDraftMode() {},
}
