import mongoose from "../../../../app/src/infrastructure/Mongoose.mjs"

const { Schema } = mongoose
const { ObjectId } = Schema

export const GiteaSyncUserCredentialsSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true, unique: true },
    // encrypted { accessToken, refreshToken, expiresAt }
    gitea: { type: String, required: true },
  },
  { collection: 'giteaSyncUserCredentials', minimize: false }
)

export const GiteaSyncUserCredentials = mongoose.model(
  'GiteaSyncUserCredentials',
  GiteaSyncUserCredentialsSchema,
)
