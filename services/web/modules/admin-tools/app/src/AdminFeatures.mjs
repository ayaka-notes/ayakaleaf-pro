import Modules from '../../../../app/src/infrastructure/Modules.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import UserFeaturesUpdater from '../../../../app/src/Features/Subscription/UserFeaturesUpdater.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'

// What an admin set in user.features has to outlive core's refreshFeatures,
// which runs when an email is confirmed or removed: it writes the defaults and
// the overrides back over user.features, and merging overrides only raises a
// feature, never lowers one. So the admin's values also go into one entry of
// featuresOverrides, upstream's place for per-user features, and each refresh
// writes them last.

const ADMIN_OVERRIDE_NOTE = 'admin-panel'

export async function rememberAdminFeatures(userId, features) {
  const { matchedCount } = await User.updateOne(
    { _id: userId, 'featuresOverrides.note': ADMIN_OVERRIDE_NOTE },
    {
      $set: Object.fromEntries(
        Object.entries(features).map(([key, value]) => [
          `featuresOverrides.$.features.${key}`,
          value,
        ])
      ),
    }
  ).exec()
  if (matchedCount === 0) {
    await UserFeaturesUpdater.promises.createFeaturesOverride(userId, {
      note: ADMIN_OVERRIDE_NOTE,
      features,
    })
  }
  // Same hook as when core suspends a user: an account that may not use Dropbox
  // is unlinked, so that nothing keeps syncing in the background
  if (features.dropbox === false) {
    await Modules.promises.hooks.fire('removeDropbox', userId, 'admin-panel')
  }
}

// In the module, not in core: refreshFeatures goes through this function of the
// exported object, and nothing else writes user.features
export function keepAdminFeaturesOnRefresh() {
  const { updateFeatures } = UserFeaturesUpdater.promises
  UserFeaturesUpdater.promises.updateFeatures = async (userId, features) => {
    const user = await UserGetter.promises.getUser(userId, {
      featuresOverrides: 1,
    })
    const adminOverride = user?.featuresOverrides?.find(
      override => override.note === ADMIN_OVERRIDE_NOTE
    )
    return await updateFeatures(userId, {
      ...features,
      ...adminOverride?.features,
    })
  }
}
