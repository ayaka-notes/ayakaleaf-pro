// Positions use a zero-based page index and PDF coordinates, independent of zoom.
export type PdfNavigationPosition = {
  page: number
  offset: { left: number; top: number }
}

const MAX_HISTORY_LENGTH = 100

/**
 * In-memory history used by PdfNavigationLinkService. Capture before scrolling
 * and commit after PDFViewer has applied the destination. PDF.js's own hooks run
 * too early to distinguish a rejected destination or an unchanged viewport.
 * Ordinary scrolling and SyncTeX bypass these hooks.
 * Unlike PDFHistory, this class never reads or modifies window.history.
 */
export class PdfNavigationHistory {
  private previous: PdfNavigationPosition[] = []
  private next: PdfNavigationPosition[] = []
  private pending?: PdfNavigationPosition

  constructor(
    private readonly getPosition: () => PdfNavigationPosition | undefined,
    private readonly restorePosition: (position: PdfNavigationPosition) => void,
    private readonly onChange: () => void
  ) {}

  get canGoBack() {
    return this.previous.length > 0
  }

  get canGoForward() {
    return this.next.length > 0
  }

  // Snapshot synchronously; the persisted, debounced position may be out of date.
  pushCurrentPosition() {
    this.pending = this.snapshot()
  }

  // Only an actual change of PDF coordinates creates a departure. In particular,
  // rejected destination types and repeated links must preserve the forward stack.
  push() {
    const departure = this.pending
    this.pending = undefined
    const arrival = this.snapshot()
    if (!departure || !arrival) return
    // Ignore sub-point differences caused by rounding viewport scroll offsets.
    if (
      departure.page === arrival.page &&
      Math.abs(departure.offset.left - arrival.offset.left) < 0.5 &&
      Math.abs(departure.offset.top - arrival.offset.top) < 0.5
    ) {
      return
    }
    this.previous.push(departure)
    this.previous = this.previous.slice(-MAX_HISTORY_LENGTH)
    this.next = []
    this.onChange()
  }

  // Keep the page-destination hook available to callers using the history API.
  pushPage() {
    this.push()
  }

  back() {
    this.navigate(this.previous, this.next)
  }

  forward() {
    this.navigate(this.next, this.previous)
  }

  // PDF coordinates from an earlier compilation cannot be safely reused.
  reset() {
    this.previous = []
    this.next = []
    this.pending = undefined
    this.onChange()
  }

  private snapshot() {
    const position = this.getPosition()
    if (!position) return
    return { page: position.page, offset: { ...position.offset } }
  }

  private navigate(from: PdfNavigationPosition[], to: PdfNavigationPosition[]) {
    const destination = from.at(-1)
    const current = this.snapshot()
    if (!destination || !current) return

    // Restore before changing the stacks so a failed restore leaves them intact.
    // The callback uses scrollPageIntoView directly, never the link-service hooks.
    this.restorePosition(destination)
    from.pop()
    to.push(current)
    this.pending = undefined
    this.onChange()
  }
}
