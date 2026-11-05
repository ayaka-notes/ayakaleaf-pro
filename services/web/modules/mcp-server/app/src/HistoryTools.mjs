import Settings from '@overleaf/settings'
import { fetchJson } from '@overleaf/fetch-utils'
import { z, zz } from '../../../../app/src/infrastructure/Validation.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import HistoryManager from '../../../../app/src/Features/History/HistoryManager.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import RestoreManager from '../../../../app/src/Features/History/RestoreManager.mjs'
import { checkAccess, filePath, limited, person, rateLimiters, text } from './McpUtils.mjs'
// The project history: the same backend the history panel uses. The panel
// reads the project-history service through the web routes
// (/project/:id/updates, /project/:id/diff, the label endpoints) with the
// user's id (X-User-Id header, exactly as
// HistoryController.proxyToHistoryApi does) and injects the users' names
// through HistoryManager.promises.injectUserDetails; restore goes through
// RestoreManager (revertProject / restoreFileFromV2) with the
// write-project permission of the panel's restore routes. The tools below
// use the same backends with the same permission checks, so nothing is
// possible through MCP that the editor would not allow.
//
// Service endpoints used (services/project-history/app/js/Router.js):
//   GET    /project/:id/updates?min_count=N                summarized updates
//   GET    /project/:id/diff?pathname=&from=&to=           one-file diff
//   GET    /project/:id/filetree/diff?from=&to=            whole-project diff
//   GET    /project/:id/version                             latest version
//   GET    /project/:id/version/:version/:pathname          file content
//   GET    /project/:id/labels                              named versions
//   POST   /project/:id/labels                              create a label
//   DELETE /project/:id/labels/:label_id                    delete (owner)
//   DELETE /project/:id/user/:user_id/labels/:label_id      delete (other)
const historyUrl = path => `${Settings.apis.project_history.url}${path}`
const blockLinkViewers = (userId, projectId) =>
  checkAccess(
    async (userId, projectId) =>
      !(await AuthorizationManager.promises.isRestrictedUserForProject(userId, projectId)),
    userId,
    projectId,
    'You can\'t see the history of this project (you joined by link)'
  )
const canRead = (userId, projectId) =>
  checkAccess(
    (userId, projectId) =>
      AuthorizationManager.promises.canUserReadProject(userId, projectId),
    userId,
    projectId,
    'You can\'t read this project'
  )
const canWrite = (userId, projectId) =>
  checkAccess(
    (userId, projectId) =>
      AuthorizationManager.promises.canUserWriteProjectContent(userId, projectId),
    userId,
    projectId,
    'You can\'t change the files of this project'
  )
