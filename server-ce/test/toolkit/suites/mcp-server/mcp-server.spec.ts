import { v4 as uuid } from 'uuid'
import { setSuspended, setUserFeatures } from '../../../helpers/adminTools'
import {
  createGitToken,
  git,
  gitClone,
  gitCommitAndPush,
  workingCopy,
} from '../../../helpers/git'
import { login } from '../../../helpers/login'
import {
  createProject,
  openProject,
  projectName,
} from '../../../helpers/project'
import { requestWithCsrf } from '../../../helpers/request'
import {
  addComment,
  commentEntry,
  openReviewPanel,
  reviewPanel,
  waitForServer,
} from '../../../helpers/review'
import { shareProject, shareProjectByLink } from '../../../helpers/sharing'
import { ADMIN_EMAIL, ensureUserExists } from '../../../helpers/users'

// The MCP server of a project (/project/:id/mcp), next to git-bridge: the
// same personal access tokens authenticate MCP clients and git.

const owner = `owner-${uuid()}@example.com`
const viewer = `viewer-${uuid()}@example.com`
const stranger = `stranger-${uuid()}@example.com`
const reviewer = `reviewer-${uuid()}@example.com`
const linkViewer = `link-viewer-${uuid()}@example.com`

const MAIN_TEX = [
  '\\documentclass{article}',
  '\\begin{document}',
  'Pushed through git',
  '\\end{document}',
  '',
].join('\n')

type ToolResult = {
  content: { type: string; text: string }[]
  isError?: boolean
}

before(function () {
  for (const email of [owner, viewer, stranger, reviewer, linkViewer]) {
    ensureUserExists(email)
  }
})

