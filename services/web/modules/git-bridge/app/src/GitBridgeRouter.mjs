import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import AuthenticationController from "../../../../app/src/Features/Authentication/AuthenticationController.mjs"
import AuthorizationManager from "../../../../app/src/Features/Authorization/AuthorizationManager.mjs"
import { parseReq, z, zz } from "../../../../app/src/infrastructure/Validation.mjs"
import GitBridgeApiController from "./GitBridgeApiController.mjs"

const projectParamsSchema = z.object({
    params: z.object({ project_id: zz.objectId() }),
})

function requireProjectAccess(checkPermission) {
    return expressify(async (req, res, next) => {
        const { params } = parseReq(req, projectParamsSchema)
        if (!(await checkPermission(req.oauth_user._id.toString(), params.project_id))) {
            return res.status(403).json({ message: 'restricted' })
        }
        next()
    })
}

export default {
    apply(webRouter, privateApiRouter, publicApiRouter) {
        const r = privateApiRouter || webRouter

        logger.debug({}, 'Init git-bridge router')

        // Git Bridge API v0
        r.get('/api/v0/docs/:project_id',
            AuthenticationController.requireOauth('git_bridge'),
            requireProjectAccess(AuthorizationManager.promises.canUserReadProject),
            GitBridgeApiController.getDoc
        )
        r.get(
            '/api/v0/docs/:project_id/saved_vers',
            AuthenticationController.requireOauth('git_bridge'),
            requireProjectAccess(AuthorizationManager.promises.canUserReadProject),
            GitBridgeApiController.getSavedVers
        )
        r.get(
            '/api/v0/docs/:project_id/snapshots/:version',
            AuthenticationController.requireOauth('git_bridge'),
            requireProjectAccess(AuthorizationManager.promises.canUserReadProject),
            GitBridgeApiController.getSnapshot
        )
        r.post(
            '/api/v0/docs/:project_id/snapshots',
            AuthenticationController.requireOauth('git_bridge'),
            requireProjectAccess(AuthorizationManager.promises.canUserWriteProjectContent),
            GitBridgeApiController.postSnapshot
        )
    }
}