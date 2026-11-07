/**
 * Builds a remote WebDAV path for an Overleaf project.
 * Combines the user's root path with the project name and optional file path.
 * 
 * @param {string} rootPath - The user's base WebDAV path (e.g., '/Nextcloud/Overleaf')
 * @param {string} projectName - The Overleaf project name
 * @param {string} [filePath='/'] - Optional specific file path within the project folder
 * @returns {string} Complete remote path (e.g., '/ Nextcloud/Overleaf/my-project/report.tex')
 */
export function remotePath(rootPath, projectName, filePath = '/') {
  return `${rootPath}/${projectName}${filePath}`.replace(/\/+/g, '/')
}

export default {
  remotePath
}
