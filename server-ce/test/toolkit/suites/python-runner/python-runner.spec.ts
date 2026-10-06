import { login } from '../../../helpers/login'
import { dataUrl, openInOverleaf } from '../../../helpers/openInOverleaf'
import { openProject } from '../../../helpers/project'
import { postWithCsrf } from '../../../helpers/request'
import { shareProject } from '../../../helpers/sharing'
import {
  ADMIN_EMAIL,
  ensureAdminExists,
  ensureUserExists,
} from '../../../helpers/users'

// The Python runner runs .py files in the browser with the self-hosted
// Pyodide. Files the script writes are uploaded into the project.

const viewer = `python-viewer-${Date.now()}@example.com`

const main = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\section{Introduction}',
  '\\end{document}',
].join('\n')

// Creates a project with main.tex and the given files and opens it
function openProjectWith(files: Record<string, string>) {
  return openInOverleaf({
    snip_uri: [main, ...Object.values(files)].map(content =>
      dataUrl('text/plain', content)
    ),
    snip_name: ['main.tex', ...Object.keys(files)],
    main_document: 'main.tex',
  }).then(projectId => {
    openProject(projectId)
    return cy.wrap(projectId)
  })
}

function outputPane() {
  return cy.get('.ide-redesign-python-output-pane')
}

function outputLines(stream: 'stdout' | 'stderr' | 'info') {
  return outputPane().find(`.ide-redesign-python-output-pane-line-${stream}`)
}

function runButton() {
  return cy.findByRole('button', { name: 'Run Python code' })
}

// Opens the script and waits until the runtime is ready
function openScript(name: string) {
  cy.findByRole('treeitem', { name }).click()
  outputPane().should('contain.text', 'Run the current script to see output.')
  // Pyodide is large; the first load can take a while
  runButton().should('be.enabled', { timeout: 60_000 })
}

function run() {
  runButton().click()
}

// Waits for the run to end: the button turns back from Stop to Run
function waitForRun() {
  runButton().should('be.enabled', { timeout: 60_000 })
}

// The runner syncs the project into Pyodide from the project history, which
// takes in a new file a moment after its upload. Waits for it the way the
// runner's snapshot looks for it: flush, then read the latest history.
function waitForHistoryFile(projectId: string, path: string, attempts = 20) {
  postWithCsrf(`/project/${projectId}/flush`, {})
  cy.request(`/project/${projectId}/latest/history`).then(({ body }) => {
    if (JSON.stringify(body).includes(path)) return
    expect(attempts, `${path} in the history`).to.be.greaterThan(0)
    cy.wait(250)
    waitForHistoryFile(projectId, path, attempts - 1)
  })
}

before(function () {
  ensureAdminExists()
  ensureUserExists(viewer)
})

beforeEach(function () {
  login(ADMIN_EMAIL)
})

describe('running Python', function () {
  it('shows the runner only for Python files', function () {
    openProjectWith({ 'script.py': 'print(1)' })
    cy.get('.cm-content').should('contain.text', 'Introduction')
    outputPane().should('not.exist')
    openScript('script.py')
    cy.findByText('Loading Python runtime...').should('not.exist')
  })

  it('runs a script and shows what it prints and its last value', function () {
    openProjectWith({
      'hello.py': [
        'print("hello from python")',
        'print(2 ** 10)',
        '6 * 7',
      ].join('\n'),
    })
    openScript('hello.py')
    run()
    waitForRun()
    outputLines('stdout')
      .then(lines => [...lines].map(l => l.textContent))
      .should('deep.equal', ['hello from python', '1024', '42'])
  })

  it('shows stderr and the error a script raises', function () {
    openProjectWith({
      'fails.py': [
        'import sys',
        'print("before the error")',
        'print("a warning", file=sys.stderr)',
        'raise ValueError("boom")',
      ].join('\n'),
    })
    openScript('fails.py')
    run()
    waitForRun()
    outputLines('stdout').should('contain.text', 'before the error')
    outputLines('stderr')
      .should('contain.text', 'a warning')
      .and('contain.text', 'ValueError: boom')
  })

  it('reports syntax errors', function () {
    openProjectWith({ 'broken.py': 'def broken(:\n    pass' })
    openScript('broken.py')
    run()
    waitForRun()
    outputLines('stderr').should('contain.text', 'SyntaxError')
  })

  it('explains that only the built-in packages are available', function () {
    openProjectWith({ 'missing.py': 'import e2e_not_a_real_package' })
    openScript('missing.py')
    run()
    waitForRun()
    outputLines('stderr')
      .should('contain.text', 'ModuleNotFoundError')
      .and(
        'contain.text',
        "Only Pyodide's built-in packages are available in the browser."
      )
  })

  it('loads built-in packages from the instance', function () {
    // Not numbers.py: the project folder comes first on the import path, so
    // that name would shadow the standard library module numpy imports
    openProjectWith({
      'sums.py': ['import numpy', 'print(int(numpy.arange(5).sum()))'].join(
        '\n'
      ),
    })
    cy.intercept('GET', '/js/libs/pyodide/**/numpy-*.whl').as('numpy')
    openScript('sums.py')
    run()
    cy.wait('@numpy', { timeout: 60_000 })
      .its('response.statusCode')
      .should('equal', 200)
    waitForRun()
    outputLines('stdout').should('contain.text', '10')
  })

  it('reads the other files of the project', function () {
    openProjectWith({
      'data.txt': 'a line from the project',
      'reader.py': 'print(open("data.txt").read())',
    })
    openScript('reader.py')
    run()
    waitForRun()
    outputLines('stdout').should('contain.text', 'a line from the project')
  })

  it('runs the code as it is in the editor, unsaved edits included', function () {
    openProjectWith({ 'edited.py': 'print("before the edit")' })
    openScript('edited.py')
    cy.get('.cm-content').type('{ctrl+end}\nprint("after the edit")')
    run()
    waitForRun()
    outputLines('stdout')
      .then(lines => [...lines].map(l => l.textContent))
      .should('deep.equal', ['before the edit', 'after the edit'])
  })

  it('keeps the last 100 lines of output', function () {
    openProjectWith({
      'chatty.py': 'for i in range(1, 151):\n    print(f"line {i}")',
    })
    openScript('chatty.py')
    run()
    waitForRun()
    outputLines('stdout').should('have.length', 100)
    outputLines('stdout').first().should('have.text', 'line 51')
    outputLines('stdout').last().should('have.text', 'line 150')
  })

  it('stops a running script and runs again', function () {
    openProjectWith({
      'forever.py': 'print("started")\nwhile True:\n    pass',
    })
    openScript('forever.py')
    run()
    outputLines('stdout').should('contain.text', 'started')
    cy.findByRole('button', { name: 'Stop Python execution' }).click()
    outputLines('info').should('contain.text', 'Execution interrupted')
    // The runtime is reloaded, then the script can run again
    waitForRun()
    run()
    outputLines('stdout').should('contain.text', 'started')
    cy.findByRole('button', { name: 'Stop Python execution' }).click()
  })

  it('keeps a separate output for each script', function () {
    openProjectWith({
      'first.py': 'print("output of first")',
      'second.py': 'print("output of second")',
    })
    openScript('first.py')
    run()
    waitForRun()
    outputLines('stdout').should('contain.text', 'output of first')
    openScript('second.py')
    outputLines('stdout').should('not.exist')
    cy.findByRole('treeitem', { name: 'first.py' }).click()
    outputLines('stdout').should('contain.text', 'output of first')
  })
})

