/**
 * Registers browser-side AI tools and renders server-side tool results.
 * Includes document inspection, project actions, and edit proposals that
 * require user approval before being applied.
 */
import type { ReactNode } from 'react'
import type { ChatAddToolOutputFunction, UIMessage } from 'ai'
import type { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { EditorView as CMEditorView } from '@codemirror/view'
import { forEachDiagnostic } from '@codemirror/lint'
import { sendMB } from '@/infrastructure/event-tracking'
import { ToolRejectionError } from '../errors'
import { highlightFixEffect } from '../codemirror/highlight-fix'
import {
  aggregateDiff,
  SuggestionApproval,
  SuggestionUndo,
} from '../components/code-diff'
import { CollapsibleSources, SourceLink } from '../components/sources'
import type { WorkbenchFileActions } from '../hooks/use-file-actions'

export type ToolRenderHelpers = {
  addToolOutput: ChatAddToolOutputFunction<UIMessage>
}

export type ClientTool = {
  title?: (part: any) => ReactNode
  execute?: (
    input: any,
    view: EditorView,
    fileActions: WorkbenchFileActions,
    signal: AbortSignal
  ) => Promise<unknown> | unknown
  renderInput?: (part: any, helpers: ToolRenderHelpers, view: EditorView) => ReactNode
  renderOutput?: (part: any, helpers: ToolRenderHelpers, view: EditorView) => ReactNode
}

type LineChange = {
  fromLine: number
  existingContent: string
  newContent: string
}

/**
 * Apply a minimal diff after matching the existing content. Search nearby
 * lines when edits have shifted the expected location, preserving cursor
 * position and undo history. Highlight the result for two seconds.
 */
export function applyLineChange(
  view: EditorView,
  change: LineChange,
  isUndo = false
) {
  const { fromLine, existingContent, newContent } = change
  const { doc } = view.state

  const locate = (() => {
    function tryLine(lineNumber: number) {
      if (lineNumber < 1 || lineNumber > doc.lines) {
        return null
      }
      const from = doc.line(lineNumber).from
      const to = Math.min(doc.length, from + existingContent.length)
      const documentSource = doc.sliceString(from, to)
      if (documentSource === existingContent) {
        return { from, documentSource }
      }
      return undefined
    }
    const exact = tryLine(fromLine)
    if (exact) {
      return exact
    }
    for (let offset = 1; offset < 10; offset++) {
      for (const lineNumber of [fromLine - offset, fromLine + offset]) {
        const found = tryLine(lineNumber)
        if (found) {
          return found
        }
      }
    }
    throw new Error(
      'The current text no longer matches this suggestion. Review the document and make the change manually.'
    )
  })()

  const { from, documentSource } = locate
  const changes = []
  const parts = aggregateDiff(documentSource, newContent)
  let pos = from
  for (const part of parts) {
    if (part.added) {
      changes.push({ from: pos, insert: part.value })
    } else if (part.removed) {
      changes.push({ from: pos, to: pos + part.value.length })
      pos += part.value.length
    } else {
      pos += part.value.length
    }
  }
  view.dispatch({
    changes,
    userEvent: isUndo ? 'undo' : undefined,
  })
  highlightChange(view, from, from + newContent.length)
}

/** Scroll the change into view and flash the highlight. */
export function highlightChange(view: EditorView, from: number, to: number) {
  view.dispatch({
    effects: [
      CMEditorView.scrollIntoView(EditorSelection.range(from, to), {
        y: 'center',
      }),
      highlightFixEffect.of(EditorSelection.single(from, to)),
    ],
  })
  window.setTimeout(() => {
    view.dispatch({ effects: highlightFixEffect.of(null) })
  }, 2000)
}

/** Browser-executed tools. */
export const clientTools: Record<string, ClientTool> = {
  read_lines: {
    title(part) {
      const { fromLine, toLine } = part.input
      return fromLine === toLine
        ? `Read line ${fromLine}`
        : `Read lines ${fromLine}-${toLine}`
    },
    execute(input, view) {
      const { doc } = view.state
      const fromLine = Math.max(1, Math.min(input.fromLine, doc.lines))
      const toLine = Math.max(fromLine, Math.min(input.toLine, doc.lines))
      const lines = []
      let lineNumber = fromLine
      for (const content of doc.iterLines(fromLine, toLine + 1)) {
        lines.push({ line: lineNumber, content })
        lineNumber++
      }
      return lines
    },
  },
  get_diagnostics: {
    title: () => 'Read compilation and editor diagnostics',
    execute(input, view, { getCompileDiagnostics }) {
      const diagnostics: {
        fromLine: number
        toLine: number
        severity: string
        message: string
      }[] = []
      forEachDiagnostic(view.state, (d, from, to) => {
        // Compile annotations use a display fallback when the log has no line number.
        if (d.source === 'compile') return
        diagnostics.push({
          fromLine: view.state.doc.lineAt(from).number,
          toLine: view.state.doc.lineAt(to).number,
          severity: d.severity,
          message: d.message,
        })
      })
      return { ...getCompileDiagnostics(), editorDiagnostics: diagnostics }
    },
  },
  read_current_file: {
    title: () => 'Read the current file',
    execute(input, view) {
      const lines = []
      let lineNumber = 1
      for (const content of view.state.doc.iterLines()) {
        lines.push({ line: lineNumber, content })
        lineNumber++
      }
      return lines
    },
  },
  search_file: {
    title: part => `Search for "${part.input.query ?? ''}"`,
    execute(input, view) {
      const { query } = input
      const matches = []
      let lineNumber = 1
      for (const content of view.state.doc.iterLines()) {
        if (content.includes(query)) {
          matches.push({ line: lineNumber, content })
        }
        lineNumber++
      }
      return matches.slice(0, 10)
    },
  },
  list_files: {
    title: () => 'List files',
    execute(input, view, { listFiles }) {
      return listFiles()
    },
  },
  create_file: {
    title: part => `Create file ${part.input.path}`,
    async execute(input, view, { createFile }) {
      return await createFile(input.path)
    },
  },
  open_file: {
    title: part => `Read file ${part.input.path}`,
    async execute(input, view, { openFile }, signal) {
      const content = await openFile(input.path, signal)
      return content.split('\n').map((content, index) => ({
        line: index + 1,
        content,
      }))
    },
  },
  replace_lines: {
    title(part) {
      const { fromLine, toLine } = part.input
      return fromLine === toLine
        ? `Replace line ${fromLine}`
        : `Replace lines ${fromLine}-${toLine}`
    },
    renderInput(part, { addToolOutput }) {
      return (
        <SuggestionApproval
          part={part}
          handleApproval={view => {
            if (view) {
              try {
                applyLineChange(view, part.input)
                addToolOutput({
                  tool: 'replace_lines',
                  toolCallId: part.toolCallId,
                  output: 'Change applied',
                })
                sendMB('ai-chat-response', { button: 'apply' })
              } catch (error: any) {
                addToolOutput({
                  state: 'output-error',
                  tool: 'replace_lines',
                  toolCallId: part.toolCallId,
                  errorText: error.message,
                })
              }
            } else {
              addToolOutput({
                state: 'output-error',
                tool: 'replace_lines',
                toolCallId: part.toolCallId,
                errorText: 'The user chose not to accept this edit.',
              })
              sendMB('ai-chat-response', { button: 'reject' })
            }
          }}
        />
      )
    },
    renderOutput: part => (
      <SuggestionUndo
        part={part}
        handleUndo={view => {
          applyLineChange(
            view,
            {
              ...part.input,
              existingContent: part.input.newContent,
              newContent: part.input.existingContent,
            },
            true
          )
          sendMB('ai-chat-response', { button: 'undo' })
        }}
        handleApply={view => {
          applyLineChange(view, part.input)
          sendMB('ai-chat-response', { button: 'apply' })
        }}
      />
    ),
  },
  image_generation: {
    title: () => 'Generate image',
    renderOutput(part) {
      const src = 'data:image/png;base64,' + part.output.result
      return (
        <div style={{ width: '100%' }}>
          <img src={src} alt="Generated" style={{ maxWidth: '100%', overflow: 'hidden' }} />
        </div>
      )
    },
  },
  code_interpreter: {
    title: () => 'Run code',
    renderOutput: part => (
      <div>
        {part.output.outputs?.map((output: any, index: number) => {
          switch (output.type) {
            case 'logs':
              return (
                <pre className="p-2" key={index}>
                  {output.logs}
                </pre>
              )
            case 'image':
              return (
                <img
                  src={output.url}
                  alt="Generated"
                  style={{ maxWidth: '100%', overflow: 'hidden' }}
                  key={index}
                />
              )
            default:
              return null
          }
        })}
      </div>
    ),
  },
  web_search: {
    title: () => 'Web search',
    renderOutput(part) {
      if (!part.output) {
        return null
      }
      const { action, sources } = part.output
      if (action && sources) {
        return (
          <div className="workbench-web-search-output">
            {action.type === 'search' && <div>Searched for "{action.query}"</div>}
            {action.type === 'openPage' && <div>Opened {action.url}</div>}
            {action.type === 'findInPage' && (
              <div>
                Looked for "{action.pattern}" in {action.url}
              </div>
            )}
            {sources.length > 0 && (
              <CollapsibleSources count={sources.length}>
                {sources
                  .filter((source: any) => source.type === 'url')
                  .map((source: any) => (
                    <SourceLink href={source.url} title={source.url} key={source.url} />
                  ))}
              </CollapsibleSources>
            )}
          </div>
        )
      }
      return null
    },
  },
  compile: {
    title: () => 'Compile',
    async execute(input, view, { compile }, signal) {
      return await compile(signal)
    },
  },
  set_compiler: {
    title: part =>
      part?.input ? `Set ${part.input.compiler} as compiler` : 'Set compiler',
    execute(input, view, { setCompiler }) {
      return setCompiler(input.compiler)
    },
  },
  view_page: {
    title: part =>
      part.input?.page ? `View PDF page ${part.input.page}` : 'View PDF page',
    renderOutput: part =>
      part.state === 'output-available' ? (
        <div className="d-flex flex-column align-items-center">
          <div className="my-2 shadow-sm">
            <img
              alt="output"
              src={`data:image/png;base64,${part.output}`}
              style={{ maxHeight: 400, maxWidth: 400 }}
            />
          </div>
        </div>
      ) : null,
    async execute(input, view, { viewPdfPage }, signal) {
      const dataUrl = await viewPdfPage(input.page, signal)
      if (!dataUrl) {
        throw new ToolRejectionError(`Unable to view PDF page ${input.page}`)
      }
      const [, base64] = dataUrl.split(',', 2)
      return base64
    },
  },
  view_struct_tree: {
    title: () => 'View PDF structure tree',
    async execute(input, view, { viewPdfStructureTree }, signal) {
      return await viewPdfStructureTree(signal)
    },
  },
}

/** Server-executed tools with custom output rendering. */
export const serverTools: Record<string, ClientTool> = {
  search_documentation: {
    title: () => 'Search Overleaf documentation',
    renderOutput(part) {
      const content = part.output?.content?.slice(0, 3)
      if (!content || content.length === 0) {
        return null
      }
      const entries: { Title?: string; Link?: string }[] = []
      for (const item of content) {
        const entry: { Title?: string; Link?: string } = {}
        const lines = item.text.split('\n')
        for (const line of lines) {
          const [key, value] = line.split(': ', 2)
          if (key === 'Title' || key === 'Link') {
            entry[key as 'Title' | 'Link'] = value
          }
        }
        entries.push(entry)
      }
      return (
        <CollapsibleSources count={entries.length}>
          {entries.map(entry => (
            <SourceLink href={entry.Link} title={entry.Title} key={entry.Link} />
          ))}
        </CollapsibleSources>
      )
    },
  },
  search_publications_dimensions: {
    title: () => 'Search publications',
    renderOutput: part => <div className="my-2">Searched for "{part.input.q}"</div>,
  },
}

/** Resolve a tool definition by name across both registries. */
export function getToolDefinition(name: string): ClientTool | undefined {
  if (name in clientTools) {
    return clientTools[name]
  }
  if (name in serverTools) {
    return serverTools[name]
  }
  return undefined
}
