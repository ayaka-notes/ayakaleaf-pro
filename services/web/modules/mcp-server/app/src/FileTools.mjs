import Path from 'path'
import { z } from '../../../../app/src/infrastructure/Validation.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import EditorController from '../../../../app/src/Features/Editor/EditorController.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectLocator from '../../../../app/src/Features/Project/ProjectLocator.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import { projectOwnerHasFeature } from '../../../instance-features/app/src/UserFeatures.mjs'
import {
  checkAccess,
  filePath,
  pullHint,
  rateLimiters,
  text,
  version,
} from './McpUtils.mjs'
import { readFileAtVersion } from './HistoryTools.mjs'

// Writes are sent like git-bridge pushes, so open editors apply them
// without the "updated externally" warning
const EDIT_SOURCE = 'git-bridge'

const checkCanEdit = (userId, projectId) =>
  checkAccess(
    AuthorizationManager.promises.canUserWriteProjectContent,
    userId,
    projectId,
    'You cannot edit this project'
  )

const trackChangesArg = z
  .boolean()
  .optional()
  .describe(
    'Make the change a tracked change for the user to review, when they ask ' +
      'for it. Without it the change follows the track changes setting of ' +
      'the project.'
  )

// Without trackChanges a write follows the project's track changes setting,
// as core's upsert does. With it, an existing doc takes the write as a tracked
// change of the token's user, as when track changes is on for them.
async function writeDoc(projectId, userId, path, docId, lines, trackChanges) {
  if (!trackChanges || !docId) {
    return await EditorController.promises.upsertDocWithPath(
      projectId,
      `/${path}`,
      lines,
      EDIT_SOURCE,
      userId
    )
  }
  if (!(await projectOwnerHasFeature(projectId, 'trackChanges'))) {
    throw new Error('Track changes is off for this project')
  }
  await DocumentUpdaterHandler.promises.setDocument(
    projectId,
    docId,
    userId,
    lines,
    EDIT_SOURCE,
    true
  )
}

async function findEntity(projectId, path) {
  return await ProjectLocator.promises.findElementByPath({
    project_id: projectId,
    path: `/${path}`,
    exactCaseMatch: true,
  })
}

async function findEntityOrNull(projectId, path) {
  return await findEntity(projectId, path).catch(err => {
    if (err instanceof Errors.NotFoundError) return null
    throw err
  })
}

// The folder of a path, created as needed like write_file does
async function folderId(projectId, userId, folder) {
  if (folder === '.') {
    const project = await ProjectGetter.promises.getProject(projectId, {
      rootFolder: 1,
    })
    return project.rootFolder[0]._id
  }
  const { lastFolder } = await EditorController.promises.mkdirp(
    projectId,
    `/${folder}`,
    userId
  )
  return lastFolder._id
}

