import { expect } from 'chai'
import { db, ObjectId } from '../../../app/src/infrastructure/mongodb.mjs'
import { exec } from 'node:child_process'

describe('CleanupUsersSplitTestsMigration', function () {
  beforeEach('insert data', async function () {
    await db.splittests.insertMany([
      { name: 'archived-test', archived: true },
      { name: 'non-archived-test', archived: false },
    ])
    await db.users.insertMany([
      {
        _id: new ObjectId('50e434d90000000000000000'),
        email: 'foo0@bar.com',
      },
      {
        _id: new ObjectId('50e434d90000000000000001'),
        email: 'foo1@bar.com',
        splitTests: {
          'archived-test': [
            {
              variantName: 'default',
              versionNumber: 2,
              phase: 'release',
              assignedAt: new Date('2025-10-22T14:23:29.738Z'),
            },
          ],
        },
      },
      {
        _id: new ObjectId('50e434d90000000000000002'),
        email: 'foo2@bar.com',
        splitTests: {
          'non-archived-test': [
            {
              variantName: 'default',
              versionNumber: 2,
              phase: 'release',
              assignedAt: new Date('2025-10-22T14:23:29.738Z'),
            },
          ],
        },
      },
      {
        _id: new ObjectId('50e434d90000000000000003'),
        email: 'foo3@bar.com',
        splitTests: {
          'non-archived-test': [
            {
              variantName: 'default',
              versionNumber: 2,
              phase: 'release',
              assignedAt: new Date('2025-10-22T14:23:29.738Z'),
            },
          ],
          'archived-test': [
            {
              variantName: 'default',
              versionNumber: 2,
              phase: 'release',
              assignedAt: new Date('2025-10-22T14:23:29.738Z'),
            },
          ],
        },
      },
    ])
  })

  beforeEach('run migration', function (done) {
    exec(
      'cd ../../tools/migrations && yarn run migrations migrate -t saas --force 20260504100000_cleanup_users_split_tests',
      done
    )
  })

  it('should update the users', async function () {
    expect(
      await db.users
        .find({}, { projection: { _id: 1, email: 1, splitTests: 1 } })
        .toArray()
    ).to.deep.equal([
      {
        _id: new ObjectId('50e434d90000000000000000'),
        email: 'foo0@bar.com',
      },
      {
        _id: new ObjectId('50e434d90000000000000001'),
        email: 'foo1@bar.com',
        splitTests: {},
      },
      {
        _id: new ObjectId('50e434d90000000000000002'),
        email: 'foo2@bar.com',
        splitTests: {
          'non-archived-test': [
            {
              variantName: 'default',
              versionNumber: 2,
              phase: 'release',
              assignedAt: new Date('2025-10-22T14:23:29.738Z'),
            },
          ],
        },
      },
      {
        _id: new ObjectId('50e434d90000000000000003'),
        email: 'foo3@bar.com',
        splitTests: {
          'non-archived-test': [
            {
              variantName: 'default',
              versionNumber: 2,
              phase: 'release',
              assignedAt: new Date('2025-10-22T14:23:29.738Z'),
            },
          ],
        },
      },
    ])
  })
})
