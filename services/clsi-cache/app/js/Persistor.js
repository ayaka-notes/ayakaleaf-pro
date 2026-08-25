import Settings from '@overleaf/settings'
import ObjectPersistor from '@overleaf/object-persistor'

const persistorSettings = { ...Settings.persistor, paths: Settings.path }
const persistor = ObjectPersistor(persistorSettings)

export default persistor