// The latest content of a doc, with the edits not saved yet
export async function readDoc(projectId, path) {
  const { element, type } = await findEntity(projectId, path).catch(err => {
    if (err instanceof Errors.NotFoundError) throw new Error(`${path} not found`)
    throw err
  })
  if (type !== 'doc') throw new Error(`${path} is not a text file`)
  const { lines, version } = await DocumentUpdaterHandler.promises.getDocument(
    projectId,
    element._id,
    -1
  )
  return { doc: element, content: lines.join('\n'), version }
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
        'collaborators, or its content at a version of the history.',
      inputSchema: {
        path: filePath,
        version: version
          .optional()
          .describe(
            'Read the file as it was at this version (toVersion of ' +
              'list_changes); without it, the latest content.'
          ),
      },
      handler: async ({ path, version: v }) =>
        text(
          v == null
            ? (await readDoc(projectId, path)).content
            : await readFileAtVersion(projectId, userId, path, v)
        ),
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
        trackChanges: trackChangesArg,
      },
      handler: async ({ path, oldString, newString, trackChanges }) => {
        await checkCanEdit(userId, projectId)
        const { doc, content } = await readDoc(projectId, path)
        const matches = content.split(oldString).length - 1
        if (matches === 0) {
          throw new Error(`oldString not found in ${path}, read_file again`)
        }
        if (matches > 1) {
          throw new Error(
            `oldString appears ${matches} times in ${path}, add context`
          )
        }
        await writeDoc(
          projectId,
          userId,
          path,
          doc._id,
          content.replace(oldString, () => newString).split('\n'),
          trackChanges
        )
        return text(`Edited ${path}. ${pullHint(projectId)}`)
      },
    },

    write_file: {
      rateLimiter: rateLimiters.writeFile,
      description:
        'Create a text file, or replace all its content; folders are ' +
        'created as needed. Prefer edit_file to change part of a file. A new ' +
        'file is never a tracked change.',
      inputSchema: {
        path: filePath,
        content: z.string().describe('The whole content of the file.'),
        trackChanges: trackChangesArg,
      },
      handler: async ({ path, content, trackChanges }) => {
        await checkCanEdit(userId, projectId)
        // binary files stay binary, as git-bridge keeps them on push
        const existing = await findEntityOrNull(projectId, path)
        if (existing?.type === 'file') {
          throw new Error(`${path} is a binary file, it cannot be written as text`)
        }
        await writeDoc(
          projectId,
          userId,
          path,
          existing?.type === 'doc' ? existing.element._id : null,
          content.split('\n'),
          trackChanges
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

    move_file: {
      rateLimiter: rateLimiters.moveFile,
      description:
        'Move or rename a file or folder, as in the file tree; folders are ' +
        'created as needed. The change shows live in Overleaf.',
      inputSchema: {
        path: filePath,
        newPath: filePath.describe(
          'The new path, e.g. "chapters/intro.tex" to move and rename.'
        ),
      },
      handler: async ({ path, newPath }) => {
        await checkCanEdit(userId, projectId)
        const entity = await findEntityOrNull(projectId, path)
        if (!entity) throw new Error(`${path} not found`)
        if (await findEntityOrNull(projectId, newPath)) {
          throw new Error(`${newPath} already exists`)
        }
        const { element, type } = entity
        const from = Path.posix.dirname(path)
        const to = Path.posix.dirname(newPath)
        const name = Path.posix.basename(newPath)
        const rename = async () => {
          if (name === element.name) return
          await EditorController.promises.renameEntity(
            projectId,
            element._id,
            type,
            name,
            userId,
            EDIT_SOURCE
          )
        }
        const move = async () => {
          if (to === from) return
          await EditorController.promises.moveEntity(
            projectId,
            element._id,
            await folderId(projectId, userId, to),
            type,
            userId,
            EDIT_SOURCE
          )
        }
        // core checks a name in the folder the entity is in at that moment:
        // rename first, unless the old folder has the new name already
        const renamedInPlace = Path.posix.join(from, name)
        if (
          name !== element.name &&
          to !== from &&
          (await findEntityOrNull(projectId, renamedInPlace))
        ) {
          const movedAsIs = Path.posix.join(to, element.name)
          if (await findEntityOrNull(projectId, movedAsIs)) {
            throw new Error(
              `${renamedInPlace} and ${movedAsIs} exist, move ${path} in ` +
                'two steps through a free name'
            )
          }
          await move()
          await rename()
        } else {
          await rename()
          await move()
        }
        return text(`Moved ${path} to ${newPath}. ${pullHint(projectId)}`)
      },
    },

    create_folder: {
      rateLimiter: rateLimiters.createFolder,
      description:
        'Create a folder, and the folders above it as needed. write_file ' +
        'and move_file create the folders of their path themselves.',
      inputSchema: { path: filePath },
      handler: async ({ path }) => {
        await checkCanEdit(userId, projectId)
        const existing = await findEntityOrNull(projectId, path)
        if (existing) {
          throw new Error(
            `${path} already exists${existing.type === 'folder' ? '' : ' as a file'}`
          )
        }
        await folderId(projectId, userId, path)
        return text(`Created ${path}. ${pullHint(projectId)}`)
      },
    },
  }
}
