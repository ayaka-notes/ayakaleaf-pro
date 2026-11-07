import { expect } from 'chai'
import { db, ObjectId } from '../../../app/src/infrastructure/mongodb.mjs'
import { exec } from 'node:child_process'

describe('BackFillUsersAnalyticsId', function () {
  beforeEach('insert data', async function () {
    await db.users.insertMany([
      {
        _id: new ObjectId('50e434d90000000000000000'),
        email: 'foo0@bar.com',
      },
      {
        _id: new ObjectId('50e434d90000000000000001'),
        email: 'foo1@bar.com',
      },
      {
        _id: new ObjectId('50e434d90000000000000002'),
        analyticsId: '32dc5866-1451-4209-ba9d-23e96caafecd',
        email: 'foo2@bar.com',
      },
      {
        _id: new ObjectId('50e434d90000000000000003'),
        analyticsId: '32dc5866-1451-4209-ba9d-23e96caafecf',
        email: 'foo3@bar.com',
      },
    ])
  })

  beforeEach('run migration', function (done) {
    exec(
      'cd ../../tools/migrations && yarn run migrations migrate -t saas --force 20260424120000_back_fill_users_analyticsId',
      done
    )
  })

  it('should update the users', async function () {
    expect(
      await db.users
        .find({}, { projection: { _id: 1, email: 1, analyticsId: 1 } })
        .toArray()
    ).to.deep.equal([
      {
        _id: new ObjectId('50e434d90000000000000000'),
        analyticsId: '50e434d90000000000000000',
        email: 'foo0@bar.com',
      },
      {
        _id: new ObjectId('50e434d90000000000000001'),
        analyticsId: '50e434d90000000000000001',
        email: 'foo1@bar.com',
      },
      {
        _id: new ObjectId('50e434d90000000000000002'),
        analyticsId: '32dc5866-1451-4209-ba9d-23e96caafecd',
        email: 'foo2@bar.com',
      },
      {
        _id: new ObjectId('50e434d90000000000000003'),
        analyticsId: '32dc5866-1451-4209-ba9d-23e96caafecf',
        email: 'foo3@bar.com',
      },
    ])
  })

  describe('after rolling back', function () {
    beforeEach(function (done) {
      exec(
        'cd ../../tools/migrations && yarn run migrations rollback -t saas --force 20260424120000_back_fill_users_analyticsId',
        done
      )
    })
    it('should update the users and roll back', async function () {
      expect(
        await db.users
          .find({}, { projection: { _id: 1, email: 1, analyticsId: 1 } })
          .toArray()
      ).to.deep.equal([
        {
          _id: new ObjectId('50e434d90000000000000000'),
          email: 'foo0@bar.com',
        },
        {
          _id: new ObjectId('50e434d90000000000000001'),
          email: 'foo1@bar.com',
        },
        {
          _id: new ObjectId('50e434d90000000000000002'),
          analyticsId: '32dc5866-1451-4209-ba9d-23e96caafecd',
          email: 'foo2@bar.com',
        },
        {
          _id: new ObjectId('50e434d90000000000000003'),
          analyticsId: '32dc5866-1451-4209-ba9d-23e96caafecf',
          email: 'foo3@bar.com',
        },
      ])
    })
  })
})
