export default class RecognitionClient {
  constructor(worker) {
    this.worker = worker
    this.pending = new Map()
    this.nextId = 0
    this.destroyed = false
    this.receive = event => {
      const message = event.data
      const request = this.pending.get(message.id)
      this.pending.delete(message.id)
      clearTimeout(request.timeout)
      if (message.type === 'ready') request.resolve()
      else if (message.type === 'result') request.resolve(message.candidates)
      else
        request.reject(
          new Error(message.message || 'Unexpected recognition response')
        )
    }
    this.fail = () =>
      this.destroy(new Error('Symbol recognition worker failed'))
    worker.addEventListener('message', this.receive)
    worker.addEventListener('error', this.fail)
  }

  request(message) {
    if (this.destroyed)
      return Promise.reject(new Error('Recognizer was closed'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => this.destroy(new Error('Symbol recognition timed out')),
        message.type === 'init' ? 60000 : 30000
      )
      this.pending.set(id, { resolve, reject, timeout })
      this.worker.postMessage({ ...message, id })
    })
  }

  destroy(error = new Error('Recognizer was closed')) {
    if (this.destroyed) return
    this.destroyed = true
    this.worker.removeEventListener('message', this.receive)
    this.worker.removeEventListener('error', this.fail)
    this.worker.terminate()
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout)
      request.reject(error)
    }
    this.pending.clear()
  }
}
