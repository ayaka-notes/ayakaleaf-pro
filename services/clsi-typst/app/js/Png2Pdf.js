// Png2Pdf stub for clsi-typst.
//
// TeX-specific: convert slow PNGs to PDF. Typst handles images natively — the
// shared HistoryResourceWriter still imports this module, so the entry points
// report disabled.
export default {
  isEnabled() {
    return false
  },
  async convertPngFilesInCacheDir(
    _projectId,
    _cacheDir,
    _files,
    _stats,
    _timings
  ) {},
}
