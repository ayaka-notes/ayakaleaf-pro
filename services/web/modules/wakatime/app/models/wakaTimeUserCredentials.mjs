import mongoose from "../../../../app/src/infrastructure/Mongoose.mjs"

const { Schema } = mongoose
const { ObjectId } = Schema

export const WakaTimeUserCredentialsSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true, unique: true },
    apiUrl: { type: String, required: true },
    apiKeyEncrypted: { type: Schema.Types.Mixed, required: true },
  },
  { collection: 'wakaTimeUserCredentials', minimize: false }
)

export const WakaTimeUserCredentials = mongoose.model(
  'WakaTimeUserCredentials',
  WakaTimeUserCredentialsSchema,
)
