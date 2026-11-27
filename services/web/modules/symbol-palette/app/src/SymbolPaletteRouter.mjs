import logger from '@overleaf/logger'

// The palette only lives in the browser, so hiding it is all it takes: the
// toolbar button and the Insert menu follow symbolPaletteAvailable. A user has
// it unless an admin set features.symbolPalette to false.
function hideFromUsersWithoutIt(req, res, next) {
  const originalRender = res.render
  res.render = (view, options, callback) => {
    if (options?.user?.features?.symbolPalette === false) {
      options.symbolPaletteAvailable = false
    }
    originalRender.call(res, view, options, callback)
  }
  next()
}

export default {
  apply(webRouter) {
    logger.debug({}, 'Init SymbolPalette router')

    // The editor's routes, as in core's router, which comes after the modules
    for (const route of [
      '/Project/:Project_id',
      '/Project/:Project_id/:detachRole(detacher|detached)',
    ]) {
      webRouter.get(route, hideFromUsersWithoutIt)
    }
  },
}
