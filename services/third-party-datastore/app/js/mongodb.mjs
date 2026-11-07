import Metrics from '@overleaf/metrics'
import Settings from '@overleaf/settings'
import mongodb from 'mongodb-legacy'

const { MongoClient, ObjectId } = mongodb

export const mongoClient = new MongoClient(Settings.mongo.url)
const internalDb = mongoClient.db()

// Collections and indexes are owned by web (tools/migrations)
export const db = {
  // { overleaf: { userId, projectId, id }, dropbox: { id, pathLower, ... } }
  dropboxEntities: internalDb.collection('dropboxEntities'),
  // { userId, projectId, dropboxId, pathLower }
  dropboxProjects: internalDb.collection('dropboxProjects'),
  // the Dropbox token and cursor live in users.dropbox
  users: internalDb.collection('users'),
}

Metrics.mongodb.monitor(mongoClient)

export { ObjectId }
