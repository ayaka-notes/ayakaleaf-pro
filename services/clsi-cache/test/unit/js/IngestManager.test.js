import { expect } from 'chai'
import fs from 'node:fs'
import Path from 'node:path'
import Settings from '@overleaf/settings'
import * as BuildStore from '../../../app/js/BuildStore.js'
import * as IngestManager from '../../../app/js/IngestManager.js'
import { generateBuildId } from '../../../app/js/utils.js'

const EDITOR_ID = '11111111-2222-4333-8444-555555555555'
const PROJECT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const USER_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'

function writeClsiOutput(buildId, files) {
  const dir = Path.join(
    Settings.path.localClsiOutputDir,
    `${PROJECT_ID}-${USER_ID}`,
    'generated-files',
    buildId
  )
  for (const [name, content] of Object.entries(files)) {
    const path = Path.join(dir, name)
    fs.mkdirSync(Path.dirname(path), { recursive: true })
    fs.writeFileSync(path, content)
  }
  return dir
}

function job(buildId, files) {
  return {
    projectId: PROJECT_ID,
    userId: USER_ID,
    buildId,
    editorId: EDITOR_ID,
    files,
    downloadHost: 'http://127.0.0.1:1',
    clsiServerId: 'clsi-test',
    compileGroup: 'standard',
    stats: { a: 1 },
    timings: { b: 2 },
    options: { compiler: 'pdflatex', imageName: 'texlive-full:2026.1' },
  }
}

describe('IngestManager (local clsi output dir)', function () {
  beforeEach(async function () {
    await BuildStore.deleteDirectory(
      BuildStore.projectPrefix(`${PROJECT_ID}-${USER_ID}`)
    )
  })

  it('hard-links the outputs and writes the meta file after the pdf', async function () {
    const buildId = generateBuildId()
    const dir = writeClsiOutput(buildId, {
      'output.pdf': '%PDF-1.7',
      'output.log': 'log',
      'nested/custom.blg': 'blg',
    })

    const prefix = IngestManager.enqueue(
      job(buildId, [
        { path: 'output.pdf', size: 8, contentId: 'c1', ranges: [] },
        { path: 'output.log' },
        { path: 'nested/custom.blg' },
      ])
    )
    expect(IngestManager.isInflight(prefix)).to.equal(true)
    expect(await IngestManager.waitForBuild(prefix, 5_000)).to.equal(true)

    const files = await BuildStore.listFiles(prefix)
    expect(files).to.deep.equal([
      'nested/custom.blg',
      'output.log',
      'output.overleaf.json',
      'output.pdf',
    ])
    // Same inode: no second copy of the PDF on disk.
    const src = fs.statSync(Path.join(dir, 'output.pdf'))
    const dst = fs.statSync(BuildStore.fsPath(`${prefix}/output.pdf`))
    expect(dst.ino).to.equal(src.ino)
    expect(src.nlink).to.equal(2)

    const meta = await BuildStore.readJSON(`${prefix}/output.overleaf.json`)
    expect(meta).to.deep.equal({
      ranges: [],
      contentId: 'c1',
      size: 8,
      clsiServerId: 'clsi-test',
      compileGroup: 'standard',
      options: { compiler: 'pdflatex', imageName: 'texlive-full:2026.1' },
      stats: { a: 1 },
      timings: { b: 2 },
    })
  })

  it('survives clsi expiring its copy', async function () {
    const buildId = generateBuildId()
    const dir = writeClsiOutput(buildId, { 'output.pdf': 'keep me' })
    const prefix = IngestManager.enqueue(
      job(buildId, [{ path: 'output.pdf', size: 7 }])
    )
    await IngestManager.waitForBuild(prefix, 5_000)

    fs.rmSync(dir, { recursive: true, force: true })
    const stream = await BuildStore.getObjectStream(`${prefix}/output.pdf`)
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString()).to.equal('keep me')
  })

  it('does not write the meta file when the pdf is missing', async function () {
    const buildId = generateBuildId()
    writeClsiOutput(buildId, { 'output.log': 'log' })
    // output.pdf is neither on disk nor reachable via the download host.
    const prefix = IngestManager.enqueue(
      job(buildId, [{ path: 'output.pdf', size: 1 }, { path: 'output.log' }])
    )
    await IngestManager.waitForBuild(prefix, 5_000)

    expect(await BuildStore.listFiles(prefix)).to.deep.equal(['output.log'])
  })
})
