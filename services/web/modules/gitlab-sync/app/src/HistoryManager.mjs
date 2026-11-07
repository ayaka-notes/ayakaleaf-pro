import Settings from '@overleaf/settings'
import OError from '@overleaf/o-error'
import { fetchJson, fetchStream } from '@overleaf/fetch-utils'
import HistoryManager from '../../../../app/src/Features/History/HistoryManager.mjs'

const urlBase = `${Settings.apis.project_history.url}/project`

async function latestVersion(projectId) {
  const url = `${urlBase}/${projectId}/version`
  try {
    await HistoryManager.promises.flushProject(projectId)
    const json = await fetchJson(url)
    return json.version
  } catch (err) {
    throw OError.tag(err, 'Failed to get the latest project version from history', { projectId })
  }
}

// latest summarized updates, newest first: [{ fromV, toV, meta: { origin } }]
async function getUpdates(projectId) {
  const url = `${urlBase}/${projectId}/updates`
  try {
    const json = await fetchJson(url)
    return json.updates
  } catch (err) {
    throw OError.tag(err, 'Failed to get the project updates from history', { projectId })
  }
}

async function getProjectSnapshot(projectId, version) {
  const url = `${urlBase}/${projectId}/version/${version}`
  try {
    const snapshot = await fetchJson(url)
    return snapshot.files || {}
  } catch (err) {
    throw OError.tag(err, 'Failed to get the project snapshot from history', { projectId })
  }
}

async function getPathsAtVersion(projectId, version) {
  const url = `${urlBase}/${projectId}/paths/version/${version}`
  try {
    const json = await fetchJson(url)
    return json
  } catch (err) {
    throw OError.tag(err, 'Failed to fetch file paths from history', { projectId, version })
  }
}

// response field 'diff' is an array of objects:
// {
//   pathname: string,
//   operation: 'added' | 'removed' | 'edited'| 'renamed' | undefined,
//   ...
// }
async function getProjectFileTreeDiff(projectId, fromV, toV) {
  const url = `${urlBase}/${projectId}/filetree/diff?from=${fromV}&to=${toV}`
  try {
    const json = await fetchJson(url)
    return json.diff || []
  } catch (err) {
    throw OError.tag(err, 'Failed to fetch filetree diff from history', { projectId, fromV, toV })
  }
}

// return file from history as a base64 encoded string
async function getProjectFileBuffer(projectId, version, filePath) {
  const url = `${urlBase}/${projectId}/version/${version}/${encodeURIComponent(filePath)}`
  try {
    const stream = await fetchStream(url)
    return await _streamToBase64(stream)
  } catch (err) {
    throw OError.tag(err, 'Failed to fetch file from history', { projectId, version, filePath })
  }
}

async function _streamToBase64(stream) {
  const parts = []
  let leftover = null

  for await (const chunk of stream) {
    const data = leftover ? Buffer.concat([leftover, chunk]) : chunk

    const remainder = data.length % 3
    const completeLength = data.length - remainder

    if (completeLength > 0) {
      parts.push(data.subarray(0, completeLength).toString('base64'))
    }

    leftover = remainder ? data.subarray(completeLength) : null
  }

  if (leftover) {
    parts.push(leftover.toString('base64'))
  }

  return parts.join('')
}

export default {
  latestVersion,
  getUpdates,
  getPathsAtVersion,
  getProjectSnapshot,
  getProjectFileBuffer,
  getProjectFileTreeDiff,
}
