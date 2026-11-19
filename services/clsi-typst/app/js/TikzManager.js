// TikzManager stub for clsi-typst.
//
// TeX-specific: tikz external figures need a main-file shim + output file
// injection. Typst has no equivalent — the shared HistoryResourceWriter still
// imports this module, so the entry points are no-ops.
export default {
  async checkMainFile(_compileDir, _rootResourcePath, _resourceList) {
    return false
  },
  async injectOutputFile(_compileDir, _rootResourcePath) {},
  async writeOutputFileIfNeeded(_compileDir, _snapshot, _content) {},
}
