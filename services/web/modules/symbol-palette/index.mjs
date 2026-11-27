import logger from '@overleaf/logger'
import SymbolPaletteRouter from './app/src/SymbolPaletteRouter.mjs'
/** @import { WebModule } from "../../../../types/web-module" */

logger.debug({}, 'Enable Symbol Palette')

/** @type {WebModule} */
const symbolPaletteModule = {
  router: SymbolPaletteRouter,
}
export default symbolPaletteModule
