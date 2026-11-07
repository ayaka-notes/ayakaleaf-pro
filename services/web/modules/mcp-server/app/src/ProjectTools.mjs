import Settings from '@overleaf/settings'
import { fetchJson } from '@overleaf/fetch-utils'
import { z } from '../../../../app/src/infrastructure/Validation.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import EditorController from '../../../../app/src/Features/Editor/EditorController.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import { checkAccess, filePath, rateLimiters, text } from './McpUtils.mjs'
import { readDoc } from './FileTools.mjs'

export function buildProjectTools({ userId, projectId }) {
  return {
    get_clone_info: {
      rateLimiter: rateLimiters.getCloneInfo,
      description:
        'How to clone this project with git, to read it all at once and ' +
        'search it, or to change it locally as the server instructions ' +
        'say. Clone into ./<projectId>/, the default folder.',
      handler: async () => {
        return text(
          `git clone ${Settings.siteUrl}/git/${projectId}\n\n` +
            'Git asks for a username and password: the username is "git" and ' +
            'the password is an Overleaf Git authentication token, which the ' +
            'user stores in their git credential helper. Never ask the user ' +
            'to share the token.'
        )
      },
    },

    get_settings: {
      rateLimiter: rateLimiters.getSettings,
      description:
        'Read the project settings: compiler, TeX Live image, main ' +
        'document, main bibliography and spell check language, and the ' +
        'TeX Live images this Overleaf offers.',
      handler: async () => {
        const project = await ProjectGetter.promises.getProject(projectId, {
          compiler: 1,
          imageName: 1,
          rootDoc_id: 1,
          mainBibliographyDoc_id: 1,
          spellCheckLanguage: 1,
          rootFolder: 1,
        })
        const { docs } = ProjectEntityHandler.getAllEntitiesFromProject(project)
        // paths as in the git clone, without the leading /
        const docPath = docId =>
          docs.find(({ doc }) => docId?.equals(doc._id))?.path.slice(1) ?? null
        return text({
          compiler: project.compiler,
          // stored with the image root, set by name like the allowed images
          texLiveImage: project.imageName?.split('/').pop() ?? null,
          mainDocument: docPath(project.rootDoc_id),
          mainBibliography: docPath(project.mainBibliographyDoc_id),
          spellCheckLanguage: project.spellCheckLanguage,
          availableTexLiveImages: (Settings.allowedImageNames || []).map(
            ({ imageName, imageDesc }) => ({ imageName, imageDesc })
          ),
        })
      },
    },

    list_versions: {
      rateLimiter: rateLimiters.listVersions,
      description:
        'List the versions saved in the project history, with their comment.',
      handler: async () => {
        // as the history panel, closed to the viewers who joined by link
        if (
          await AuthorizationManager.promises.isRestrictedUserForProject(
            userId,
            projectId
          )
        ) {
          throw new Error('You cannot see the history of this project')
        }
        const labels = await fetchJson(
          `${Settings.apis.project_history.url}/project/${projectId}/labels`
        )
        return text(
          labels.map(({ version, comment, created_at: createdAt }) => ({
            version,
            comment,
            createdAt,
          }))
        )
      },
    },

    update_settings: {
      rateLimiter: rateLimiters.updateSettings,
      description:
        'Change the compiler, the TeX Live image (one of ' +
        'availableTexLiveImages of get_settings) or the main document.',
      inputSchema: {
        compiler: z.enum(['pdflatex', 'xelatex', 'lualatex', 'latex']).optional(),
        texLiveImage: z.string().optional(),
        mainDocument: filePath.optional(),
      },
      handler: async ({ compiler, texLiveImage, mainDocument }) => {
        await checkAccess(
          AuthorizationManager.promises.canUserWriteProjectSettings,
          userId,
          projectId,
          'You cannot change the settings of this project'
        )
        if (
          texLiveImage &&
          !(Settings.allowedImageNames || []).some(
            ({ imageName }) => imageName === texLiveImage
          )
        ) {
          throw new Error(`${texLiveImage} is not an available TeX Live image`)
        }
        const rootDoc =
          mainDocument && (await readDoc(projectId, mainDocument)).doc
        if (compiler) {
          await EditorController.promises.setCompiler(projectId, compiler)
        }
        if (texLiveImage) {
          await EditorController.promises.setImageName(projectId, texLiveImage)
        }
        if (rootDoc) {
          await EditorController.promises.setRootDoc(projectId, rootDoc._id)
        }
        return text('Settings updated.')
      },
    },
  }
}
