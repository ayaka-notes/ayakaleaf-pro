/**
 * Coordinates PDF.js document destroys across GraphicsWidget instances.
 *
 * PDF.js uses a single shared worker (GlobalWorkerOptions.workerPort) and
 * rejects getDocument while any previous PDFDocumentLoadingTask.destroy()
 * are in flight.
 */
export class PdfDestroyLock {
  private readonly pendingDestroys = new Set<Promise<unknown>>()

  /** Resolves once no pdf.destroy() is in flight. */
  async waitForPending(): Promise<void> {
    // Loop in case a new destroy is scheduled while we await existing ones.
    while (this.pendingDestroys.size > 0) {
      await Promise.all(this.pendingDestroys)
    }
  }

  /** Registers an in-flight destroy so waitForPending() will wait for it. */
  schedule<T>(destroyFn: () => Promise<T>): Promise<T> {
    const task = destroyFn()
    this.pendingDestroys.add(task)
    task.finally(() => this.pendingDestroys.delete(task))
    return task
  }
}
