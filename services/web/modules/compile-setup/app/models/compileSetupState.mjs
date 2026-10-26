import mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'

const { Schema } = mongoose
const { ObjectId } = Schema

// One document per project that has been through the compile-settings prompt.
// A missing document means the prompt still has to be shown.
export const CompileSetupStateSchema = new Schema(
  {
    projectId: {
      type: ObjectId,
      ref: 'Project',
      required: true,
      unique: true,
    },
    completedAt: { type: Date, required: true },
    completedBy: { type: ObjectId, ref: 'User' },
  },
  { collection: 'compileSetupStates', minimize: false }
)

export const CompileSetupState = mongoose.model(
  'CompileSetupState',
  CompileSetupStateSchema
)
