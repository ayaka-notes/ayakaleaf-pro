import { v4 as uuid } from 'uuid'
import { setSuspended } from '../../../helpers/adminTools'
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

// Overleaf refuses a compile within a second of the previous one
function compile(projectId: string, token: string): Cypress.Chainable<Compile> {
  return callTool(projectId, token, 'compile')
    .then(toolJson)
    .then((build: Compile) => {
      if (build.status !== 'too-recently-compiled') return build
      cy.wait(1000)
      return compile(projectId, token)
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
        'compile',
        'delete_file',
        'edit_file',
        'get_clone_info',
        'get_compile_log',
        'get_output_file_link',
        'get_settings',
        'list_comments',
        'list_files',
        'list_versions',
        'read_file',
        'reopen_comment',
        'reply_to_comment',
        'resolve_comment',
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
})

type Comment = {
  threadId: string
  file: string | null
  text: string
  resolved: boolean
  resolvedBy?: string | null
  messages: { author: string | null; content: string }[]
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
