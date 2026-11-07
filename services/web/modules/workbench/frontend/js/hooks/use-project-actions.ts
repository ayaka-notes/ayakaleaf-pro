/**
 * What the browser-side tools can do with the project: list, read and create
 * documents, compile and read the log, switch the engine, and look at the PDF.
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
import { ToolRefusal } from '../errors'

// Rendered pages are scaled down to about one megapixel before upload
const PAGE_PIXEL_BUDGET = 1024 * 1024
const COMPILE_LOG_WAIT_MS = 15_000
// The outline stops at the page that takes it past this length
const OUTLINE_CHARS = 40_000
const READ_TIMEOUT_MS = 5000

type CompileContext = ReturnType<typeof useDetachCompileContext>

function compileReport(compile: CompileContext) {
  return {
    compiling: compile.compiling,
    hasUncompiledChanges: compile.uncompiled || compile.editedSinceCompileStarted,
    logsReady: Boolean(compile.logEntries),
    error: compile.error ?? null,
    diagnostics: (compile.logEntries?.all ?? []).map(entry => ({
      file: entry.file ?? null,
      line: entry.line ?? null,
      severity: entry.level,
      message: entry.message,
      raw: entry.raw,
    })),
  }
}

export type CompileReport = ReturnType<typeof compileReport>

export type ProjectActions = {
  listFiles: () => string[]
  readFile: (path: string, signal: AbortSignal) => Promise<string>
  newFile: (path: string) => Promise<void>
  lastCompile: () => CompileReport
  compile: (signal: AbortSignal) => Promise<CompileReport>
  setCompiler: ReturnType<typeof useProjectSettingsContext>['setCompiler']
  renderPage: (page: number, signal: AbortSignal) => Promise<string>
  pdfOutline: (signal: AbortSignal) => Promise<unknown>
}

function filePaths(folder: any, prefix = ''): string[] {
  return [
    ...folder.docs.map((doc: any) => prefix + doc.name),
    ...folder.fileRefs.map((file: any) => prefix + file.name),
    ...folder.folders.flatMap((sub: any) => filePaths(sub, `${prefix}${sub.name}/`)),
  ]
}

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

function shrink(source: HTMLCanvasElement) {
  const factor = Math.sqrt(PAGE_PIXEL_BUDGET / (source.width * source.height))
  if (!(factor < 1)) return source
  const target = document.createElement('canvas')
  target.width = Math.max(1, Math.round(source.width * factor))
  target.height = Math.max(1, Math.round(source.height * factor))
  const context = target.getContext('2d')!
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, target.width, target.height)
  return target
}

export function useProjectActions(): ProjectActions {
  const { projectId } = useProjectContext()
  const { findEntityByPath } = useFileTreePathContext()
  const { fileTreeData } = useFileTreeData()
  const { openDoc, openDocs } = useEditorManagerContext()
  const { setCompiler } = useProjectSettingsContext()
  const compileContext = useDetachCompileContext()
  // Tools run in async callbacks and must see the state as it is now
  const compileRef = useRef(compileContext)
  useEffect(() => {
    compileRef.current = compileContext
  }, [compileContext])

  const listFiles = useCallback(() => filePaths(fileTreeData), [fileTreeData])

  const findDoc = useCallback(
    (path: string) => {
      const found = findEntityByPath(path.replace(/\/$/, ''))
      if (!found || found.type !== 'doc') {
        throw new ToolRefusal(`There is no document at ${path}.`)
      }
      return found.entity
    },
    [findEntityByPath]
  )

  const readFile = useCallback(
    async (path: string, signal: AbortSignal) => {
      const doc = findDoc(path)
      const timed = signalWithTimeout(signal, READ_TIMEOUT_MS)
      // Unsent edits of open documents go out first, so the read is current
      await openDocs.awaitBufferedOps(timed)
      const { message } = await getJSON<{ message: string }>(
        `/project/${projectId}/doc/${doc._id}/download`,
        { signal: timed, cache: 'no-store', swallowAbortError: false }
      )
      return message
    },
    [findDoc, openDocs, projectId]
  )

  const newFile = useCallback(
    async (path: string) => {
      const parts = path.replace(/\/$/, '').split('/')
      const name = parts.pop()
      if (!name) throw new ToolRefusal('The path needs a file name.')
      if (findEntityByPath(path)) {
        throw new ToolRefusal(`${path} exists already.`)
      }
      const parent = findEntityByPath(parts.join('/'))
      if (parent?.type !== 'folder') {
        throw new ToolRefusal(`There is no folder ${parts.join('/') || '/'}.`)
      }
      const doc = await syncCreateEntity(projectId, parent.entity._id, {
        endpoint: 'doc',
        name,
      })
      // The file tree learns about the new doc over the socket first
      await sleep(1000)
      await openDoc(doc as any)
    },
    [findEntityByPath, openDoc, projectId]
  )

  const lastCompile = useCallback(() => compileReport(compileRef.current), [])

  const compile = useCallback(
    async (signal: AbortSignal) => {
      const before = compileRef.current
      if (before.compiling) {
        throw new ToolRefusal('A compile is running already; ask for the problems once it is done.')
      }
      await compileRef.current.startCompile()
      // The log arrives after the compile request returns
      const giveUp = Date.now() + COMPILE_LOG_WAIT_MS
      while (Date.now() < giveUp) {
        await sleep(100)
        signal.throwIfAborted()
        const now = compileRef.current
        if (!now.compiling && now.logEntries && now.logEntries !== before.logEntries) {
          return compileReport(now)
        }
      }
      throw new ToolRefusal('The compile log did not arrive in time; try get_problems a little later.')
    },
    []
  )

  const loadPdf = useCallback(async () => {
    const url = compileRef.current.pdfUrl
    if (!url) throw new ToolRefusal('There is no compiled PDF yet.')
    const { loadPdfDocumentFromUrl } = await import('@/features/pdf-preview/util/pdf-js')
    return await loadPdfDocumentFromUrl(url).promise
  }, [])

  const renderPage = useCallback(
    async (page: number, signal: AbortSignal) => {
      const pdf = await loadPdf()
      if (page > pdf.numPages) {
        throw new ToolRefusal(`The PDF has ${pdf.numPages} pages.`)
      }
      const pdfPage = await pdf.getPage(page)
      signal.throwIfAborted()
      const viewport = pdfPage.getViewport({ scale: 1 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      await pdfPage.render({ canvasContext: canvas.getContext('2d') as any, viewport }).promise
      return shrink(canvas).toDataURL('image/png').split(',')[1]
    },
    [loadPdf]
  )

  const pdfOutline = useCallback(
    async (signal: AbortSignal) => {
      const pdf = await loadPdf()
      const pages = []
      let length = 0
      for (let page = 1; page <= pdf.numPages && length < OUTLINE_CHARS; page++) {
        signal.throwIfAborted()
        const entry = { page, structure: await (await pdf.getPage(page)).getStructTree() }
        length += JSON.stringify(entry).length
        pages.push(entry)
      }
      return { pageCount: pdf.numPages, pages }
    },
    [loadPdf]
  )

  return useMemo(
    () => ({
      listFiles,
      readFile,
      newFile,
      lastCompile,
      compile,
      setCompiler,
      renderPage,
      pdfOutline,
    }),
    [listFiles, readFile, newFile, lastCompile, compile, setCompiler, renderPage, pdfOutline]
  )
}
