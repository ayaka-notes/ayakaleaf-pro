import { setTimeout } from 'timers/promises'
import Settings from '@overleaf/settings'
import { zz } from '../../../../app/src/infrastructure/Validation.mjs'
import JsonWebToken from '../../../../app/src/infrastructure/JsonWebToken.mjs'
import CompileManager from '../../../../app/src/Features/Compile/CompileManager.mjs'
import ClsiManager from '../../../../app/src/Features/Compile/ClsiManager.mjs'
import { rateLimiters, text } from './McpUtils.mjs'

export const DOWNLOAD_AUDIENCE = 'mcp-download'
const DOWNLOAD_LINK_TTL = '5m'

const buildId = zz.buildId().describe('buildId returned by compile.')
const clsiServerId = zz
  .clsiServerId()
  .optional()
  .describe('clsiServerId returned by compile, when it returned one.')

// Compile output lives in per-user folders, as CompileManager.compile uses
export function compileUserId(userId) {
  return Settings.disablePerUserCompiles ? null : userId
}

export function buildCompileTools({ userId, projectId }) {
  return {
    compile: {
      rateLimiter: rateLimiters.compileProjectHttp,
      description:
        'Compile the project as it is on Overleaf, with the edits of ' +
        'edit_file and write_file; push first only the git commits you made. ' +
        'Returns the status, the buildId and clsiServerId for ' +
        'get_compile_log and get_output_file_link, and the output files.',
      handler: async () => {
        let result = await CompileManager.promises.compile(projectId, userId, {})
        // the open editor of the same user may have just compiled these edits
        if (result.status === 'too-recently-compiled') {
          await setTimeout(CompileManager.COMPILE_DELAY * 1000)
          result = await CompileManager.promises.compile(projectId, userId, {})
        }
        const { status, outputFiles, buildId, clsiServerId } = result
        return text({
          status,
          buildId,
          clsiServerId,
          outputFiles: outputFiles.map(file => file.path),
        })
      },
    },

    get_compile_log: {
      rateLimiter: rateLimiters.miscOutputDownload,
      description: 'Read the LaTeX log (output.log) of a compile.',
      inputSchema: { buildId, clsiServerId },
      handler: async ({ buildId, clsiServerId }) => {
        const stream = await ClsiManager.promises.getOutputFileStream(
          projectId,
          compileUserId(userId),
          clsiServerId,
          buildId,
          'output.log'
        )
        const chunks = []
        for await (const chunk of stream) chunks.push(chunk)
        return text(Buffer.concat(chunks).toString('utf8'))
      },
    },

    get_output_file_link: {
      rateLimiter: rateLimiters.getOutputFileLink,
      description:
        'Get a download link for an output file of a compile, output.pdf by ' +
        'default. The link expires after 5 minutes, e.g. download it with ' +
        'curl -o ./output.pdf "<link>", outside the git clone of the ' +
        'project: output files must never be committed.',
      inputSchema: {
        buildId,
        clsiServerId,
        file: zz
          .filepath()
          .default('output.pdf')
          .describe('Output file name, as listed by compile.'),
      },
      handler: async ({ buildId, clsiServerId, file }) => {
        const token = await JsonWebToken.promises.sign(
          { projectId, userId, buildId, clsiServerId, file },
          { audience: DOWNLOAD_AUDIENCE, expiresIn: DOWNLOAD_LINK_TTL }
        )
        return text(
          `${Settings.siteUrl}/project/${projectId}/mcp/download/${token}`
        )
      },
    },

    word_count: {
      rateLimiter: rateLimiters.wordCount,
      description:
        'Count the words of the main document, or of another .tex file, ' +
        'with texcount. Compile first.',
      inputSchema: {
        file: zz
          .filepath()
          .optional()
          .describe('A .tex file of the project, the main document by default.'),
        clsiServerId,
      },
      handler: async ({ file, clsiServerId }) => {
        const { texcount } = await CompileManager.promises.wordCount(
          projectId,
          compileUserId(userId),
          file || false,
          clsiServerId
        )
        return text(texcount)
      },
    },
  }
}
