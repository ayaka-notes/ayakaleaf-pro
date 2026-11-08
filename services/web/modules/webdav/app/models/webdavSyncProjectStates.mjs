import Mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'

const Schema = Mongoose.Schema

const webdavSyncSchema = new Schema(
  {
    projectId: { type: Schema.Types.Mixed, required: true },
    // WebDAV connection state
    connected: { type: Boolean, default: false },
    baseUrl: { type: String, required: true },
    rootPath: { type: String, required: true },
    username: { type: String, required: true },
    // Password is optional for backward compatibility with existing projects
    // Link endpoint requires it explicitly via validation
    password: { type: String },
    // Last sync info (optional)
    lastSyncCommit: { type: String }, // Could use commit hash or version identifier
    lastSyncVersion: { type: Number }, // Overleaf project version number
    mergeStatus: {
      type: String,
      enum: ['clean', 'diverged', 'conflict'],
      default: 'clean',
    },
    // Owning user (whoever linked the project). Required for correct unlink/
    // user-expire cleanup (docs created before this field lack ownerId — cleanups
    // fall back to matching the user's credentials baseUrl).
    ownerId: { type: Schema.Types.Mixed, ref: 'User' },
    // Sync tracking (optional)
    lastSyncAt: { type: Date }, // Last successful sync time
    lastSyncError: { type: String }, // Error message from last sync attempt
    lastConflict: {
      path: { type: String }, // Path of conflicting file
      localVersion: { type: String },
      remoteVersion: { type: String },
      timestamp: { type: Date },
    },
  },
  { timestamps: true }
)

webdavSyncSchema.index({ projectId: 1 })
webdavSyncSchema.index({ ownerId: 1 })
// H.2: legacy lookup selector (pre-ownerId docs matched by username)
webdavSyncSchema.index({ username: 1 })

export const WebdavSyncProjectStates =
  Mongoose.model('WebdavSyncProjectState', webdavSyncSchema)