// A JSON-RPC request the way MCP clients send it over Streamable HTTP
function mcp(
  projectId: string,
  token: string | null,
  method: string,
  params: Record<string, unknown> = {}
) {
  return cy.request({
    method: 'POST',
    url: `/project/${projectId}/mcp`,
    headers: {
      Accept: 'application/json, text/event-stream',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: { jsonrpc: '2.0', id: 1, method, params },
    failOnStatusCode: false,
  })
}

function callTool(
  projectId: string,
  token: string,
  name: string,
  args: Record<string, unknown> = {}
): Cypress.Chainable<ToolResult> {
  return mcp(projectId, token, 'tools/call', { name, arguments: args }).then(
    response => {
      expect(response.status).to.equal(200)
      return response.body.result as ToolResult
    }
  )
}

function toolJson(result: ToolResult) {
  expect(result.isError, result.content[0].text).not.to.equal(true)
  return JSON.parse(result.content[0].text)
}

type Compile = {
  status: string
  buildId: string
  clsiServerId?: string
  outputFiles: string[]
}

// Overleaf refuses a compile within a second of the previous one and while one
// runs, as when an editor just opened the project and compiles it by itself
function compile(
  projectId: string,
  token: string,
  attempts = 30
): Cypress.Chainable<Compile> {
  return callTool(projectId, token, 'compile')
    .then(toolJson)
    .then((build: Compile) => {
      if (
        build.status !== 'too-recently-compiled' &&
        build.status !== 'compile-in-progress'
      ) {
        return build
      }
      expect(attempts, build.status).to.be.greaterThan(0)
      cy.wait(1000)
      return compile(projectId, token, attempts - 1)
    })
}

function outputFileLink(
  projectId: string,
  token: string,
  build: Compile,
  file?: string
): Cypress.Chainable<string> {
  return callTool(projectId, token, 'get_output_file_link', {
    buildId: build.buildId,
    clsiServerId: build.clsiServerId,
    file,
  }).then(result => {
    expect(result.isError).not.to.equal(true)
    return result.content[0].text
  })
}

// The links point at the site URL; Cypress requests the path
function download(link: string) {
  return cy.request({
    url: new URL(link).pathname,
    encoding: 'binary',
    failOnStatusCode: false,
  })
}

describe('MCP server of a project', function () {
  let projectId: string
  let ownerToken: string
  let viewerToken: string

  before(function () {
    login(owner)
    createProject(projectName('Mcp')).then(id => {
      projectId = id
    })
    cy.then(() => shareProject(projectId, viewer, 'readOnly'))
    login(owner)
    createGitToken().then(token => {
      ownerToken = token
    })
    login(viewer)
    createGitToken().then(token => {
      viewerToken = token
    })
  })

  it('lists the tools of the project', function () {
    mcp(projectId, ownerToken, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'e2e', version: '1.0.0' },
    })
      .its('body.result')
      .should(result => {
        expect(result.serverInfo.name).to.equal('overleaf')
        // where to clone and where to download, so outputs stay out of git
        expect(result.instructions).to.contain(`./${projectId}/`)
        expect(result.instructions).to.contain('./output.pdf')
        // live edits for text, git for local work and binary files
        expect(result.instructions).to.contain('git pull')
        expect(result.instructions).to.contain('push once')
      })
    mcp(projectId, ownerToken, 'tools/list')
      .its('body.result.tools')
      .then((tools: { name: string }[]) => tools.map(tool => tool.name).sort())
      .should('deep.equal', [
        'accept_tracked_changes',
        'add_comment',
        'compile',
        'create_folder',
        'create_version',
        'delete_comment_message',
        'delete_file',
        'delete_version',
        'diff',
        'edit_comment_message',
        'edit_file',
        'get_clone_info',
        'get_compile_log',
        'get_output_file_link',
        'get_settings',
        'list_changes',
        'list_chat_messages',
        'list_comments',
        'list_files',
        'list_tracked_changes',
        'list_versions',
        'move_file',
        'read_file',
        'reopen_comment',
        'reply_to_comment',
        'resolve_comment',
        'restore_file',
        'restore_project',
        'send_chat_message',
        'update_settings',
        'word_count',
        'write_file',
      ])
  })

  it('refuses requests without a valid token', function () {
    mcp(projectId, null, 'tools/list').its('status').should('equal', 401)
    mcp(projectId, 'olp_not-a-real-token', 'tools/list')
      .its('status')
      .should('equal', 401)
  })

  it('refuses a token once it is deleted', function () {
    login(owner)
    createGitToken().then(token => {
      mcp(projectId, token, 'tools/list').its('status').should('equal', 200)
      cy.request('/oauth/personal-access-tokens').then(response => {
        const created = response.body.find(
          (t: { accessTokenPartial: string }) =>
            token.startsWith(t.accessTokenPartial)
        )
        // The MCP request shows as the last use on the settings page
        expect(created.lastUsedAt).to.be.a('string')
        requestWithCsrf('DELETE', `/oauth/personal-access-tokens/${created._id}`)
          .its('status')
          .should('be.lessThan', 400)
      })
      mcp(projectId, token, 'tools/list').its('status').should('equal', 401)
    })
  })

  it('refuses a user without access to the project', function () {
    login(stranger)
    createGitToken().then(token => {
      mcp(projectId, token, 'tools/list').its('status').should('equal', 403)
    })
  })

  it('only answers POST requests', function () {
    cy.request({
      url: `/project/${projectId}/mcp`,
      headers: { Authorization: `Bearer ${ownerToken}` },
      failOnStatusCode: false,
    })
      .its('status')
      .should('equal', 405)
  })

  it('tells how to clone the project, without the token', function () {
    callTool(projectId, ownerToken, 'get_clone_info').then(result => {
      const text = result.content[0].text
      expect(text).to.contain(`git clone http://sharelatex/git/${projectId}`)
      expect(text).not.to.contain(ownerToken)
    })
  })

  it('compiles what was pushed with git and reads the log', function () {
    const dir = workingCopy('mcp-push')
    gitClone(projectId, ownerToken, dir).its('exitCode').should('equal', 0)
    gitCommitAndPush(dir, 'main.tex', MAIN_TEX, 'Push main.tex')
      .its('exitCode')
      .should('equal', 0)

    compile(projectId, ownerToken).then(build => {
      expect(build.status).to.equal('success')
      expect(build.outputFiles).to.include.members(['output.pdf', 'output.log'])
      callTool(projectId, ownerToken, 'get_compile_log', {
        buildId: build.buildId,
        clsiServerId: build.clsiServerId,
      }).then(result => {
        expect(result.content[0].text).to.contain('Output written on output.pdf')
      })
    })
  })

  it('compiles again right after a compile', function () {
    compile(projectId, ownerToken)
    // within the second the editor waits between compiles, MCP waits for it
    callTool(projectId, ownerToken, 'compile')
      .then(toolJson)
      .its('status')
      .should('equal', 'success')
  })

  it('counts the words of what was pushed', function () {
    compile(projectId, ownerToken).then(build => {
      callTool(projectId, ownerToken, 'word_count', {
        clsiServerId: build.clsiServerId,
      })
        .then(toolJson)
        .its('textWords')
        .should('equal', 3)
    })
  })

  it('reads the project settings', function () {
    callTool(projectId, viewerToken, 'get_settings')
      .then(toolJson)
      .should(settings => {
        expect(settings).to.include({
          mainDocument: 'main.tex',
          spellCheckLanguage: 'en',
        })
        expect(settings.compiler).to.be.a('string')
        expect(settings.availableTexLiveImages).to.be.an('array')
      })
  })

  it('lists the versions saved in the history', function () {
    login(owner)
    cy.visit(`/project/${projectId}`)
    cy.request(`/project/${projectId}/updates?min_count=1`)
      .its('body.updates.0.toV')
      .then(version =>
        requestWithCsrf('POST', `/project/${projectId}/labels`, {
          comment: 'Submitted draft',
          version,
        })
          .its('status')
          .should('equal', 200)
      )
    callTool(projectId, viewerToken, 'list_versions')
      .then(toolJson)
      .then((versions: { comment: string }[]) =>
        versions.map(version => version.comment)
      )
      .should('include', 'Submitted draft')
  })

  it('downloads the PDF through a link for this project only', function () {
    compile(projectId, ownerToken).then(build => {
      outputFileLink(projectId, ownerToken, build).then(link => {
        expect(link).to.match(
          new RegExp(`^http://sharelatex/project/${projectId}/mcp/download/`)
        )
        expect(link).not.to.contain(ownerToken)
        download(link).then(response => {
          expect(response.status).to.equal(200)
          expect(response.headers['content-disposition']).to.contain(
            'output.pdf'
          )
          expect(response.body.startsWith('%PDF')).to.equal(true)
        })
        download(link.slice(0, -2) + 'xx').its('status').should('equal', 404)
        download(link.replace(projectId, '0'.repeat(24)))
          .its('status')
          .should('equal', 404)
      })
      outputFileLink(projectId, ownerToken, build, 'output.log').then(link =>
        download(link).its('body').should('contain', 'Output written on')
      )
    })
  })

  it('lets a viewer compile and download but not change the compiler', function () {
    compile(projectId, viewerToken).then(build => {
      expect(build.status).to.equal('success')
      outputFileLink(projectId, viewerToken, build).then(link =>
        download(link).its('status').should('equal', 200)
      )
    })
    callTool(projectId, viewerToken, 'update_settings', {
      compiler: 'xelatex',
    }).then(result => {
      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.contain('cannot change the settings')
    })
  })

  it('lets the owner change the compiler', function () {
    callTool(projectId, ownerToken, 'update_settings', {
      compiler: 'xelatex',
    }).then(result => expect(result.isError).not.to.equal(true))
    compile(projectId, ownerToken).then(build => {
      callTool(projectId, ownerToken, 'get_compile_log', {
        buildId: build.buildId,
        clsiServerId: build.clsiServerId,
      }).then(result => expect(result.content[0].text).to.contain('XeTeX'))
    })
  })

  it('refuses a TeX Live image Overleaf does not offer', function () {
    callTool(projectId, ownerToken, 'update_settings', {
      texLiveImage: 'texlive/texlive:1999',
    }).then(result => {
      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.contain('not an available TeX Live image')
    })
  })

  it('changes the spell check language', function () {
    callTool(projectId, viewerToken, 'update_settings', {
      spellCheckLanguage: 'de',
    }).then(result => {
      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.contain('cannot change the settings')
    })
    callTool(projectId, ownerToken, 'update_settings', {
      spellCheckLanguage: 'de',
    }).then(result => expect(result.isError).not.to.equal(true))
    callTool(projectId, viewerToken, 'get_settings')
      .then(toolJson)
      .its('spellCheckLanguage')
      .should('equal', 'de')
    callTool(projectId, ownerToken, 'update_settings', {
      spellCheckLanguage: 'xx',
    }).then(result => {
      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.contain('not a spell check language')
    })
    // an empty language turns spell check off, as in the editor
    callTool(projectId, ownerToken, 'update_settings', {
      spellCheckLanguage: '',
    }).then(result => expect(result.isError).not.to.equal(true))
    callTool(projectId, ownerToken, 'get_settings')
      .then(toolJson)
      .its('spellCheckLanguage')
      .should('equal', '')
  })
})

