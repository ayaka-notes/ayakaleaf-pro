import sanitizeHtml from 'sanitize-html'
import Settings from '@overleaf/settings'
import { sanitizeOptions } from './sanitizeOptions.mjs'
import fs from 'node:fs'
import logger from '@overleaf/logger'
import Path from 'node:path'
import { expressify } from '@overleaf/promise-utils'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import scrape from './scrape.mjs'
const { scrapeAndCachePage } = scrape


// Check if the filePath are older than maxCacheAge
// Based on Settings.apis.wiki.maxCacheAgeer
// If older, re-fetch and update the cache
async function checkFileCache(learnPagesFolder, pageName) {
  const path = Path.join(learnPagesFolder, encodeURIComponent(pageName) + '.json')
  // Check if file exists
  let stat = null
  let now = Date.now()
  let mtime = 0
  try {
    stat = await fs.promises.stat(path)
    mtime = stat.mtime.getTime()
  } catch (e) {
    logger.error({ err: e }, `error stating cached page file: ${path}`)
  }


  // If the cache is older than maxCacheAge, refresh it
  if (stat === null || now - mtime > Settings.apis.wiki.maxCacheAge) {
    logger.debug({
      now: now,
      mtime: mtime,
      maxCacheAge: Settings.apis.wiki.maxCacheAge
    }, `out of date cache detected for file: ${path}`)

    const BASE_URL = Settings.apis.wiki.url
    const stale = stat && (await fs.promises.readFile(path))

    try {
      await fs.promises.unlink(path)
      logger.debug({}, `deleted cached page file to force re-fetching: ${path}`)
    } catch (e) {
      logger.error({ err: e }, `error deleting cached page file: ${path}`)
    }
    try {
      await scrapeAndCachePage(BASE_URL, pageName)
    } catch (e) {
      if (!stale) throw e
      // The wiki is unreachable: keep serving the stale copy, which is
      // tried again after maxCacheAge
      logger.warn({ err: e }, `error refreshing cached page file: ${path}`)
      await fs.promises.writeFile(path, stale)
    }
  }

}

// Map the request mount path + page name to a MediaWiki page title.
//   /learn/how-to/<Page> -> "Kb/<Page>"   (Knowledge Base namespace)
//   /learn/latex/<Page>  -> "<Page>"
//   /learn[/<Page>]      -> "Main Page" / "<Page>"
function wikiTitleFor(req) {
  const section = req.baseUrl.slice('/learn'.length).replace(/^\//, '')
  const page = decodeURIComponent(req.path)
    .replace(/^\//, '')
    .replace(/_/g, ' ')
    .trim()
  if (page === '') {
    return section === 'how-to' ? 'Kb/Knowledge Base' : 'Main Page'
  }
  return section === 'how-to' ? `Kb/${page}` : page
}

// Load a page's parsed content: serve from the pre-built cache (refreshing
// stale entries), or fetch uncached pages on demand. The wiki API follows
// redirects, so redirect aliases resolve to their target content. Returns null
// when the page does not exist upstream.
async function loadPage(wikiTitle) {
  const folder = Settings.path.learnPagesFolder
  const pageFilePath = Path.resolve(
    folder,
    `${encodeURIComponent(wikiTitle)}.json`
  )
  if (fs.existsSync(pageFilePath)) {
    await checkFileCache(folder, wikiTitle)
    return JSON.parse(await fs.promises.readFile(pageFilePath, 'utf-8'))
  }
  try {
    return await scrapeAndCachePage(Settings.apis.wiki.url, wikiTitle)
  } catch (e) {
    logger.debug({ err: e, wikiTitle }, 'learn page not found upstream')
    return null
  }
}

async function learnPage(req, res) {
  const folder = Settings.path.learnPagesFolder
  const wikiTitle = wikiTitleFor(req)
  logger.debug({ wikiTitle }, 'Learn proxy requested page')

  const pageJson = await loadPage(wikiTitle)
  // Unknown page: return a real 404 instead of silently serving the home page.
  if (!pageJson) {
    return HttpErrorHandler.notFound(req, res)
  }

  await checkFileCache(folder, 'Contents')
  const contentsJson = JSON.parse(
    await fs.promises.readFile(Path.resolve(folder, 'Contents.json'), 'utf-8')
  )

  // Strip any namespace prefix (e.g. "Kb/") from the displayed title.
  const pageTitle = pageJson.title.slice(pageJson.title.lastIndexOf('/') + 1)

  res.render(Path.resolve(import.meta.dirname, '../views/learn'), {
    sidebarHtml: sanitizeHtml(contentsJson.text['*'], sanitizeOptions),
    pageTitle,
    pageHtml: sanitizeHtml(pageJson.text['*'], sanitizeOptions),
  })
}

const LearnProxyController = {
  learnPage: expressify(learnPage),
}

export default LearnProxyController
