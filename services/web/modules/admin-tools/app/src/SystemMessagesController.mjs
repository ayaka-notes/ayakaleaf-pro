import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expressify } from '@overleaf/promise-utils'
import { User } from '../../../../app/src/models/User.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserSettingsHelper from '../../../../app/src/Features/Project/UserSettingsHelper.mjs'
import SystemMessageManager from '../../../../app/src/Features/SystemMessages/SystemMessageManager.mjs'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

/**
 * The "System Messages" pane of the classic /admin page, now a standalone
 * React page at /admin/messages. Initial message list (DB truth, not the
 * user-facing /system/messages endpoint) is prefetched into a meta tag.
 */
async function manageMessagesPage(req, res, next) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const user = await User.findById(userId, 'ace')
  const userSettings = await UserSettingsHelper.buildUserSettings(req, res, user)

  // The public list endpoint shows the synthetic 'protected' message when
  // the site is closed; admins manage the real DB rows either way.
  const systemMessages =
    (await SystemMessageManager.promises.getMessagesFromDB()) || []

  res.render(Path.resolve(__dirname, '../views/system-messages-react'), {
    title: 'System Messages',
    userSettings,
    systemMessages,
  })
  return undefined
}

export default {
  manageMessagesPage: expressify(manageMessagesPage),
}
