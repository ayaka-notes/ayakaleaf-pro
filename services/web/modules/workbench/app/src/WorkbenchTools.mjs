import { convertToModelMessages, tool } from 'ai'
import { z } from 'zod'

/**
 * Tools the browser runs: it holds the open documents, the compile state and
 * the user's approval. They have no execute here, so the AI SDK hands each
 * call to the client, which posts the result back with the next request.
 */

const lineNumber = z.number().int().min(1)
const docPath = z.string().min(1).describe('Path of the document in the project.')

export const CLIENT_TOOLS = {
  get_lines: tool({
    description:
      'Return lines start..end (1-based, inclusive) of a project document, ' +
      'at most 1000, as { path, lineCount, lines: [{ line, content }] }.',
    inputSchema: z.object({
      path: docPath,
      start: lineNumber.describe('First line to return.'),
      end: lineNumber.describe('Last line to return.'),
    }),
  }),

  find_in_file: tool({
    description:
      'Find lines of a project document that contain the given text. Returns ' +
      'at most 10 matches as { path, matches: [{ line, content }] }.',
    inputSchema: z.object({
      path: docPath,
      text: z.string().describe('Text to look for, matched literally.'),
    }),
  }),

  get_problems: tool({
    description:
      'Return the errors and warnings of the last compile (file, line, ' +
      'severity, message, log excerpt) and the linter warnings of the open ' +
      'document, editorDiagnosticsFile. Check compiling, logsReady and hasUncompiledChanges to know ' +
      'whether the compile result is current; line is null when the log names none.',
    inputSchema: z.object({}),
  }),

  list_project_files: tool({
    description: 'Return the path of every file in the project.',
    inputSchema: z.object({}),
  }),

  new_file: tool({
    description:
      'Create an empty document at a project path and open it in the editor.',
    inputSchema: z.object({
      path: z.string().describe('Path in the project, e.g. "chapters/results.tex".'),
    }),
  }),

  get_file: tool({
    description:
      'Return the lines of a project document, the first 1000 of a longer ' +
      'one, as { path, lineCount, lines: [{ line, content }] }.',
    inputSchema: z.object({ path: docPath }),
  }),

  propose_edit: tool({
    description:
      'Suggest replacing lines startLine..endLine of a project document. ' +
      'The user sees the change as a diff and decides whether to apply it. ' +
      'oldText must be the current text of those lines, exactly, so the edit ' +
      'can still be placed if lines moved. Change as little as possible.',
    inputSchema: z.object({
      path: docPath,
      startLine: lineNumber.describe('First line to replace.'),
      endLine: lineNumber.describe('Last line to replace.'),
      oldText: z.string().describe('The current text of those lines, exactly.'),
      newText: z.string().describe('The text to put in their place.'),
      reason: z.string().optional().describe('Why, in one short sentence.'),
    }),
  }),

  run_compile: tool({
    description:
      'Compile the project, wait for the new log and return its errors and ' +
      'warnings with log excerpts.',
    inputSchema: z.object({}),
  }),

  choose_compiler: tool({
    description: 'Switch the TeX engine of the project.',
    inputSchema: z.object({
      compiler: z.enum(['pdflatex', 'xelatex', 'lualatex', 'latex']),
    }),
  }),

  render_pdf_page: tool({
    description:
      'Render one page of the compiled PDF and return it as an image, to ' +
      'check how the output looks.',
    inputSchema: z.object({
      page: lineNumber.describe('Page number, starting at 1.'),
    }),
  }),

  get_pdf_outline: tool({
    description:
      'Return the tagged structure of the compiled PDF, page by page, as ' +
      '{ pageCount, pages }; a long PDF is cut off after about 40,000 characters.',
    inputSchema: z.object({}),
  }),
}

export default CLIENT_TOOLS

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')

/**
 * UI messages to model messages. A rendered page comes back from the browser
 * as base64 PNG text; Chat Completions tool results are text only, so the
 * page goes to the model in a user message right after the tool message.
 * Tools with toModelOutput format their output of earlier steps too.
 */
export async function convertWorkbenchMessages(messages, tools) {
  const converted = await convertToModelMessages(messages, { tools })
  return converted.flatMap(message => {
    if (message.role !== 'tool') return [message]

    const pages = []
    const content = message.content.map(part => {
      if (
        part.type !== 'tool-result' ||
        part.toolName !== 'render_pdf_page' ||
        part.output.type !== 'text'
      ) {
        return part
      }
      const image = part.output.value
      const bytes = Buffer.from(image, 'base64')
      if (
        bytes.toString('base64') !== image ||
        !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
      ) {
        throw new Error('Invalid PDF page image')
      }
      pages.push(
        { type: 'text', text: `Rendered page for call ${part.toolCallId}:` },
        { type: 'image', image, mediaType: 'image/png' }
      )
      return { ...part, output: { type: 'text', value: 'The page is attached below.' } }
    })

    return pages.length
      ? [{ ...message, content }, { role: 'user', content: pages }]
      : [message]
  })
}
