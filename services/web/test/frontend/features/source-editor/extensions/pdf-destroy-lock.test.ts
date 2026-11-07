import { PdfDestroyLock } from '@/features/source-editor/extensions/visual/utils/pdf-destroy-lock'
import { expect } from 'chai'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
}

function defer<T>(): Deferred<T> {
  let resolveRet!: (value: T) => void
  let rejectRet!: (err: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolveRet = resolve
    rejectRet = reject
  })
  return { promise, resolve: resolveRet, reject: rejectRet }
}

// Flush microtasks so that .finally() handlers attached inside schedule()
// run before we make assertions.
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('PdfDestroyLock', function () {
  describe('waitForPending', function () {
    it('resolves immediately when no destroys are in flight', async function () {
      const lock = new PdfDestroyLock()
      let resolved = false
      await lock.waitForPending().then(() => {
        resolved = true
      })
      expect(resolved).to.be.true
    })

    it('waits for a pending destroy to settle', async function () {
      const lock = new PdfDestroyLock()
      const deferred = defer<void>()
      lock.schedule(() => deferred.promise)

      let waited = false
      const wait = lock.waitForPending().then(() => {
        waited = true
      })

      await flush()
      expect(waited).to.be.false

      deferred.resolve()
      await wait
      expect(waited).to.be.true
    })

    it('waits for a destroy that rejects', async function () {
      const lock = new PdfDestroyLock()
      const deferred = defer<void>()
      // Swallow the rejection at the schedule() call site to mirror real usage,
      // where callers catch errors from destroy().
      lock.schedule(() => deferred.promise.catch(() => {}))

      let waited = false
      const wait = lock.waitForPending().then(() => {
        waited = true
      })

      await flush()
      expect(waited).to.be.false

      deferred.reject(new Error('boom'))
      await wait
      expect(waited).to.be.true
    })

    it('waits for destroys scheduled while waiting', async function () {
      const lock = new PdfDestroyLock()
      const first = defer<void>()
      const second = defer<void>()

      lock.schedule(() => first.promise)

      let waited = false
      const wait = lock.waitForPending().then(() => {
        waited = true
      })

      // Schedule a second destroy before the first completes - waitForPending
      // must loop and wait for this one too.
      lock.schedule(() => second.promise)

      first.resolve()
      await flush()
      expect(waited).to.be.false

      second.resolve()
      await wait
      expect(waited).to.be.true
    })

    it('waits for multiple concurrent destroys', async function () {
      const lock = new PdfDestroyLock()
      const first = defer<void>()
      const second = defer<void>()

      lock.schedule(() => first.promise)
      lock.schedule(() => second.promise)

      let waited = false
      const wait = lock.waitForPending().then(() => {
        waited = true
      })

      first.resolve()
      await flush()
      expect(waited).to.be.false

      second.resolve()
      await wait
      expect(waited).to.be.true
    })
  })

  describe('schedule', function () {
    it('invokes the destroy function immediately', function () {
      const lock = new PdfDestroyLock()
      let called = false
      lock.schedule(async () => {
        called = true
      })
      expect(called).to.be.true
    })

    it('returns the promise from the destroy function', async function () {
      const lock = new PdfDestroyLock()
      const result = await lock.schedule(async () => 'done')
      expect(result).to.equal('done')
    })

    it('releases the lock after a successful destroy', async function () {
      const lock = new PdfDestroyLock()
      await lock.schedule(async () => {})
      await flush()

      // waitForPending should now resolve synchronously - if the task was not
      // removed from the set, this would hang.
      let resolved = false
      await lock.waitForPending().then(() => {
        resolved = true
      })
      expect(resolved).to.be.true
    })

    it('releases the lock after a destroy that rejects', async function () {
      const lock = new PdfDestroyLock()
      // Mirror real usage: destroyFn swallows its own errors so the internal
      // .finally() chain in schedule() doesn't leak an unhandled rejection.
      await lock.schedule(() =>
        Promise.reject(new Error('boom')).catch(() => {})
      )
      await flush()

      let resolved = false
      await lock.waitForPending().then(() => {
        resolved = true
      })
      expect(resolved).to.be.true
    })
  })
})