describe('Editing a project through MCP', function () {
  let projectId: string
  let token: string

  before(function () {
    login(owner)
    createProject(projectName('Mcp edit')).then(id => {
      projectId = id
    })
    createGitToken().then(created => {
      token = created
    })
  })

  function readFile(path: string) {
    return callTool(projectId, token, 'read_file', { path }).then(
      result => result.content[0].text
    )
  }

  it('writes, edits and deletes files', function () {
    callTool(projectId, token, 'write_file', {
      path: 'sections/intro.tex',
      content: 'Written through MCP\nSecond line',
    })
    callTool(projectId, token, 'list_files')
      .then(toolJson)
      .should('deep.include', { path: 'sections/intro.tex', type: 'doc' })
    readFile('sections/intro.tex').should(
      'equal',
      'Written through MCP\nSecond line'
    )

    callTool(projectId, token, 'edit_file', {
      path: 'sections/intro.tex',
      oldString: 'Second line',
      newString: 'Edited through MCP',
    }).then(result => {
      // the clone catches up with one pull after the edits
      expect(result.content[0].text).to.contain(`git pull in ./${projectId}/`)
    })
    readFile('sections/intro.tex').should(
      'equal',
      'Written through MCP\nEdited through MCP'
    )

    callTool(projectId, token, 'delete_file', { path: 'sections/intro.tex' })
    callTool(projectId, token, 'list_files')
      .then(toolJson)
      .then((files: { path: string }[]) => files.map(file => file.path))
      .should('not.include', 'sections/intro.tex')
  })

  it('brings the edits into a clone with one pull', function () {
    const dir = workingCopy('mcp-pull')
    callTool(projectId, token, 'write_file', {
      path: 'pulled.tex',
      content: 'Before',
    })
    gitClone(projectId, token, dir).its('exitCode').should('equal', 0)
    callTool(projectId, token, 'edit_file', {
      path: 'pulled.tex',
      oldString: 'Before',
      newString: 'After',
    })
    callTool(projectId, token, 'write_file', {
      path: 'new.tex',
      content: 'New',
    })
    git(
      `cd ${dir} && git pull -q && printf '%s|%s' "$(cat pulled.tex)" "$(cat new.tex)"`
    )
      .its('stdout')
      .should('equal', 'After|New')
  })

  it('refuses an edit whose text is missing or not unique', function () {
    callTool(projectId, token, 'write_file', {
      path: 'twice.tex',
      content: 'same\nsame',
    })
    callTool(projectId, token, 'edit_file', {
      path: 'twice.tex',
      oldString: 'gone',
      newString: 'x',
    }).then(result => {
      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.contain('read_file again')
    })
    callTool(projectId, token, 'edit_file', {
      path: 'twice.tex',
      oldString: 'same',
      newString: 'x',
    }).then(result => {
      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.contain('appears 2 times')
    })
    readFile('twice.tex').should('equal', 'same\nsame')
  })

  // The review panel reads the tracked changes and their authors from these
  // routes of the track-changes module
  it('makes an edit a tracked change of the user when asked', function () {
    login(owner)
    callTool(projectId, token, 'write_file', {
      path: 'tracked.tex',
      content: 'First line',
    })
    callTool(projectId, token, 'edit_file', {
      path: 'tracked.tex',
      oldString: 'First line',
      newString: 'First line\nNot tracked',
    })
    cy.request(`/project/${projectId}/ranges`)
      .then(response => JSON.stringify(response.body))
      .should('not.contain', 'Not tracked')

    callTool(projectId, token, 'edit_file', {
      path: 'tracked.tex',
      oldString: 'Not tracked',
      newString: 'Not tracked\nTracked edit',
      trackChanges: true,
    }).then(result => expect(result.isError).not.to.equal(true))
    callTool(projectId, token, 'write_file', {
      path: 'tracked.tex',
      content: 'First line\nNot tracked\nTracked edit\nTracked write',
      trackChanges: true,
    }).then(result => expect(result.isError).not.to.equal(true))
    readFile('tracked.tex').should(
      'equal',
      'First line\nNot tracked\nTracked edit\nTracked write'
    )
    waitForServer(`/project/${projectId}/ranges`, 'Tracked edit')
    waitForServer(`/project/${projectId}/ranges`, 'Tracked write')
    cy.request(`/project/${projectId}/changes/users`)
      .its('body')
      .then((users: { email: string }[]) => users.map(user => user.email))
      .should('deep.equal', [owner])
  })

  it('refuses a tracked change when track changes is off for the owner', function () {
    const member = `track-changes-off-${uuid()}@example.com`
    ensureUserExists(member)
    login(member)
    createProject(projectName('Mcp tracked off')).then(id => {
      createGitToken().then(memberToken => {
        login(ADMIN_EMAIL)
        setUserFeatures(member, { trackChanges: false })
        callTool(id, memberToken, 'edit_file', {
          path: 'main.tex',
          oldString: '\\section{Introduction}',
          newString: '\\section{Introduction}\nTracked edit',
          trackChanges: true,
        }).then(result => {
          expect(result.isError).to.equal(true)
          expect(result.content[0].text).to.contain('Track changes is off')
        })
        callTool(id, memberToken, 'read_file', { path: 'main.tex' })
          .its('content.0.text')
          .should('not.contain', 'Tracked edit')
      })
    })
  })

  it('keeps binary files binary', function () {
    login(owner)
    createProject(projectName('Mcp binary'), 'example').then(exampleId => {
      callTool(exampleId, token, 'write_file', {
        path: 'frog.jpg',
        content: 'not an image',
      }).then(result => {
        expect(result.isError).to.equal(true)
        expect(result.content[0].text).to.contain('is a binary file')
      })
      callTool(exampleId, token, 'list_files')
        .then(toolJson)
        .should('deep.include', { path: 'frog.jpg', type: 'file' })
    })
  })

  it('shows the edits live in the open editor', function () {
    login(owner)
    openProject(projectId)
    cy.findByRole('textbox', { name: 'Source Editor editing' }).should(
      'not.contain.text',
      'Live from MCP'
    )
    callTool(projectId, token, 'edit_file', {
      path: 'main.tex',
      oldString: '\\section{Introduction}',
      newString: '\\section{Introduction}\nLive from MCP',
    })
      .then(result => expect(result.isError).not.to.equal(true))
    cy.findByRole('textbox', { name: 'Source Editor editing' }).should(
      'contain.text',
      'Live from MCP'
    )
    // applied like a collaborator's edit, without the external update warning
    cy.findByRole('dialog').should('not.exist')
  })

  it('compiles the edits right away', function () {
    compile(projectId, token).then(build => {
      expect(build.status).to.equal('success')
      callTool(projectId, token, 'word_count', {
        clsiServerId: build.clsiServerId,
      })
        .then(toolJson)
        .its('textWords')
        .should('be.greaterThan', 2)
    })
  })

  it('changes the main document', function () {
    callTool(projectId, token, 'write_file', {
      path: 'other.tex',
      content: MAIN_TEX,
    })
    callTool(projectId, token, 'update_settings', { mainDocument: 'other.tex' })
      .then(result => expect(result.isError).not.to.equal(true))
    callTool(projectId, token, 'get_settings')
      .then(toolJson)
      .its('mainDocument')
      .should('equal', 'other.tex')
  })

  function filePaths() {
    return callTool(projectId, token, 'list_files')
      .then(toolJson)
      .then((files: { path: string }[]) => files.map(file => file.path))
  }

  it('moves, renames and creates folders', function () {
    callTool(projectId, token, 'write_file', {
      path: 'draft.tex',
      content: 'Moved through MCP',
    })
    callTool(projectId, token, 'move_file', {
      path: 'draft.tex',
      newPath: 'chapters/one.tex',
    }).then(result => {
      expect(result.isError, result.content[0].text).not.to.equal(true)
      expect(result.content[0].text).to.contain(`git pull in ./${projectId}/`)
    })
    filePaths().should(paths => {
      expect(paths).to.include('chapters/one.tex')
      expect(paths).not.to.include('draft.tex')
    })
    readFile('chapters/one.tex').should('equal', 'Moved through MCP')

    // a rename in place, then a folder with what is in it
    callTool(projectId, token, 'move_file', {
      path: 'chapters/one.tex',
      newPath: 'chapters/first.tex',
    })
    callTool(projectId, token, 'move_file', {
      path: 'chapters',
      newPath: 'parts/chapters',
    })
    readFile('parts/chapters/first.tex').should('equal', 'Moved through MCP')
    filePaths().should('not.include', 'chapters/first.tex')

    callTool(projectId, token, 'create_folder', { path: 'figures/plots' }).then(
      result => expect(result.isError, result.content[0].text).not.to.equal(true)
    )
    callTool(projectId, token, 'create_folder', { path: 'figures/plots' }).then(
      result => {
        expect(result.isError).to.equal(true)
        expect(result.content[0].text).to.contain('already exists')
      }
    )
    callTool(projectId, token, 'move_file', {
      path: 'parts/chapters/first.tex',
      newPath: 'figures/plots/first.tex',
    })
    readFile('figures/plots/first.tex').should('equal', 'Moved through MCP')
  })

  it('refuses a move from a missing path or onto an existing one', function () {
    callTool(projectId, token, 'write_file', { path: 'keep.tex', content: 'Kept' })
    callTool(projectId, token, 'move_file', {
      path: 'missing.tex',
      newPath: 'any.tex',
    }).then(result => {
      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.contain('missing.tex not found')
    })
    callTool(projectId, token, 'move_file', {
      path: 'keep.tex',
      newPath: 'main.tex',
    }).then(result => {
      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.contain('main.tex already exists')
    })
    readFile('keep.tex').should('equal', 'Kept')
    readFile('main.tex').should('not.equal', 'Kept')
  })

  it('shows a move live in the open file tree', function () {
    callTool(projectId, token, 'write_file', {
      path: 'live-move.tex',
      content: 'Moved while open',
    })
    // the main document is other.tex by now, which openProject does not wait for
    login(owner)
    cy.visit(`/project/${projectId}`)
    cy.findByRole('tab', { name: 'File tree' }).then(tab => {
      if (tab.attr('aria-selected') !== 'true') cy.wrap(tab).click()
    })
    cy.findByRole('treeitem', { name: 'live-move.tex' }).should('exist')
    callTool(projectId, token, 'move_file', {
      path: 'live-move.tex',
      newPath: 'live-moved.tex',
    })
    cy.findByRole('treeitem', { name: 'live-moved.tex' }).should('exist')
    cy.findByRole('treeitem', { name: 'live-move.tex' }).should('not.exist')
  })
})

