import { z } from '../../../../app/src/infrastructure/Validation.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import EditorController from '../../../../app/src/Features/Editor/EditorController.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import ProjectLocator from '../../../../app/src/Features/Project/ProjectLocator.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import { checkAccess, filePath, rateLimiters, text } from './McpUtils.mjs'

// Writes are sent like git-bridge pushes, so open editors apply them
// without the "updated externally" warning
const EDIT_SOURCE = 'git-bridge'

// Edits show live in Overleaf; the clone catches up with one pull per series
const pullHint = projectId =>
  `If you cloned the project, git pull in ./${projectId}/ once this series ` +
  'of edits is done.'

const checkCanEdit = (userId, projectId) =>
  checkAccess(
    AuthorizationManager.promises.canUserWriteProjectContent,
    userId,
    projectId,
    'You cannot edit this project'
  )

async function findEntity(projectId, path) {
  return await ProjectLocator.promises.findElementByPath({
    project_id: projectId,
    path: `/${path}`,
    exactCaseMatch: true,
  })
}

// The latest content of a doc, with the edits not saved yet
export async function readDoc(projectId, path) {
  const { element, type } = await findEntity(projectId, path).catch(err => {
    if (err instanceof Errors.NotFoundError) throw new Error(`${path} not found`)
    throw err
  })
  if (type !== 'doc') throw new Error(`${path} is not a text file`)
  const { lines } = await DocumentUpdaterHandler.promises.getDocument(
    projectId,
    element._id,
    -1
  )
  return { doc: element, content: lines.join('\n') }
}

export function buildFileTools({ userId, projectId }) {
  return {
    list_files: {
      rateLimiter: rateLimiters.listFiles,
      description:
        'List the files of the project: text files (doc) and binary files (file).',
      handler: async () => {
        const { docs, files } =
          await ProjectEntityHandler.promises.getAllEntities(projectId)
        return text([
          ...docs.map(({ path }) => ({ path: path.slice(1), type: 'doc' })),
          ...files.map(({ path }) => ({ path: path.slice(1), type: 'file' })),
        ])
      },
    },

    read_file: {
      rateLimiter: rateLimiters.readFile,
      description:
        'Read the latest content of a text file, including the edits of ' +
        'collaborators.',
      inputSchema: { path: filePath },
      handler: async ({ path }) => text((await readDoc(projectId, path)).content),
    },

    edit_file: {
      rateLimiter: rateLimiters.editFile,
      description:
        'Replace oldString with newString in a text file; the change shows ' +
        'live in Overleaf. oldString must appear exactly once in the latest ' +
        'content: read_file again when it is not found, as a collaborator ' +
        'may have changed it, and add context when it appears more than once.',
      inputSchema: {
        path: filePath,
        oldString: z.string().min(1).describe('Exact text to replace.'),
        newString: z.string().describe('Replacement text.'),
      },
      handler: async ({ path, oldString, newString }) => {
        await checkCanEdit(userId, projectId)
        const { content } = await readDoc(projectId, path)
        const matches = content.split(oldString).length - 1
        if (matches === 0) {
          throw new Error(`oldString not found in ${path}, read_file again`)
        }
        if (matches > 1) {
          throw new Error(
            `oldString appears ${matches} times in ${path}, add context`
          )
        }
        await EditorController.promises.upsertDocWithPath(
          projectId,
          `/${path}`,
          content.replace(oldString, () => newString).split('\n'),
          EDIT_SOURCE,
          userId
        )
        return text(`Edited ${path}. ${pullHint(projectId)}`)
      },
    },

    write_file: {
      rateLimiter: rateLimiters.writeFile,
      description:
        'Create a text file, or replace all its content; folders are ' +
        'created as needed. Prefer edit_file to change part of a file.',
      inputSchema: {
        path: filePath,
        content: z.string().describe('The whole content of the file.'),
      },
      handler: async ({ path, content }) => {
        await checkCanEdit(userId, projectId)
        // binary files stay binary, as git-bridge keeps them on push
        const existing = await findEntity(projectId, path).catch(err => {
          if (err instanceof Errors.NotFoundError) return null
          throw err
        })
        if (existing?.type === 'file') {
          throw new Error(`${path} is a binary file, it cannot be written as text`)
        }
        await EditorController.promises.upsertDocWithPath(
          projectId,
          `/${path}`,
          content.split('\n'),
          EDIT_SOURCE,
          userId
        )
        return text(`Wrote ${path}. ${pullHint(projectId)}`)
      },
    },

    delete_file: {
      rateLimiter: rateLimiters.deleteFile,
      description: 'Delete a file or folder of the project.',
      inputSchema: { path: filePath },
      handler: async ({ path }) => {
        await checkCanEdit(userId, projectId)
        await EditorController.promises.deleteEntityWithPath(
          projectId,
          `/${path}`,
          EDIT_SOURCE,
          userId
        )
        return text(`Deleted ${path}. ${pullHint(projectId)}`)
      },
    },
  }
}
