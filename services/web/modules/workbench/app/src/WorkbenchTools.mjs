import { convertToModelMessages, tool } from 'ai'
import { z } from 'zod'

/**
 * Declares the schemas of chat tools executed in the browser.
 * These tools omit server-side execute handlers so the AI SDK forwards calls
 * to the editor, where document state and user approval are available. The
 * client returns tool results and continues the conversation.
 */
export const CLIENT_TOOLS = {
  read_lines: tool({
    description:
      'Read a range of lines from the file currently open in the editor. ' +
      'Lines are 1-indexed and the range is inclusive. Returns an array of ' +
      '{ line, content }.',
    inputSchema: z.object({
      fromLine: z.number().int().describe('First line to read (1-indexed, inclusive).'),
      toLine: z.number().int().describe('Last line to read (1-indexed, inclusive).'),
    }),
  }),

  read_current_file: tool({
    description:
      'Read the entire contents of the file currently open in the editor, ' +
      'returned as an array of { line, content }.',
    inputSchema: z.object({}),
  }),

  search_file: tool({
    description:
      'Search the file currently open in the editor for a substring. Returns ' +
      'up to the first 10 matching lines as { line, content }.',
    inputSchema: z.object({
      query: z.string().describe('The substring to search for.'),
    }),
  }),

  get_diagnostics: tool({
    description:
      'Read the latest project compilation diagnostics, including file, line, ' +
      'severity, message and raw log context, plus editor lint diagnostics for ' +
      'the current file. A null line means the compiler did not report a line. ' +
      'Check logsReady, compiling and hasUncompiledChanges before treating logs as current.',
    inputSchema: z.object({}),
  }),

  list_files: tool({
    description: 'List the paths of all files in the current project.',
    inputSchema: z.object({}),
  }),

  create_file: tool({
    description:
      'Create a new file at the given project-relative path and open it in the editor.',
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          'Project-relative path of the file to create, e.g. "sections/intro.tex".'
        ),
    }),
  }),

  open_file: tool({
    description:
      'Read the entire contents of a project file without switching the editor. ' +
      'Returns an array of { line, content } with 1-indexed lines.',
    inputSchema: z.object({
      path: z.string().describe('Project-relative path of the file to read.'),
    }),
  }),

  replace_lines: tool({
    description:
      'Propose replacing a range of lines in a project file. The ' +
      'user is shown a diff and must approve it before the change is applied, ' +
      'so provide its project-relative path and the exact current content of ' +
      'the lines being replaced ' +
      '(so the edit can be located even if the document shifted) together with ' +
      'the full replacement content. Keep edits as small as possible.',
    inputSchema: z.object({
      path: z
        .string()
        .min(1)
        .describe('Project-relative path of the file whose content is being replaced.'),
      fromLine: z
        .number()
        .int()
        .describe('First line of the range to replace (1-indexed, inclusive).'),
      toLine: z
        .number()
        .int()
        .describe('Last line of the range to replace (1-indexed, inclusive).'),
      existingContent: z
        .string()
        .describe(
          'The exact current content of the lines being replaced, verbatim as it ' +
            'appears in the document.'
        ),
      newContent: z
        .string()
        .describe('The replacement content for those lines.'),
      rationale: z
        .string()
        .optional()
        .describe('A short explanation of why this change is being made.'),
    }),
  }),

  compile: tool({
    description:
      'Compile the current project and wait for its new diagnostics. Returns ' +
      'compilation errors, warnings and their raw log context; inspect these ' +
      'to determine whether compilation succeeded.',
    inputSchema: z.object({}),
  }),

  set_compiler: tool({
    description: 'Set the LaTeX compiler used to build the project.',
    inputSchema: z.object({
      compiler: z
        .enum(['pdflatex', 'xelatex', 'lualatex', 'latex'])
        .describe('The compiler to use.'),
    }),
  }),

  view_page: tool({
    description:
      'Render a page of the compiled PDF and return it as an image, so you can ' +
      'inspect the visual output of the document.',
    inputSchema: z.object({
      page: z.number().int().describe('1-indexed PDF page number to view.'),
    }),
  }),

  view_struct_tree: tool({
    description:
      'Get the structure tree (document outline) of the compiled PDF.',
    inputSchema: z.object({}),
  }),
}

export default CLIENT_TOOLS

export async function convertWorkbenchMessages(messages) {
  const converted = await convertToModelMessages(messages)
  return converted.flatMap(message => {
    if (message.role !== 'tool') return [message]

    const images = []
    const content = message.content.map(part => {
      if (
        part.type !== 'tool-result' ||
        part.toolName !== 'view_page' ||
        part.output.type !== 'text'
      ) {
        return part
      }
      const image = part.output.value
      const data = Buffer.from(image, 'base64')
      if (
        data.toString('base64') !== image ||
        !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      ) {
        throw new Error('Invalid PDF page image')
      }
      images.push(
        { type: 'text', text: `PDF page from tool call ${part.toolCallId}:` },
        { type: 'image', image, mediaType: 'image/png' }
      )
      return { ...part, output: { type: 'text', value: 'PDF page image attached.' } }
    })

    // Chat Completions tool messages accept text; images need a user message.
    return images.length
      ? [{ ...message, content }, { role: 'user', content: images }]
      : [message]
  })
}