type Comment = {
  threadId: string
  file: string | null
  text: string
  resolved: boolean
  resolvedBy?: string | null
  messages: { id: string; author: string | null; content: string }[]
}

describe('Comments through MCP', function () {
  let projectId: string
  let ownerToken: string
  let reviewerToken: string
  let linkViewerToken: string

  before(function () {
    login(owner)
    createProject(projectName('Mcp comments')).then(id => {
      projectId = id
      shareProject(projectId, reviewer, 'review')
      login(owner)
      shareProjectByLink(projectId, linkViewer, 'readOnly')
      login(owner)
      openProject(projectId)
      addComment(projectId, 'Introduction', 'Owner question')
    })
    createGitToken().then(token => {
      ownerToken = token
    })
    login(reviewer)
    createGitToken().then(token => {
      reviewerToken = token
    })
    login(linkViewer)
    createGitToken().then(token => {
      linkViewerToken = token
    })
  })

  function listComments(
    token: string,
    includeResolved = false
  ): Cypress.Chainable<Comment[]> {
    return callTool(projectId, token, 'list_comments', { includeResolved }).then(
      toolJson
    )
  }

  function ownerQuestion(comments: Comment[]) {
    return comments.find(
      comment => comment.messages[0].content === 'Owner question'
    )
  }

  it('lists the comments with the commented text and their authors', function () {
    listComments(ownerToken).then(comments => {
      const comment = ownerQuestion(comments)!
      expect(comment.file).to.equal('main.tex')
      expect(comment.text).to.contain('Introduction')
      expect(comment.resolved).to.equal(false)
      expect(comment.messages[0].author).to.contain(owner)
    })
  })

  it('replies, resolves and reopens live in the open editor', function () {
    login(owner)
    openProject(projectId)
    openReviewPanel()
    commentEntry('Owner question').should('be.visible')

    listComments(ownerToken).then(comments => {
      const { threadId } = ownerQuestion(comments)!

      // under the name of the token's user
      callTool(projectId, reviewerToken, 'reply_to_comment', {
        threadId,
        content: 'Reply through MCP',
      }).then(result => expect(result.isError).not.to.equal(true))
      commentEntry('Reply through MCP').should('be.visible')

      // a reviewer resolves only the threads they started
      callTool(projectId, reviewerToken, 'resolve_comment', { threadId }).then(
        result => {
          expect(result.isError).to.equal(true)
          expect(result.content[0].text).to.contain('cannot resolve')
        }
      )

      callTool(projectId, ownerToken, 'resolve_comment', { threadId })
      commentEntry('Owner question').should('not.exist')
      listComments(ownerToken).then(open => {
        expect(ownerQuestion(open)).to.equal(undefined)
      })
      listComments(ownerToken, true).then(all => {
        const comment = ownerQuestion(all)!
        expect(comment.resolved).to.equal(true)
        expect(comment.resolvedBy).to.contain(owner)
        expect(comment.messages[1].author).to.contain(reviewer)
      })

      callTool(projectId, ownerToken, 'reopen_comment', { threadId })
      commentEntry('Owner question').should('be.visible')
    })
  })

  it('keeps the comments from viewers who joined by link', function () {
    callTool(projectId, linkViewerToken, 'list_comments').then(result => {
      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.contain('cannot see the comments')
    })
  })

  it('keeps the history from viewers who joined by link', function () {
    callTool(projectId, linkViewerToken, 'list_versions').then(result => {
      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.contain('cannot see the history')
    })
  })

  it('refuses a comment that does not exist', function () {
    callTool(projectId, ownerToken, 'reply_to_comment', {
      threadId: '0'.repeat(24),
      content: 'Nobody reads this',
    }).then(result => {
      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.contain('list_comments again')
    })
  })

  // The range of a comment in its doc, as the review panel reads it, with the
  // owner's session
  function commentRange(threadId: string) {
    return cy.request(`/project/${projectId}/ranges`).then(response => {
      for (const doc of response.body as {
        ranges: { comments?: { op: { c: string; p: number; t: string } }[] }
      }[]) {
        const comment = doc.ranges.comments?.find(c => c.op.t === threadId)
        if (comment) return comment.op
      }
      return null
    })
  }

  function addCommentThrough(token: string, args: Record<string, string>) {
    return callTool(projectId, token, 'add_comment', args).then(result => {
      expect(result.isError, result.content[0].text).not.to.equal(true)
      return JSON.parse(result.content[0].text).threadId as string
    })
  }

  it('adds a comment live in the open editor, which stays connected', function () {
    login(owner)
    openProject(projectId)
    openReviewPanel()
    // reviewers comment, as in the review panel
    addCommentThrough(reviewerToken, {
      path: 'main.tex',
      text: '\\maketitle',
      content: 'Comment through MCP',
    }).then(threadId => {
      commentEntry('Comment through MCP').should('be.visible')
      commentRange(threadId).should('deep.include', { c: '\\maketitle' })
      listComments(ownerToken).then(comments => {
        const comment = comments.find(c => c.threadId === threadId)!
        expect(comment.file).to.equal('main.tex')
        expect(comment.text).to.equal('\\maketitle')
        expect(comment.messages[0].author).to.contain(reviewer)
      })
    })
    // the comment is an op of the doc: the editor applied it and its own
    // edits still reach the server, which it sends a moment after typing
    cy.get('.cm-content').type('{ctrl+end}\nTyped after the comment')
    waitForMainTex(ownerToken, 'Typed after the comment')
  })

  function waitForMainTex(token: string, text: string, attempt = 1) {
    callTool(projectId, token, 'read_file', { path: 'main.tex' }).then(
      result => {
        if (!result.content[0].text.includes(text) && attempt < 20) {
          cy.wait(500)
          waitForMainTex(token, text, attempt + 1)
        } else {
          expect(result.content[0].text).to.contain(text)
        }
      }
    )
  }

  it('comments the occurrence that context points at', function () {
    login(owner)
    callTool(projectId, ownerToken, 'write_file', {
      path: 'twice.tex',
      content: 'one word\ntwo word\n',
    })
    callTool(projectId, ownerToken, 'add_comment', {
      path: 'twice.tex',
      text: 'word',
      content: 'Which one?',
    }).then(result => {
      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.contain('appears 2 times')
    })
    addCommentThrough(ownerToken, {
      path: 'twice.tex',
      text: 'word',
      context: 'two word',
      content: 'The second one',
    }).then(threadId =>
      // 'one word\n' is 9 characters, then 'two '
      commentRange(threadId).should('deep.include', { c: 'word', p: 13 })
    )
    for (const [args, error] of [
      [{ text: 'word', context: 'two' }, 'must appear exactly once in context'],
      [{ text: 'word', context: 'three word' }, 'context not found'],
      [{ text: 'missing' }, 'text not found'],
    ] as const) {
      callTool(projectId, ownerToken, 'add_comment', {
        path: 'twice.tex',
        content: 'Nowhere',
        ...args,
      }).then(result => {
        expect(result.isError).to.equal(true)
        expect(result.content[0].text).to.contain(error)
      })
    }
  })

  it('keeps a new comment on its text as the file changes', function () {
    login(owner)
    callTool(projectId, ownerToken, 'write_file', {
      path: 'moving.tex',
      content: 'Commented text',
    })
    addCommentThrough(ownerToken, {
      path: 'moving.tex',
      text: 'Commented text',
      content: 'Follows its text',
    }).then(threadId => {
      commentRange(threadId).should('deep.include', { p: 0 })
      callTool(projectId, ownerToken, 'edit_file', {
        path: 'moving.tex',
        oldString: 'Commented text',
        newString: 'Inserted before. Commented text',
      })
      commentRange(threadId).should('deep.include', {
        c: 'Commented text',
        p: 'Inserted before. '.length,
      })
    })
  })

  it('keeps the new comments from viewers who joined by link', function () {
    callTool(projectId, linkViewerToken, 'add_comment', {
      path: 'main.tex',
      text: '\\maketitle',
      content: 'Not allowed',
    }).then(result => {
      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.contain('cannot comment')
    })
  })

  it('edits and deletes messages as the review panel', function () {
    login(owner)
    openProject(projectId)
    openReviewPanel()
    addCommentThrough(ownerToken, {
      path: 'main.tex',
      text: '\\begin{document}',
      content: 'Owner thread',
    }).then(threadId => {
      callTool(projectId, reviewerToken, 'reply_to_comment', {
        threadId,
        content: 'Reviewer reply',
      })
      callTool(projectId, ownerToken, 'reply_to_comment', {
        threadId,
        content: 'Owner reply',
      })
      listComments(ownerToken).then(comments => {
        const [first, reviewerReply, ownerReply] = comments.find(
          comment => comment.threadId === threadId
        )!.messages
        const call = (token: string, name: string, args: object) =>
          callTool(projectId, token, name, { threadId, ...args })
        const refused = (text: string) => (result: ToolResult) => {
          expect(result.isError).to.equal(true)
          expect(result.content[0].text).to.contain(text)
        }

        // everyone edits only their own messages
        call(ownerToken, 'edit_comment_message', {
          messageId: reviewerReply.id,
          content: 'Changed by the owner',
        }).then(refused('only edit your own'))
        call(reviewerToken, 'edit_comment_message', {
          messageId: reviewerReply.id,
          content: 'Edited reply',
        }).then(result => expect(result.isError).not.to.equal(true))
        commentEntry('Edited reply').should('be.visible')

        // reviewers delete only their own messages and comments
        call(reviewerToken, 'delete_comment_message', {
          messageId: ownerReply.id,
        }).then(refused('only delete your own'))
        call(reviewerToken, 'delete_comment_message', {
          messageId: first.id,
        }).then(refused('cannot delete this comment'))
        call(ownerToken, 'delete_comment_message', {
          messageId: reviewerReply.id,
        }).then(result => expect(result.isError).not.to.equal(true))
        commentEntry('Edited reply').should('not.exist')

        // the first message is the comment itself
        call(ownerToken, 'delete_comment_message', {
          messageId: first.id,
        }).then(result =>
          expect(result.content[0].text).to.contain('Deleted the comment')
        )
        commentEntry('Owner thread').should('not.exist')
        commentRange(threadId).should('equal', null)
      })
    })
  })
})

