import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { expect } from 'chai'
import { extension } from '../../frontend/js/extension'
import { formatDocument } from '../../frontend/js/format-document'

function makeState(docName: string, content: string) {
  return EditorState.create({
    doc: content,
    extensions: extension({ docName }),
  })
}

function makeView(docName: string, content: string): EditorView {
  return new EditorView({ state: makeState(docName, content) })
}

// The source editor reuses one EditorView for all documents and replaces its
// state on a document switch, so use the same mechanism to simulate one here.
function switchDocument(
  view: EditorView,
  docName: string,
  content: string
) {
  view.setState(makeState(docName, content))
}

// A formatter whose promise can be resolved manually, so the load can be
// kept pending while the editor state is manipulated
function deferredFormatter() {
  let resolve!: (formatter: (text: string) => string) => void
  const promise = new Promise<(text: string) => string>(r => {
    resolve = r
  })
  return { promise, resolve }
}

const flush = () => new Promise(resolve => setTimeout(resolve))

describe('formatDocument', function () {
  it('formats the document once the formatter has loaded', async function () {
    const view = makeView('main.tex', 'a\nb')

    expect(
      formatDocument(view, async () => text => text.replace('a', 'c'))
    ).to.equal(true)
    await flush()

    expect(view.state.doc.toString()).to.equal('c\nb')
  })

  it('does not format a document opened while the formatter was loading', async function () {
    const view = makeView('first.tex', 'a\nb')
    const pending = deferredFormatter()

    expect(formatDocument(view, () => pending.promise)).to.equal(true)
    switchDocument(view, 'second.tex', 'x\ny')
    pending.resolve(() => 'WRONG-DOCUMENT')
    await flush()

    // second.tex must have been left untouched
    expect(view.state.doc.toString()).to.equal('x\ny')
  })

  it('does not format a different kind of document opened while loading', async function () {
    const view = makeView('refs.bib', '@article{a}')
    const pending = deferredFormatter()

    expect(formatDocument(view, () => pending.promise)).to.equal(true)
    switchDocument(view, 'main.tex', 'x\ny')
    pending.resolve(() => 'WRONG-DOCUMENT')
    await flush()

    expect(view.state.doc.toString()).to.equal('x\ny')
  })

  it('does not format a document that turned read-only while loading', async function () {
    const view = makeView('main.tex', 'a\nb')
    const pending = deferredFormatter()

    expect(formatDocument(view, () => pending.promise)).to.equal(true)
    view.setState(
      EditorState.create({
        doc: 'a\nb',
        extensions: [
          extension({ docName: 'main.tex' }),
          EditorState.readOnly.of(true),
        ],
      })
    )
    pending.resolve(() => 'WRONG-DOCUMENT')
    await flush()

    expect(view.state.doc.toString()).to.equal('a\nb')
  })

  it('still formats edits made to the same document while loading', async function () {
    const view = makeView('main.tex', 'a\nb')
    const pending = deferredFormatter()

    expect(formatDocument(view, () => pending.promise)).to.equal(true)
    view.dispatch({ changes: [{ from: 3, to: 3, insert: '+z' }] })
    pending.resolve(text => text.replace('b', 'c'))
    await flush()

    // the edited document is formatted as a whole
    expect(view.state.doc.toString()).to.equal('a\nc+z')
  })

  it('does nothing for a read-only document', function () {
    const view = new EditorView({
      state: EditorState.create({
        doc: 'a',
        extensions: [
          extension({ docName: 'main.tex' }),
          EditorState.readOnly.of(true),
        ],
      }),
    })

    expect(formatDocument(view)).to.equal(false)
  })

  it('does nothing for a document the module does not format', function () {
    const view = makeView('notes.md', 'hello')

    expect(formatDocument(view)).to.equal(false)
  })
})
