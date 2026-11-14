import { postJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'
import getMeta from '@/utils/meta'

const wakaTimeDebugLogging = !!getMeta('ol-ExposedSettings')?.wakaTimeDebugLogging

export function wakaTimeLog(...args: unknown[]) {
  if (wakaTimeDebugLogging) {
    // eslint-disable-next-line no-console
    console.log('[wakatime]', ...args)
  }
}

// WakaTime clients only send a heartbeat if more than this long has passed
// since the last one for the same file, or the file was switched/saved.
const HEARTBEAT_THROTTLE_MS = 2 * 60 * 1000

// WakaTime/Wakapi identify the sending editor by parsing this string as
// `wakatime/version (os) editorName/editorVersion editorName-wakatime/pluginVersion`
// (the same convention every official wakatime-cli-based plugin uses).
// Must start with "wakatime/" and have a recognized OS token in parens
// next, or the parser bails out and reports the editor as "unknown".
const USER_AGENT = 'wakatime/1.0.0 (linux) overleaf/1.0 overleaf-wakatime/1.0'

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  tex: 'LaTeX',
  ltx: 'LaTeX',
  sty: 'TeX',
  cls: 'TeX',
  bib: 'BibTeX',
  bbx: 'TeX',
  cbx: 'TeX',
  md: 'Markdown',
  rnw: 'R',
  py: 'Python',
  r: 'R',
  json: 'JSON',
  yml: 'YAML',
  yaml: 'YAML',
}

function languageForFile(fileName: string): string | undefined {
  const match = /\.([^./]+)$/.exec(fileName)
  const ext = match?.[1]?.toLowerCase()
  return ext ? EXTENSION_TO_LANGUAGE[ext] : undefined
}

const lastHeartbeatAt = new Map<string, number>()

function buildHeartbeat(docName: string, isWrite: boolean) {
  const heartbeat: Record<string, unknown> = {
    entity: docName,
    type: 'file',
    time: Date.now() / 1000,
    is_write: isWrite,
    user_agent: USER_AGENT,
    branch: 'main',
  }
  const language = languageForFile(docName)
  if (language) heartbeat.language = language
  return heartbeat
}

function send(projectId: string, docName: string, isWrite: boolean) {
  const heartbeat = buildHeartbeat(docName, isWrite)
  wakaTimeLog('sending heartbeat', { projectId, docName, isWrite, heartbeat })
  postJSON(`/project/${projectId}/wakatime/heartbeat`, {
    body: heartbeat,
  }).then(
    res => wakaTimeLog('heartbeat sent OK', { docName, res }),
    err => {
      // WakaTime not linked, unreachable, etc — never surface this to the user
      wakaTimeLog('heartbeat FAILED', {
        docName,
        status: err?.response?.status,
        message: err?.message || err,
        data: err?.data,
      })
      debugConsole.log('wakatime heartbeat not sent', err?.message || err)
    }
  )
  lastHeartbeatAt.set(docName, Date.now())
}

/** Called whenever the user opens/switches to a file in the editor. */
export function notifyFileOpened(projectId: string, docName: string) {
  wakaTimeLog('notifyFileOpened', docName)
  send(projectId, docName, false)
}

/**
 * Called on every local (non-collaborator, non-undo/reject) CodeMirror edit.
 * Throttled to at most one heartbeat per file per HEARTBEAT_THROTTLE_MS.
 */
export function notifyLocalEdit(projectId: string, docName: string) {
  const last = lastHeartbeatAt.get(docName) || 0
  if (Date.now() - last < HEARTBEAT_THROTTLE_MS) {
    wakaTimeLog('notifyLocalEdit throttled', docName)
    return
  }
  wakaTimeLog('notifyLocalEdit', docName)
  send(projectId, docName, false)
}

/** Called when the document has just been saved (acked by ShareJS). */
export function notifyFileSaved(projectId: string, docName: string) {
  wakaTimeLog('notifyFileSaved', docName)
  send(projectId, docName, true)
}