type TrackedChange = {
  id: string
  file: string | null
  type: 'insert' | 'delete'
  text: string
  author: string | null
}

// Tokens of the owner and of each kind of member, on a new project
function projectWithMembers(name: string) {
  const tokens = {} as Record<
    'owner' | 'reviewer' | 'viewer' | 'linkViewer',
    string
  >
  let projectId = ''
  login(owner)
  createProject(projectName(name)).then(id => {
    projectId = id
    shareProject(projectId, reviewer, 'review')
    login(owner)
    shareProject(projectId, viewer, 'readOnly')
    login(owner)
    shareProjectByLink(projectId, linkViewer, 'readOnly')
  })
  for (const [key, email] of [
    ['owner', owner],
    ['reviewer', reviewer],
    ['viewer', viewer],
    ['linkViewer', linkViewer],
  ] as const) {
    login(email)
    createGitToken().then(token => {
      tokens[key] = token
    })
  }
  return cy.then(() => ({ projectId, tokens }))
}

describe('Tracked changes through MCP', function () {
  let projectId: string
  let tokens: Record<string, string>

  before(function () {
    projectWithMembers('Mcp tracked').then(created => {
      ;({ projectId, tokens } = created)
    })
  })

  function listTrackedChanges(token: string): Cypress.Chainable<TrackedChange[]> {
    return callTool(projectId, token, 'list_tracked_changes').then(toolJson)
  }

  function changeEntry(text: string) {
    return reviewPanel().find(`.review-panel-entry-change:contains("${text}")`)
  }

  it('lists the tracked changes with their authors and accepts the ones asked for', function () {
    login(owner)
    openProject(projectId)
    openReviewPanel()
    callTool(projectId, tokens.owner, 'edit_file', {
      path: 'main.tex',
      oldString: '\\section{Introduction}',
      newString: '\\section{Introduction}\nTracked insert',
      trackChanges: true,
    })
    changeEntry('Tracked insert').should('be.visible')

    // members who can read the project see them, as the review panel
    listTrackedChanges(tokens.viewer).then(changes => {
      const change = changes.find(c => c.text.includes('Tracked insert'))!
      expect(change).to.include({ file: 'main.tex', type: 'insert' })
      expect(change.author).to.contain(owner)

      // reviewers do not accept, as in the review panel
      callTool(projectId, tokens.reviewer, 'accept_tracked_changes', {
        ids: [change.id],
      }).then(result => {
        expect(result.isError).to.equal(true)
        expect(result.content[0].text).to.contain('cannot accept')
      })
      callTool(projectId, tokens.owner, 'accept_tracked_changes', {
        ids: ['0'.repeat(24)],
      }).then(result => {
        expect(result.isError).to.equal(true)
        expect(result.content[0].text).to.contain('list_tracked_changes again')
      })
      callTool(projectId, tokens.owner, 'accept_tracked_changes', {
        ids: [change.id],
      }).then(result => expect(result.isError).not.to.equal(true))
      changeEntry('Tracked insert').should('not.exist')
      listTrackedChanges(tokens.owner)
        .then(left => left.map(c => c.id))
        .should('not.include', change.id)
      // an accepted insert stays in the text
      callTool(projectId, tokens.owner, 'read_file', { path: 'main.tex' })
        .its('content.0.text')
        .should('contain', 'Tracked insert')
    })
  })

  it('keeps the tracked changes from viewers who joined by link', function () {
    callTool(projectId, tokens.linkViewer, 'list_tracked_changes').then(
      result => {
        expect(result.isError).to.equal(true)
        expect(result.content[0].text).to.contain('cannot see the tracked changes')
      }
    )
  })
})

