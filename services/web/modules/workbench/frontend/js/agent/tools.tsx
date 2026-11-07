/**
 * The tools of the chat agent as the browser sees them: a label for the
 * card, how to run the ones the browser runs, and what to show in the card.
 * Names and inputs match CLIENT_TOOLS in app/src/WorkbenchTools.mjs.
 */
import type { ReactNode } from 'react'
import type { EditorView } from '@codemirror/view'
import { forEachDiagnostic } from '@codemirror/lint'
import type { ProjectActions } from '../hooks/use-project-actions'
import EditProposal, { type EditPart } from '../chat/edit-proposal'
import type { Link } from '../chat/source-links'
import { boxed } from '../chat/themed'

export type ToolOutput =
  | { tool: string; toolCallId: string; output: unknown }
  | { tool: string; toolCallId: string; state: 'output-error'; errorText: string }

export type Respond = (output: ToolOutput) => void

export type ToolRun = {
  view: EditorView
  // Project path of the document the view shows
  openPath: string
  actions: ProjectActions
  signal: AbortSignal
}

export type ToolSpec = {
  label: (input: any) => string
  run?: (input: any, context: ToolRun) => unknown
  body?: (part: any, respond: Respond) => ReactNode
  /** The pages a search found, listed when its card is opened */
  links?: (part: any) => Link[] | undefined
}

type NumberedLine = { line: number; content: string }

function numbered(lines: Iterable<string>, first = 1): NumberedLine[] {
  return Array.from(lines, (content, index) => ({ line: first + index, content }))
}

const range = (from: number, to: number) => (from === to ? `${from}` : `${from}-${to}`)

// One read returns at most this many lines; lineCount tells the model if
// there are more
const MAX_LINES = 1000
const MAX_MATCHES = 10

async function readLines(
  { actions, signal }: ToolRun,
  path: string,
  start = 1,
  end = Infinity
) {
  const all = (await actions.readFile(path, signal)).split('\n')
  const first = Math.min(Math.max(start, 1), all.length)
  const last = Math.min(Math.max(end, first), all.length, first + MAX_LINES - 1)
  return { path, lineCount: all.length, lines: numbered(all.slice(first - 1, last), first) }
}

export const TOOLS: Record<string, ToolSpec> = {
  get_lines: {
    label: ({ path, start, end }) => `Read line ${range(start, end)} of ${path}`,
    run: ({ path, start, end }, context) => readLines(context, path, start, end),
  },

  find_in_file: {
    label: ({ path, text }) => `Find “${text ?? ''}” in ${path}`,
    async run({ path, text }, { actions, signal }) {
      const lines = numbered((await actions.readFile(path, signal)).split('\n'))
      return {
        path,
        matches: lines.filter(({ content }) => content.includes(text)).slice(0, MAX_MATCHES),
      }
    },
  },

  get_problems: {
    label: () => 'Check the compile log',
    run(input, { view, openPath, actions }) {
      const { doc } = view.state
      const lint: { fromLine: number; toLine: number; severity: string; message: string }[] = []
      forEachDiagnostic(view.state, (diagnostic, from, to) => {
        // Compile annotations are in the report already
        if (diagnostic.source === 'compile') return
        lint.push({
          fromLine: doc.lineAt(from).number,
          toLine: doc.lineAt(to).number,
          severity: diagnostic.severity,
          message: diagnostic.message,
        })
      })
      return { ...actions.lastCompile(), editorDiagnosticsFile: openPath, editorDiagnostics: lint }
    },
  },

  list_project_files: {
    label: () => 'List the project files',
    run: (input, { actions }) => actions.listFiles(),
  },

  new_file: {
    label: ({ path }) => `Create ${path}`,
    run: ({ path }, { actions }) => actions.newFile(path),
  },

  get_file: {
    label: ({ path }) => `Read ${path}`,
    run: ({ path }, context) => readLines(context, path),
  },

  propose_edit: {
    label: ({ startLine, endLine }) => `Edit line ${range(startLine, endLine)}`,
    body: (part: EditPart, respond) => <EditProposal part={part} respond={respond} />,
  },

  run_compile: {
    label: () => 'Compile',
    run: (input, { actions, signal }) => actions.compile(signal),
  },

  choose_compiler: {
    label: ({ compiler }) => `Switch to ${compiler}`,
    run: ({ compiler }, { actions }) => actions.setCompiler(compiler),
  },

  render_pdf_page: {
    label: ({ page }) => `Look at PDF page ${page}`,
    run: ({ page }, { actions, signal }) => actions.renderPage(page, signal),
    body: part =>
      part.state === 'output-available' && (
        <img
          className="d-block mx-auto my-2 rounded shadow-sm"
          style={{ ...boxed, maxWidth: '100%', maxHeight: 400 }}
          alt={`PDF page ${part.input.page}`}
          src={`data:image/png;base64,${part.output}`}
        />
      ),
  },

  get_pdf_outline: {
    label: () => 'Read the PDF structure',
    run: (input, { actions, signal }) => actions.pdfOutline(signal),
  },

  // The server runs these three; the browser only shows what they found
  web_search: {
    label: ({ query }) => `Search the web for “${query ?? ''}”`,
    links: part =>
      part.state === 'output-available'
        ? part.output.sources.map((source: { url: string; title?: string }) => ({
            href: source.url,
            text: source.title || source.url,
          }))
        : undefined,
  },

  web_fetch: {
    label: ({ url }) => `Read ${url ?? ''}`,
  },

  search_docs: {
    label: ({ query }) => `Search the help pages for “${query ?? ''}”`,
    links(part) {
      if (part.state !== 'output-available') return undefined
      // Each block of the docs MCP result has "Title: ..." and "Link: ..." lines
      return part.output.content.slice(0, 3).map((block: { text: string }) => {
        const field = (name: string) =>
          block.text.match(new RegExp(`^${name}: (.*)$`, 'm'))?.[1]
        return { href: field('Link'), text: field('Title') ?? field('Link') }
      })
    },
  },
}
