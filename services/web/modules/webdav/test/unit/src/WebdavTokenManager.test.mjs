import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const WebdavUserCredentials = vi.hoisted(() => ({
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  deleteOne: vi.fn(),
  find: vi.fn(),
}))

vi.mock('../../../app/models/webdavUserCredentials.mjs', () => ({
  WebdavUserCredentials,
}))

// Deterministic encryption pair: encrypt = base64-encode JSON, decrypt = reverse.
vi.mock('../../../app/src/WebdavTokenEncryption.mjs', () => ({
  encrypt: vi.fn(async (data) => Buffer.from(JSON.stringify(data)).toString('base64')),
  decrypt: vi.fn(async (blob) => JSON.parse(Buffer.from(blob, 'base64').toString('utf8'))),
}))

const { default: WebdavTokenManager } = await import('../../../app/src/WebdavTokenManager.mjs')
const { encrypt: encryptDirect, decrypt: decryptDirect } = await import(
  '../../../app/src/WebdavTokenEncryption.mjs'
)

describe('WebdavTokenManager', () => {
  const userId = 'test-user'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('saves encrypted credentials and retrieves them', async () => {
    const testCredentials = {
      baseUrl: 'https://nextcloud.example.com',
      username: 'testuser',
      password: 'testpass',
    }

    await WebdavTokenManager.saveUserCredentials(userId, testCredentials)

    expect(encryptDirect).toHaveBeenCalledWith(testCredentials)
    expect(WebdavUserCredentials.findOneAndUpdate).toHaveBeenCalledWith(
      { userId },
      expect.objectContaining({ $set: expect.objectContaining({ credentials: expect.any(String) }) }),
      expect.objectContaining({ upsert: true })
    )

    const blob = WebdavUserCredentials.findOneAndUpdate.mock.calls[0][1].$set.credentials
    WebdavUserCredentials.findOne.mockResolvedValue({ credentials: blob })

    const retrieved = await WebdavTokenManager.getUserCredentials(userId)

    expect(decryptDirect).toHaveBeenCalled()
    expect(retrieved).toEqual(testCredentials)
  })

  it('rejects for a user without credentials', async () => {
    WebdavUserCredentials.findOne.mockResolvedValue(null)

    let thrown
    try {
      await WebdavTokenManager.getUserCredentials('nonexistent-user')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeTruthy()
  })

  it('removes credentials by user id', async () => {
    WebdavUserCredentials.deleteOne.mockResolvedValue({ deletedCount: 1 })

    await WebdavTokenManager.removeUserCredentials(userId)

    expect(WebdavUserCredentials.deleteOne).toHaveBeenCalledWith({ userId })
  })

  it('returns the linked user ids', async () => {
    const ids = ['user1', 'user2', 'user3']
    WebdavUserCredentials.find.mockResolvedValue(ids.map((id) => ({ userId: id })))

    const linkedIds = await WebdavTokenManager.getLinkedUserIds()

    expect(linkedIds).toHaveLength(3)
    expect(linkedIds).toEqual(expect.arrayContaining(ids))
  })
})