type HistoryChange = {
  fromVersion: number
  toVersion: number
  authors: (string | null)[]
  files: string[]
}

describe('History through MCP', function () {
  let projectId: string
  let tokens: Record<string, string>

  before(function () {
    projectWithMembers('Mcp history').then(created => {
      ;({ projectId, tokens } = created)
    })
  })

  function saveVersion(token: string, comment: string) {
    return callTool(projectId, token, 'create_version', { comment })
      .then(toolJson)
      .then((label: { version: number }) => label.version)
  }

  function listChanges(token: string) {
    return callTool(projectId, token, 'list_changes').then(toolJson) as Cypress.Chainable<{
      changes: HistoryChange[]
      before: number | null
      note?: string
    }>
  }

  it('lists the changes, compares versions and reads a file as it was', function () {
    callTool(projectId, tokens.owner, 'write_file', {
      path: 'history.tex',
      content: 'First version\nUnchanged line',
    })
    saveVersion(tokens.owner, 'Written').then(written => {
      callTool(projectId, tokens.owner, 'edit_file', {
        path: 'history.tex',
        oldString: 'First version',
        newString: 'Second version',
      })
      saveVersion(tokens.owner, 'Edited').then(edited => {
        callTool(projectId, tokens.viewer, 'diff', {
          fromVersion: written,
          toVersion: edited,
          path: 'history.tex',
        })
          .its('content.0.text')
          .should('contain', '-First version\n+Second version\n Unchanged line')
        callTool(projectId, tokens.viewer, 'diff', {
          fromVersion: written,
          toVersion: edited,
        })
          .then(toolJson)
          .should('deep.equal', [{ path: 'history.tex', change: 'edited' }])
        callTool(projectId, tokens.viewer, 'read_file', {
          path: 'history.tex',
          version: written,
        })
          .its('content.0.text')
          .should('equal', 'First version\nUnchanged line')
        listChanges(tokens.viewer).then(({ changes, before }) => {
          expect(before).to.equal(null)
          const change = changes.find(
            c => c.toVersion >= edited && c.files.includes('history.tex')
          )!
          expect(change.authors[0]).to.contain(owner)
        })
        callTool(projectId, tokens.viewer, 'diff', {
          fromVersion: written,
          toVersion: edited + 1000,
        }).then(result => {
          expect(result.isError).to.equal(true)
          expect(result.content[0].text).to.contain('not found')
        })
      })
    })
  })

  it('saves and deletes versions as the history panel', function () {
    saveVersion(tokens.owner, 'Owner version')
    // reviewers save versions, as in the history panel
    saveVersion(tokens.reviewer, 'Reviewer version')
    callTool(projectId, tokens.viewer, 'create_version', {
      comment: 'Viewer version',
    }).then(result => {
      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.contain('cannot save versions')
    })
    callTool(projectId, tokens.viewer, 'list_versions')
      .then(toolJson)
      .then((versions: { id: string; comment: string; savedBy: string }[]) => {
        const ownerVersion = versions.find(v => v.comment === 'Owner version')!
        const reviewerVersion = versions.find(
          v => v.comment === 'Reviewer version'
        )!
        expect(ownerVersion.savedBy).to.contain(owner)
        expect(reviewerVersion.savedBy).to.contain(reviewer)

        // only the owner deletes the versions others saved
        callTool(projectId, tokens.reviewer, 'delete_version', {
          id: ownerVersion.id,
        }).then(result => {
          expect(result.isError).to.equal(true)
          expect(result.content[0].text).to.contain('only delete the versions you saved')
        })
        callTool(projectId, tokens.owner, 'delete_version', {
          id: reviewerVersion.id,
        }).then(result => expect(result.isError).not.to.equal(true))
      })
    saveVersion(tokens.reviewer, 'Reviewer own version')
    callTool(projectId, tokens.reviewer, 'list_versions')
      .then(toolJson)
      .then((versions: { id: string; comment: string }[]) => {
        const own = versions.find(v => v.comment === 'Reviewer own version')!
        callTool(projectId, tokens.reviewer, 'delete_version', { id: own.id })
          .then(result => expect(result.isError).not.to.equal(true))
      })
    callTool(projectId, tokens.owner, 'list_versions')
      .then(toolJson)
      .then((versions: { comment: string }[]) => versions.map(v => v.comment))
      .should(comments => {
        expect(comments).to.include('Owner version')
        expect(comments).not.to.include('Reviewer version')
        expect(comments).not.to.include('Reviewer own version')
      })
  })

  it('restores a file and the whole project', function () {
    callTool(projectId, tokens.owner, 'write_file', {
      path: 'restore.tex',
      content: 'Before',
    })
    saveVersion(tokens.owner, 'Before restore').then(before => {
      callTool(projectId, tokens.owner, 'edit_file', {
        path: 'restore.tex',
        oldString: 'Before',
        newString: 'After',
      })
      callTool(projectId, tokens.owner, 'write_file', {
        path: 'added-later.tex',
        content: 'Added later',
      })
      // reviewers and viewers do not restore, as in the history panel
      for (const token of [tokens.reviewer, tokens.viewer]) {
        callTool(projectId, token, 'restore_file', {
          path: 'restore.tex',
          version: before,
        }).then(result => {
          expect(result.isError).to.equal(true)
          expect(result.content[0].text).to.contain('cannot edit')
        })
      }
      callTool(projectId, tokens.owner, 'restore_file', {
        path: 'restore.tex',
        version: before,
      }).then(result => {
        expect(result.isError, result.content[0].text).not.to.equal(true)
        expect(result.content[0].text).to.contain(`git pull in ./${projectId}/`)
      })
      callTool(projectId, tokens.owner, 'read_file', { path: 'restore.tex' })
        .its('content.0.text')
        .should('equal', 'Before')

      callTool(projectId, tokens.owner, 'restore_project', {
        version: before,
      }).then(result => expect(result.isError).not.to.equal(true))
      callTool(projectId, tokens.owner, 'list_files')
        .then(toolJson)
        .then((files: { path: string }[]) => files.map(file => file.path))
        .should(paths => {
          expect(paths).to.include('restore.tex')
          expect(paths).not.to.include('added-later.tex')
        })
      // a restore is a change of its own, which can be restored again
      listChanges(tokens.owner)
        .its('changes.0.toVersion')
        .should('be.greaterThan', before)
    })
  })

  it('keeps the history from viewers who joined by link', function () {
    for (const [name, args] of [
      ['list_changes', {}],
      ['diff', { fromVersion: 0, toVersion: 1 }],
      ['read_file', { path: 'main.tex', version: 0 }],
    ] as const) {
      callTool(projectId, tokens.linkViewer, name, args).then(result => {
        expect(result.isError).to.equal(true)
        expect(result.content[0].text).to.contain('cannot see the history')
      })
    }
  })

  it('shows the changes of the last day to owners without full project history', function () {
    const member = `history-off-${uuid()}@example.com`
    ensureUserExists(member)
    login(member)
    createProject(projectName('Mcp history off')).then(id => {
      createGitToken().then(token => {
        callTool(id, token, 'write_file', { path: 'today.tex', content: 'Today' })
        login(ADMIN_EMAIL)
        setUserFeatures(member, { versioning: false })
        callTool(id, token, 'list_changes')
          .then(toolJson)
          .should(({ changes, note }) => {
            // all of them are recent, so none is hidden
            expect(note).to.equal(undefined)
            expect(
              changes.flatMap(
                (c: { fileOperations: object[] }) => c.fileOperations
              )
            ).to.deep.include({ added: 'today.tex' })
          })
      })
    })
  })
})

