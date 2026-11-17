import { PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { PdfNavigationHistory } from './pdf-navigation-history'

/**
 * Keep PDF.js's destination resolution, but bind each operation to its original
 * document. A late response must never resolve page references against a newer
 * PDF or move that PDF's viewport. No PDF.js implementation is copied here.
 */
export class PdfNavigationLinkService extends PDFLinkService {
  private generation = 0

  // Called as soon as a replacement starts, before its document is available.
  invalidatePendingNavigation() {
    this.generation++
  }

  setDocument(...args: Parameters<PDFLinkService['setDocument']>) {
    this.invalidatePendingNavigation()
    super.setDocument(...args)
  }

  async goToDestination(
    dest: Parameters<PDFLinkService['goToDestination']>[0]
  ) {
    const generation = this.generation
    try {
      await this.createNavigationService(generation).goToDestination(dest)
    } catch (error) {
      // Destroying a replaced document may reject its outstanding PDF.js request.
      // Preserve errors for the active document, while ignoring obsolete work.
      if (generation === this.generation) throw error
    }
  }

  goToPage(value: Parameters<PDFLinkService['goToPage']>[0]) {
    this.createNavigationService(this.generation).goToPage(value)
  }

  private createNavigationService(generation: number) {
    const viewer: PDFViewer = this.pdfViewer
    const service = new PDFLinkService({
      eventBus: this.eventBus,
      ignoreDestinationZoom: this._ignoreDestinationZoom,
    })
    // This lightweight service holds the original document across every await in
    // PDF.js. Its viewer facade only permits scrolling in the same generation.
    service.setDocument(this.pdfDocument)
    service.setViewer({
      pageLabelToPageNumber: (label: string) =>
        viewer.pageLabelToPageNumber(label),
      scrollPageIntoView: (
        options: Parameters<PDFViewer['scrollPageIntoView']>[0]
      ) => {
        if (generation !== this.generation) return
        const history = this.pdfHistory as PdfNavigationHistory | null
        history?.pushCurrentPosition()
        viewer.scrollPageIntoView(options)
        // PDF.js checks the destination type inside scrollPageIntoView, after
        // its normal history hooks. Commit only if the real viewport has moved.
        history?.push()
      },
    })
    return service
  }
}
