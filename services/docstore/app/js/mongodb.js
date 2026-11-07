// @ts-check

import Metrics from '@overleaf/metrics'

import Settings from '@overleaf/settings'
import MongoUtils from '@overleaf/mongo-utils'
import mongodb from 'mongodb-legacy'

const { MongoClient, ObjectId, BSON, ReadPreference } = mongodb

const mongoClient = new MongoClient(Settings.mongo.url, Settings.mongo.options)
const mongoDb = mongoClient.db()

const db = {
  docs: mongoDb.collection('docs'),
}

Metrics.mongodb.monitor(mongoClient)

async function cleanupTestDatabase() {
  await MongoUtils.cleanupTestDatabase(mongoClient)
}

const READ_PREFERENCE_PRIMARY = ReadPreference.primary.mode
const READ_PREFERENCE_SECONDARY = Settings.mongo.hasSecondaries
  ? ReadPreference.secondary.mode
  : ReadPreference.secondaryPreferred.mode

export default {
  READ_PREFERENCE_PRIMARY,
  READ_PREFERENCE_SECONDARY,
  db,
  mongoClient,
  ObjectId,
  BSON,
  cleanupTestDatabase,
}