describe('Project chat through MCP', function () {
  let projectId: string
  let tokens: Record<string, string>

  before(function () {
    projectWithMembers('Mcp chat').then(created => {
      ;({ projectId, tokens } = created)
    })
  })

  type ChatMessages = {
    messages: { author: string | null; content: string }[]
    before: number | null
  }

  function listChat(before?: number): Cypress.Chainable<ChatMessages> {
    return callTool(projectId, tokens.owner, 'list_chat_messages', {
      ...(before != null && { before }),
    }).then(toolJson)
  }

  it('sends messages live to the open chat and reads them back', function () {
    login(owner)
    openProject(projectId)
    cy.findByRole('tab', { name: 'Chat' }).then(tab => {
      if (tab.attr('aria-selected') !== 'true') cy.wrap(tab).click()
    })
    // invited viewers chat, as in the editor
    callTool(projectId, tokens.viewer, 'send_chat_message', {
      content: 'Hello from MCP',
    }).then(result => expect(result.isError).not.to.equal(true))
    cy.contains('.message-content', 'Hello from MCP').should('be.visible')
    listChat().then(({ messages }) => {
      expect(messages[0].content).to.equal('Hello from MCP')
      expect(messages[0].author).to.contain(viewer)
    })
  })

  it('reads the chat 50 messages at a time, newest first', function () {
    for (let i = 1; i <= 50; i++) {
      callTool(projectId, tokens.owner, 'send_chat_message', {
        content: `Message ${i}`,
      })
    }
    listChat().then(({ messages, before }) => {
      expect(messages).to.have.length(50)
      expect(messages[0].content).to.equal('Message 50')
      expect(messages[49].content).to.equal('Message 1')
      expect(before).to.be.a('number')
      listChat(before!).then(older => {
        expect(older.messages.map(m => m.content)).to.deep.equal([
          'Hello from MCP',
        ])
        expect(older.before).to.equal(null)
      })
    })
  })

  it('keeps the chat from viewers who joined by link', function () {
    for (const [name, args] of [
      ['list_chat_messages', {}],
      ['send_chat_message', { content: 'Not allowed' }],
    ] as const) {
      callTool(projectId, tokens.linkViewer, name, args).then(result => {
        expect(result.isError).to.equal(true)
        expect(result.content[0].text).to.contain('cannot use the chat')
      })
    }
  })
})

