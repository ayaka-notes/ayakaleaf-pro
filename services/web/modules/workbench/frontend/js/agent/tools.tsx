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
import SourceLinks from '../chat/source-links'
import { boxed } from '../chat/themed'

export type ToolOutput =
  | { tool: string; toolCallId: string; output: unknown }
  | { tool: string; toolCallId: string; state: 'output-error'; errorText: string }

export type Respond = (output: ToolOutput) => void

export type ToolRun = {
  view: EditorView
  actions: ProjectActions
  signal: AbortSignal
}

export type ToolSpec = {
  label: (input: any) => string
  run?: (input: any, context: ToolRun) => unknown
  body?: (part: any, respond: Respond) => ReactNode
}

type NumberedLine = { line: number; content: string }

function numbered(lines: Iterable<string>, first = 1): NumberedLine[] {
  return Array.from(lines, (content, index) => ({ line: first + index, content }))
}

const range = (from: number, to: number) => (from === to ? `${from}` : `${from}-${to}`)

export const TOOLS: Record<string, ToolSpec> = {
  get_lines: {
    label: ({ start, end }) => `Read line ${range(start, end)}`,
    run({ start, end }, { view }) {
      const { doc } = view.state
      const first = Math.min(Math.max(start, 1), doc.lines)
      const last = Math.min(Math.max(end, first), doc.lines)
      return numbered(doc.iterLines(first, last + 1), first)
    },
  },

  get_open_file: {
    label: () => 'Read the open file',
    run: (input, { view }) => numbered(view.state.doc.iterLines()),
  },

  find_in_open_file: {
    label: ({ text }) => `Find “${text ?? ''}”`,
    run({ text }, { view }) {
      return numbered(view.state.doc.iterLines())
        .filter(({ content }) => content.includes(text))
        .slice(0, 10)
    },
  },

  get_problems: {
    label: () => 'Check the compile log',
    run(input, { view, actions }) {
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
      return { ...actions.lastCompile(), editorDiagnostics: lint }
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
    async run({ path }, { actions, signal }) {
      return numbered((await actions.readFile(path, signal)).split('\n'))
    },
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

  // The server runs these two; the browser only shows what they found
  web_search: {
    label: ({ query }) => `Search the web for “${query ?? ''}”`,
    body: part =>
      part.state === 'output-available' && (
        <SourceLinks
          links={part.output.sources.map((source: { url: string }) => ({
            href: source.url,
            text: source.url,
          }))}
        />
      ),
  },

  search_docs: {
    label: ({ query }) => `Search the help pages for “${query ?? ''}”`,
    body(part) {
      if (part.state !== 'output-available') return null
      // Each block of the docs MCP result has "Title: ..." and "Link: ..." lines
      const links = part.output.content.slice(0, 3).map((block: { text: string }) => {
        const field = (name: string) =>
          block.text.match(new RegExp(`^${name}: (.*)$`, 'm'))?.[1]
        return { href: field('Link'), text: field('Title') ?? field('Link') }
      })
      return <SourceLinks links={links} />
    },
  },
}
