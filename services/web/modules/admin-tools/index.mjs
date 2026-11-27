import AdminToolsRouter from './app/src/AdminToolsRouter.mjs'
import { keepAdminFeaturesOnRefresh } from './app/src/AdminFeatures.mjs'

/**
 * @import { WebModule } from "../../types/web-module"
 */

keepAdminFeaturesOnRefresh()

/** @type {WebModule} */
const AdminToolsModule = {
  router: AdminToolsRouter,
}
export default AdminToolsModule