describe('MCP server card in the editor', function () {
  it('shows how to connect AI clients to the project', function () {
    login(owner)
    createProject(projectName('Mcp card')).then(projectId => {
      openProject(projectId)
      cy.findByRole('tab', { name: 'Integrations' }).click()
      cy.findByText('Connect AI clients to this project.').click()
      cy.findByRole('dialog').within(() => {
        // translated texts, not their keys
        cy.findByText('MCP server').should('be.visible')
        cy.findByText(
          'Connect an AI client with a Git authentication token.'
        ).should('be.visible')
        const url = `http://sharelatex/project/${projectId}/mcp`
        cy.contains('code', url)
        cy.contains('code', `claude mcp add --transport http overleaf`)
        for (const [tab, config] of [
          ['Codex', 'bearer_token_env_var = "OVERLEAF_TOKEN"'],
          ['Cursor', '"Bearer ${env:OVERLEAF_TOKEN}"'],
          ['VS Code', '"Bearer ${input:overleaf-token}"'],
          ['Gemini CLI', 'gemini mcp add --transport http'],
        ]) {
          cy.findByRole('tab', { name: tab }).click()
          cy.contains('code', config).should('be.visible')
        }
      })
    })
  })
})

describe('MCP access by role', function () {
  // read: compile and its output; write: files and project settings
  const roles = [
    { role: 'an invited editor', share: 'readAndWrite', link: false, write: true },
    { role: 'an editor through the link', share: 'readAndWrite', link: true, write: true },
    { role: 'a reviewer', share: 'review', link: false, write: false },
    { role: 'an invited viewer', share: 'readOnly', link: false, write: false },
    { role: 'a viewer through the link', share: 'readOnly', link: true, write: false },
  ] as const

  for (const { role, share, link, write } of roles) {
    it(`lets ${role} ${write ? 'read and write' : 'only read'}`, function () {
      const member = `member-${uuid()}@example.com`
      ensureUserExists(member)
      let projectId: string
      login(owner)
      createProject(projectName('Mcp role')).then(id => {
        projectId = id
      })
      cy.then(() =>
        link
          ? shareProjectByLink(projectId, member, share as 'readOnly' | 'readAndWrite')
          : shareProject(projectId, member, share)
      )
      login(member)
      createGitToken().then(token => {
        compile(projectId, token).then(build => {
          expect(build.status).to.equal('success')
          outputFileLink(projectId, token, build).then(link =>
            download(link).its('status').should('equal', 200)
          )
        })
        callTool(projectId, token, 'write_file', {
          path: 'by-member.tex',
          content: 'Written by a member',
        }).then(result =>
          expect(result.isError === true, result.content[0].text).to.equal(
            !write
          )
        )
        callTool(projectId, token, 'update_settings', {
          compiler: 'lualatex',
        }).then(result =>
          expect(result.isError === true, result.content[0].text).to.equal(
            !write
          )
        )
      })
    })
  }
})

describe('MCP access after losing access to the project', function () {
  it('refuses the MCP server and the download links', function () {
    const member = `member-${uuid()}@example.com`
    ensureUserExists(member)
    let projectId: string
    login(owner)
    createProject(projectName('Mcp revoked')).then(id => {
      projectId = id
    })
    cy.then(() => shareProject(projectId, member, 'readOnly'))
    login(member)
    createGitToken().then(token => {
      compile(projectId, token).then(build => {
        outputFileLink(projectId, token, build).then(link => {
          download(link).its('status').should('equal', 200)

          login(owner)
          cy.request(`/project/${projectId}/members`)
            .its('body.members')
            .then((members: { _id: string; email: string }[]) => {
              const { _id } = members.find(m => m.email === member)!
              cy.visit(`/project/${projectId}`)
              requestWithCsrf('DELETE', `/project/${projectId}/users/${_id}`)
                .its('status')
                .should('be.lessThan', 400)
            })

          download(link).its('status').should('equal', 404)
          mcp(projectId, token, 'tools/list').its('status').should('equal', 403)
        })
      })
    })
  })
})

describe('MCP access of a disabled account', function () {
  it('refuses the MCP server and the download links until enabled again', function () {
    const member = `disabled-${uuid()}@example.com`
    ensureUserExists(member)
    let projectId: string
    login(member)
    createProject(projectName('Mcp disabled')).then(id => {
      projectId = id
    })
    createGitToken().then(token => {
      compile(projectId, token).then(build => {
        outputFileLink(projectId, token, build).then(link => {
          download(link).its('status').should('equal', 200)

          login(ADMIN_EMAIL)
          setSuspended(member, true)
          mcp(projectId, token, 'tools/list').its('status').should('equal', 401)
          download(link).its('status').should('equal', 404)

          login(ADMIN_EMAIL)
          setSuspended(member, false)
          mcp(projectId, token, 'tools/list').its('status').should('equal', 200)
          download(link).its('status').should('equal', 200)
        })
      })
    })
  })
})

describe('MCP access with git access turned off', function () {
  it('refuses the MCP server and the download links, and hides it, until it is on again', function () {
    const member = `git-off-${uuid()}@example.com`
    ensureUserExists(member)
    let projectId: string
    login(member)
    createProject(projectName('Mcp off')).then(id => {
      projectId = id
    })
    createGitToken().then(token => {
      compile(projectId, token).then(build => {
        outputFileLink(projectId, token, build).then(link => {
          download(link).its('status').should('equal', 200)

          login(ADMIN_EMAIL)
          setUserFeatures(member, { gitBridge: false })
          mcp(projectId, token, 'tools/list').its('status').should('equal', 403)
          // A client that accepts anything gets the same answer, not a 500
          cy.request({
            method: 'POST',
            url: `/project/${projectId}/mcp`,
            headers: { Accept: '*/*', Authorization: `Bearer ${token}` },
            body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
            failOnStatusCode: false,
          })
            .its('status')
            .should('equal', 403)
          download(link).its('status').should('equal', 404)

          login(member)
          cy.intercept('GET', '/system/features').as('features')
          openProject(projectId)
          cy.wait('@features')
          cy.findByRole('tab', { name: 'Integrations' }).click()
          cy.findByText('MCP server').should('not.exist')

          login(ADMIN_EMAIL)
          setUserFeatures(member, { gitBridge: true })
          mcp(projectId, token, 'tools/list').its('status').should('equal', 200)
          download(link).its('status').should('equal', 200)
        })
      })
    })
  })
})
