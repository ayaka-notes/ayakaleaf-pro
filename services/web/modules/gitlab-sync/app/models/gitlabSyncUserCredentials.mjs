import mongoose from "../../../../app/src/infrastructure/Mongoose.mjs"

const { Schema } = mongoose
const { ObjectId } = Schema

export const GitLabSyncUserCredentialsSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true, unique: true },
    // encrypted { accessToken, refreshToken, expiresAt }
    gitlab: { type: String, required: true },
  },
  { collection: 'gitlabSyncUserCredentials', minimize: false }
)

export const GitLabSyncUserCredentials = mongoose.model(
  'GitLabSyncUserCredentials',
  GitLabSyncUserCredentialsSchema,
)
