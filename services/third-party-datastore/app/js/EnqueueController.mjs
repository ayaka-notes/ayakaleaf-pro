import { expressify } from '@overleaf/promise-utils'
import QueueManager from './QueueManager.mjs'

// TpdsUpdateSender.enqueue: { group: userId, method, job }
async function enqueue(req, res) {
  const { group: userId, method, job } = req.body
  if (!userId || !job?.uri) {
    return res.sendStatus(400)
  }
  // one queued poll is enough: it reads every change since the cursor
  const isPoll = new URL(job.uri).pathname === '/user/poll'
  if (!isPoll || (await QueueManager.markPollPending(userId))) {
    await QueueManager.push(userId, { method, job })
  }
  res.sendStatus(204)
}

// TpdsQueueManager.getQueues, for the sync status in the editor
async function getQueues(req, res) {
  res.json(await QueueManager.getQueues(req.params.userId))
}

export default {
  enqueue: expressify(enqueue),
  getQueues: expressify(getQueues),
}