const asPath = p => p.replace(/^\/+/, '') // history pathnames are bare ("src/intro.tex")
async function latestVersion(projectId, userId) {
  const body = await fetchJson(historyUrl(`/project/${projectId}/version`), {
    headers: { 'X-User-Id': userId },
  })
  return body.version
}
export function buildHistoryTools({ userId, projectId, client }) {
  return {
    list_history: {
      rateLimiter: rateLimiters.listHistory,
      description:
        'List the project history, newest first: each update with its ' +
        'version number, who made it, when, the comment, and which files ' +
        'it touched. Viewers who joined by link do not see the history, ' +
        'like in Overleaf.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('At most this many history entries.'),
      },
      handler: async ({ limit }) => {
        await blockLinkViewers(userId, projectId)
        await canRead(userId, projectId)
        const body = await fetchJson(
          historyUrl(`/project/${projectId}/updates?min_count=${limit}`),
          { headers: { 'X-User-Id': userId } }
        )
        const data = await HistoryManager.promises.injectUserDetails(body)
        const updates = data.updates || (Array.isArray(data) ? data : [])
        return text(
          updates.map(entry => ({
            // summarized updates span a version range (fromV..toV); a single
            // edit is fromV+1..toV, i.e. "version toV"
            version:
              entry.toV != null
                ? entry.fromV == null || entry.fromV + 1 === entry.toV
                  ? entry.toV
                  : `${entry.fromV + 1}…${entry.toV}`
                : entry.version,
            users: (entry.meta?.users || [])
              .map(u => person(u))
              .filter(Boolean),
            date: new Date(entry.meta?.end_ts || entry.meta?.start_ts || 0)
              .toISOString(),
            comment: entry.labels?.[0]?.comment || entry.comment || '',
            labels: (entry.labels || []).map(l => l.comment).filter(Boolean),
            files: Array.from(entry.pathnames || []).map(p => p.slice(1)),
          }))
        )
      },
    },
    get_diff: {
      rateLimiter: rateLimiters.getDiff,
      description:
        'The diff between two versions. Without a file: which files were '
        +
        'added/changed/removed in that span + per-file details. With a file: '
        +
        'the unified content diff of that file. Truncated to a readable '
        +
        'size. versionA older, versionB newer; omit both for the whole '
        +
        'content so far.',
      inputSchema: {
        file: filePath.optional().describe(
          'One file, e.g. sections/intro.tex; without it the file list + per-file summary.'
        ),
        versionA: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Older version (0 = empty), default 0.'),
        versionB: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Newer version, default the current state.'),
      },
      handler: async ({ file, versionA, versionB }) => {
        await blockLinkViewers(userId, projectId)
        await canRead(userId, projectId)
        const to =
          versionB ??
          (await latestVersion(projectId, userId).catch(() => null)) ??
          0
        const from = versionA ?? 0
        const url = file
          ? historyUrl(
              `/project/${projectId}/diff?pathname=${encodeURIComponent(
                asPath(file)
              )}&from=${from}&to=${to}`
            )
          : historyUrl(
              `/project/${projectId}/filetree/diff?from=${from}&to=${to}`
            )
        const body = await fetchJson(url, {
          headers: { 'X-User-Id': userId },
        })
        const data = await HistoryManager.promises.injectUserDetails(body).catch(
          () => body
        )
        const out =
          typeof data === 'string' ? data : JSON.stringify(data, null, 2)
        return text(limited(out, 'diff'))
      },
    },
    read_version_file: {
      rateLimiter: rateLimiters.getDiff,
      description:
        'Read ONE project file as it was at a given version (the ' +
        '"view this version" content): the whole file text at that ' +
        'version.',
      inputSchema: {
        file: filePath.describe('The file, e.g. sections/intro.tex.'),
        version: z
          .number()
          .int()
          .min(0)
          .describe('The version to read (list_history gives them).'),
      },
      handler: async ({ file, version }) => {
        await blockLinkViewers(userId, projectId)
        await canRead(userId, projectId)
        const url = historyUrl(
          `/project/${projectId}/version/${version}/${asPath(file).split('/').map(encodeURIComponent).join('/')}`
        )
        const res = await fetch(url, { headers: { 'X-User-Id': userId } })
        if (!res.ok) {
          throw new Error(
            `Version ${version} of ${file} is not available (${res.status}). ` +
              'Try another version, list_history shows the available ones.'
          )
        }
        const body = await res.text()
        return text(limited(body, `file ${file} @ version ${version}`))
      },
    },
    create_version: {
      rateLimiter: rateLimiters.createVersion,
      description:
        'Create a named version at the current state (the "create version" '
        + 'of the history panel), with a comment; then visible to the user '
        + 'in the panel and in list_versions here. Versions created through '
        + 'MCP are marked "via MCP" in their comment, so the owner can tell '
        + 'agent-created versions apart.',
      inputSchema: {
        comment: z.string().min(1).max(200).describe('The label/comment.'),
      },
      handler: async ({ comment }) => {
        // as POST /project/:id/labels (write-or-review, like the panel)
        await checkAccess(
          (userId, projectId) =>
            AuthorizationManager.promises.canUserWriteOrReviewProjectContent(userId, projectId),
          userId,
          projectId,
          'You can\'t create named versions of this project'
        )
        const version = await latestVersion(projectId, userId)
        // overleaf-lab (issue #126, plan step 7 — AI identity layer): the
        // version's author is the PAT owner; the marker makes it visible to
        // humans reviewing the history that THIS version came from an agent
        // (and which one, when the harness sends X-MCP-Client).
        const source = client && client !== 'mcp' ? ` via MCP ${client}` : ' via MCP'
        const labeled = [comment.trim(), source].filter(Boolean).join('').slice(0, 240)
        const label = await fetchJson(
          historyUrl(`/project/${projectId}/labels`),
          {
            method: 'POST',
            headers: { 'X-User-Id': userId },
            json: { comment: labeled, version, user_id: userId },
          }
        )
        return text(
          `Version ${version} is now labeled \u201c${labeled}\u201d (id ${label.id}).`
        )
      },
    },
    delete_version_label: {
      rateLimiter: rateLimiters.deleteVersionLabel,
      description:
        'Delete a named version (a label); the version itself stays in ' +
        'the history, only the name is removed. list_versions (the ' +
        'current tool) shows the labels and their ids. You can only ' +
        'delete your own labels, unless you own the project — like in ' +
        'Overleaf.',
      inputSchema: {
        labelId: zz.objectId().describe('The label id from list_versions.'),
      },
      handler: async ({ labelId }) => {
        await checkAccess(
          (userId, projectId) =>
            AuthorizationManager.promises.canUserWriteOrReviewProjectContent(userId, projectId),
          userId,
          projectId,
          'You can\'t delete named versions of this project'
        )
        // the web controller deletes owner labels through the shared
        // endpoint and everybody else's through the user-specific one
        const project = await ProjectGetter.promises.getProject(projectId, {
          owner_ref: true,
        })
        const url = project.owner_ref.equals(userId) || String(project.owner_ref) === String(userId)
          ? historyUrl(`/project/${projectId}/labels/${labelId}`)
          : historyUrl(
              `/project/${projectId}/user/${userId}/labels/${labelId}`
            )
        // the DELETE responds 204 with an empty body — not JSON
        const res = await fetch(url, {
          method: 'DELETE',
          headers: { 'X-User-Id': userId },
        })
        if (!res.ok && res.status !== 204) {
          const body = await res.text().catch(() => '')
          if (res.status === 404) {
            throw new Error(
              'Label not found or it is not yours — list the labels with list_versions.'
            )
          }
          throw new Error(
            `Deleting the label failed: ${res.status} ${body}`.slice(0, 300)
          )
        }
        return text('Label deleted.')
      },
    },
    restore_project_version: {
      rateLimiter: rateLimiters.restoreProject,
      description:
        'Restore the WHOLE project to an older version (the history ' +
        'panel restore). DESTRUCTIVE: every file goes back to that ' +
        'version. A new version is created, so the previous content ' +
        'stays reachable in the history. Before restoring, show the user ' +
        'what changes with get_diff (version: the old one, vs now) — or ' +
        'create_version first as a safety label.',
      inputSchema: {
        version: z
          .number()
          .int()
          .min(0)
          .describe('The version to restore (list_history).'),
        confirm: z
          .boolean()
          .describe('Must be true; this replaces every file.'),
      },
      handler: async ({ version, confirm }) => {
        if (!confirm) {
          throw new Error(
            'confirm=true is required: restoring replaces every file.'
          )
        }
        await canWrite(userId, projectId)
        await RestoreManager.promises.revertProject(userId, projectId, version)
        return text(
          `Restored the project to version ${version}. A new version now ` +
            'exists, so the previous content is still in the history.'
        )
      },
    },
    restore_file_version: {
      rateLimiter: rateLimiters.restoreFileVersion,
      description:
        'Restore ONE file to an older version (the history panel file ' +
        'restore). DESTRUCTIVE for that file: its current content goes ' +
        'back to that version. A new version is created, so the previous ' +
        'content stays reachable in the history.',
      inputSchema: {
        file: filePath.describe('The file, e.g. sections/intro.tex.'),
        version: z
          .number()
          .int()
          .min(0)
          .describe('The version to restore (list_history).'),
        confirm: z
          .boolean()
          .describe('Must be true; this replaces the current content.'),
      },
      handler: async ({ file, version, confirm }) => {
        if (!confirm) {
          throw new Error(
            'confirm=true is required: restoring replaces the current content.'
          )
        }
        await canWrite(userId, projectId)
        await RestoreManager.promises.restoreFileFromV2(
          userId,
          projectId,
          version,
          asPath(file).replace(/^\/+/, '')
        )
        return text(
          `Restored ${file} to version ${version}. The previous content ` +
            'is still in the project history.'
        )
      },
    },
  }
}
