/**
 * Provides project actions for browser-side AI tools: file navigation and
 * creation, compilation, compiler selection, and PDF inspection.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useProjectContext } from '@/shared/context/project-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useDetachCompileContext } from '@/shared/context/detach-compile-context'
import { useProjectSettingsContext } from '@/features/ide-settings/context/project-settings-context'
import { syncCreateEntity } from '@/features/file-tree/util/sync-mutation'
import { getJSON } from '@/infrastructure/fetch-json'
import { signalWithTimeout } from '@/utils/abort-signal'
import { ToolRejectionError } from '../errors'

const MAX_PDF_PAGE_PIXELS = 1048576 // downscale rendered pages to ~1MP

type CompileState = ReturnType<typeof useDetachCompileContext>

function getCompileDiagnostics(state: CompileState) {
  return {
    compiling: state.compiling,
    hasUncompiledChanges: state.uncompiled || state.editedSinceCompileStarted,
    logsReady: Boolean(state.logEntries),
    error: state.error ?? null,
    diagnostics: state.logEntries?.all.map(entry => ({
      file: entry.file ?? null,
      line: entry.line ?? null,
      severity: entry.level,
      message: entry.message,
      raw: entry.raw,
    })) ?? [],
  }
}

export type WorkbenchFileActions = {
  createFile: (path: string) => Promise<void>
  listFiles: () => Promise<string[]>
  openFile: (path: string, signal: AbortSignal) => Promise<string>
  getCompileDiagnostics: () => ReturnType<typeof getCompileDiagnostics>
  compile: (signal: AbortSignal) => Promise<ReturnType<typeof getCompileDiagnostics>>
  setCompiler: ReturnType<typeof useProjectSettingsContext>['setCompiler']
  viewPdfPage: (page: number, signal: AbortSignal) => Promise<string | undefined>
  viewPdfStructureTree: (signal: AbortSignal) => Promise<unknown>
}

export function useWorkbenchFileActions(): WorkbenchFileActions {
  const { projectId } = useProjectContext()
  const { findEntityByPath } = useFileTreePathContext()
  const { fileTreeData } = useFileTreeData()
  const { openDoc, openDocs } = useEditorManagerContext()
  const compileState = useDetachCompileContext()
  const { startCompile, pdfUrl } = compileState
  const compileStateRef = useRef(compileState)
  useEffect(() => {
    compileStateRef.current = compileState
  }, [compileState])
  const { setCompiler } = useProjectSettingsContext()

  const readCompileDiagnostics = useCallback(
    () => getCompileDiagnostics(compileStateRef.current),
    []
  )

  const compile = useCallback(async (signal: AbortSignal) => {
    signal.throwIfAborted()
    const previous = compileStateRef.current
    if (previous.compiling) {
      throw new ToolRejectionError('A compilation is already running. Wait for it to finish before reading diagnostics.')
    }
    await startCompile()

    // Log files are loaded after the compile request resolves; never return the previous result.
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      await new Promise(resolve => window.setTimeout(resolve, 50))
      signal.throwIfAborted()
      const current = compileStateRef.current
      if (!current.compiling && current.logEntries && current.logEntries !== previous.logEntries) {
        return getCompileDiagnostics(current)
      }
    }
    throw new ToolRejectionError('The new compilation logs are not available yet. Check the compilation panel before retrying.')
  }, [startCompile])

  const createFile = useCallback(
    async (path: string) => {
      const cleanPath = path.replace(/\/$/, '')
      if (findEntityByPath(cleanPath)) {
        throw new ToolRejectionError('File already exists')
      }
      const segments = cleanPath.split('/')
      const name = segments.pop()
      if (!name) {
        throw new ToolRejectionError('File name required')
      }
      const parentPath = segments.join('/')
      const parent = findEntityByPath(parentPath)
      if (!parent) {
        throw new ToolRejectionError('Parent folder not found')
      }
      if (parent.type !== 'folder') {
        throw new ToolRejectionError('Invalid path')
      }
      const folder = parent.entity
      const doc = await syncCreateEntity(projectId, folder._id, {
        endpoint: 'doc',
        name,
      })
      await new Promise(resolve => {
        window.setTimeout(async () => {
          await openDoc(doc as any)
          resolve(doc)
        }, 1000)
      })
    },
    [findEntityByPath, openDoc, projectId]
  )

  const openFile = useCallback(
    async (path: string, signal: AbortSignal) => {
      const cleanPath = path.replace(/\/$/, '')
      const found = findEntityByPath(cleanPath)
      if (!found) {
        throw new Error('File not found')
      }
      if (found.type !== 'doc') {
        throw new Error('Invalid entity type')
      }
      const readSignal = signalWithTimeout(signal, 5000)
      if (readSignal.aborted) {
        throw new Error('File read cancelled')
      }
      // Include pending edits before reading the live document without switching the editor.
      await openDocs.awaitBufferedOps(readSignal)
      const { message } = await getJSON<{ message: string }>(
        `/project/${projectId}/doc/${found.entity._id}/download`,
        { signal: readSignal, cache: 'no-store', swallowAbortError: false }
      )
      return message
    },
    [findEntityByPath, openDocs, projectId]
  )

  const listFiles = useCallback(
    async () => Array.from(iterateFileTree(fileTreeData)),
    [fileTreeData]
  )

  const viewPdfPage = useCallback(
    async (page: number, signal: AbortSignal) => {
      if (page < 1) {
        throw new Error('Invalid page number')
      }
      if (!pdfUrl) {
        throw new Error('No PDF URL available')
      }
      const { loadPdfDocumentFromUrl } = await import(
        '@/features/pdf-preview/util/pdf-js'
      )
      const pdf = await loadPdfDocumentFromUrl(pdfUrl).promise
      const pdfPage = await pdf.getPage(page)
      if (signal.aborted) {
        return
      }
      const viewport = pdfPage.getViewport({ scale: 1 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      await pdfPage.render({
        canvasContext: canvas.getContext('2d') as any,
        viewport,
      }).promise
      return downscaleCanvas(canvas, MAX_PDF_PAGE_PIXELS).toDataURL('image/png')
    },
    [pdfUrl]
  )

  const viewPdfStructureTree = useCallback(
    async (signal: AbortSignal) => {
      if (!pdfUrl) {
        throw new Error('No PDF URL available')
      }
      const { loadPdfDocumentFromUrl } = await import(
        '@/features/pdf-preview/util/pdf-js'
      )
      const pdf = await loadPdfDocumentFromUrl(pdfUrl).promise
      if (signal.aborted) {
        return
      }
      const pages = []
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n)
        const structTree = await page.getStructTree()
        pages.push({ page: n, structTree })
      }
      return pages
    },
    [pdfUrl]
  )

  return useMemo(
    () => ({
      createFile,
      listFiles,
      openFile,
      getCompileDiagnostics: readCompileDiagnostics,
      compile,
      setCompiler,
      viewPdfPage,
      viewPdfStructureTree,
    }),
    [createFile, listFiles, openFile, readCompileDiagnostics, compile, setCompiler, viewPdfPage, viewPdfStructureTree]
  )
}

function* iterateFileTree(folder: any): Generator<string> {
  for (const doc of folder.docs) {
    yield doc.name
  }
  for (const fileRef of folder.fileRefs) {
    yield fileRef.name
  }
  for (const subFolder of folder.folders) {
    for (const name of iterateFileTree(subFolder)) {
      yield `${subFolder.name}/${name}`
    }
  }
}

function downscaleCanvas(canvas: HTMLCanvasElement, maxPixels: number) {
  const { width, height } = canvas
  if (width <= 0 || height <= 0) {
    return canvas
  }
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)))
  const scaled = document.createElement('canvas')
  scaled.width = Math.max(1, Math.round(width * scale))
  scaled.height = Math.max(1, Math.round(height * scale))
  const ctx = scaled.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to create canvas context')
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height)
  return scaled
}