describe('files written by a script', function () {
  it('saves a written file to the project', function () {
    openProjectWith({
      'writer.py': 'open("result.txt", "w").write("computed in python")',
    })
    openScript('writer.py')
    run()
    waitForRun()
    cy.findByText('result.txt saved to your project').should('exist')
    cy.findByRole('treeitem', { name: 'result.txt' }).click()
    cy.get('.cm-content').should('contain.text', 'computed in python')
  })

  it('saves several files and binary output', function () {
    openProjectWith({
      'plot.py': [
        'import matplotlib.pyplot as plt',
        'plt.plot([1, 2, 3], [1, 4, 9])',
        'plt.savefig("plot.png")',
        'open("notes.txt", "w").write("plotted")',
      ].join('\n'),
    })
    openScript('plot.py')
    run()
    waitForRun()
    cy.findByText('2 files saved to your project').should('exist')
    cy.findByRole('treeitem', { name: 'notes.txt' }).should('exist')
    cy.findByRole('treeitem', { name: 'plot.png' }).click()
    cy.get('.file-view img')
      .should('be.visible')
      .and($img => {
        expect(($img[0] as HTMLImageElement).naturalWidth).to.be.greaterThan(0)
      })
  })

  it('overwrites a project file the script writes again', function () {
    openProjectWith({
      'counter.py': [
        'import os',
        'n = int(open("count.txt").read()) if os.path.exists("count.txt") else 0',
        'print(f"read {n}")',
        'open("count.txt", "w").write(str(n + 1))',
      ].join('\n'),
    }).then(projectId => {
      openScript('counter.py')
      run()
      waitForRun()
      cy.findByRole('treeitem', { name: 'count.txt' }).click()
      cy.get('.cm-content').should('have.text', '1')
      waitForHistoryFile(projectId, 'count.txt')
      cy.findByRole('treeitem', { name: 'counter.py' }).click()
      run()
      waitForRun()
      outputLines('stdout').should('contain.text', 'read 1')
      cy.findAllByRole('treeitem', { name: 'count.txt' }).should(
        'have.length',
        1
      )
      cy.findByRole('treeitem', { name: 'count.txt' }).click()
      cy.get('.cm-content').should('have.text', '2')
    })
  })

  it('refuses to save more than 50 files', function () {
    openProjectWith({
      'many.py': 'for i in range(51):\n    open(f"out{i}.txt", "w").write("x")',
    })
    openScript('many.py')
    run()
    waitForRun()
    outputLines('info').should(
      'contain.text',
      'Output limit exceeded: 51 files generated (max 50)'
    )
    cy.findByRole('treeitem', { name: 'out0.txt' }).should('not.exist')
  })

  it('lets a viewer run a script but not save files', function () {
    openProjectWith({
      'shared.py':
        'print("run by a viewer")\nopen("viewer.txt", "w").write("x")',
    }).then(projectId => {
      shareProject(projectId, viewer, 'readOnly')
      openProject(projectId)
      openScript('shared.py')
      run()
      waitForRun()
      outputLines('stdout').should('contain.text', 'run by a viewer')
      outputLines('stderr').should('contain.text', 'Failed to upload output')
      cy.findByRole('treeitem', { name: 'viewer.txt' }).should('not.exist')
    })
  })
})
