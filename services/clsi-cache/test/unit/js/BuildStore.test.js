import { expect } from 'chai'
import { Readable } from 'node:stream'
import * as BuildStore from '../../../app/js/BuildStore.js'
import { generateBuildId } from '../../../app/js/utils.js'

const EDITOR_ID = '11111111-2222-4333-8444-555555555555'
const PROJECT_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbbbbbbbbbb'

async function putBuild(projectKey, timestamp, files) {
  const editorBuildId = `${EDITOR_ID}-${generateBuildId(timestamp)}`
  const prefix = BuildStore.buildPrefix(projectKey, editorBuildId)
  for (const [name, content] of Object.entries(files)) {
    await BuildStore.sendStream(
      `${prefix}/${name}`,
      Readable.from([Buffer.from(content)])
    )
  }
  return { editorBuildId, prefix }
}

describe('BuildStore', function () {
  beforeEach(async function () {
    await BuildStore.deleteDirectory(BuildStore.projectPrefix(PROJECT_KEY))
  })

  it('lists builds newest first with their files', async function () {
    const older = await putBuild(PROJECT_KEY, 1_000, { 'output.pdf': 'a' })
    const newer = await putBuild(PROJECT_KEY, 2_000, {
      'output.pdf': 'bb',
      'output.log': 'log',
      'sub/refs.blg': 'blg',
    })

    const builds = await BuildStore.listBuilds(PROJECT_KEY)
    expect(builds.map(b => b.editorBuildId)).to.deep.equal([
      newer.editorBuildId,
      older.editorBuildId,
    ])
    expect(builds[0].timestamp).to.equal(2_000)
    expect(builds[0].files).to.deep.equal([
      'output.log',
      'output.pdf',
      'sub/refs.blg',
    ])
  })

  it('finds the latest build that has a given file', async function () {
    const withTar = await putBuild(PROJECT_KEY, 1_000, {
      'output.pdf': 'a',
      'output.tar.gz': 'tar',
    })
    const pdfOnly = await putBuild(PROJECT_KEY, 2_000, { 'output.pdf': 'b' })

    const latestPdf = await BuildStore.findLatestBuild(PROJECT_KEY, 'output.pdf')
    expect(latestPdf.editorBuildId).to.equal(pdfOnly.editorBuildId)

    const latestTar = await BuildStore.findLatestBuild(
      PROJECT_KEY,
      'output.tar.gz'
    )
    expect(latestTar.editorBuildId).to.equal(withTar.editorBuildId)

    expect(await BuildStore.findLatestBuild(PROJECT_KEY, 'output.log')).to.equal(
      undefined
    )
  })

  it('reports sizes and streams ranges', async function () {
    const { prefix } = await putBuild(PROJECT_KEY, 1_000, {
      'output.pdf': '0123456789',
    })
    const key = `${prefix}/output.pdf`
    expect(await BuildStore.getObjectSize(key)).to.equal(10)
    const stream = await BuildStore.getObjectStream(key, { start: 2, end: 4 })
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString()).to.equal('234')
  })

  it('copies a build to another prefix and lists project keys', async function () {
    const { prefix } = await putBuild(PROJECT_KEY, 1_000, {
      'output.pdf': 'a',
      'output.overleaf.json': '{"size":1}',
    })
    const dst = BuildStore.templatePrefix('tmpl-v1', 'texlive-full:2026.1')
    const copied = await BuildStore.copyPrefix(prefix, dst)
    expect(copied).to.deep.equal(['output.overleaf.json', 'output.pdf'])
    expect(await BuildStore.readJSON(`${dst}/output.overleaf.json`)).to.deep.equal(
      { size: 1 }
    )
    expect(await BuildStore.listProjectKeys()).to.include(PROJECT_KEY)
    await BuildStore.deleteDirectory(dst)
  })
})
