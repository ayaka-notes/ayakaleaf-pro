import mongoose from '../infrastructure/Mongoose.mjs'

const { Schema } = mongoose

const SystemMessageSchema = new Schema(
  {
    content: { type: String, default: '' },
    // #17d: when true the banner's dismiss (X) button is suppressed --
    // e.g. for emergency/maintenance messages that must not be hidden
    // by users. Off by default (existing messages stay dismissable).
    unremovable: { type: Boolean, default: false },
    // #17b (port from go experimental branch): per-message surface
    // placements ('editor' | 'hub' | 'auth'). A missing or empty list
    // means the message is visible on ALL pages (legacy behavior).
    // `minimize: false` (schema option) keeps empty arrays in the DB.
    placements: { type: [String], default: [] },
  },
  { minimize: false }
)

export const SystemMessage = mongoose.model(
  'SystemMessage',
  SystemMessageSchema
)
