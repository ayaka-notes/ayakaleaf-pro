import { db } from './lib/mongodb.mjs'
import { batchedUpdate } from '@overleaf/mongo-utils/batchedUpdate.js'

const tags = ['saas', 'server-ce', 'server-pro']

const migrate = async () => {
  const splitTests = await db.splittests.find().toArray()
  const toCleanup = {}
  for (const splitTest of splitTests) {
    if (splitTest.archived) {
      toCleanup[`splitTests.${splitTest.name}`] = 1
    }
  }
  // Take the easy route and unset all the archived split tests on all the users with any split test assignment.
  await batchedUpdate(
    db.users,
    { splitTests: { $exists: true } },
    { $unset: toCleanup }
  )
}

const rollback = async () => {
  // The data is gone. Nothing to revert to.
}

export default {
  tags,
  migrate,
  rollback,
}
