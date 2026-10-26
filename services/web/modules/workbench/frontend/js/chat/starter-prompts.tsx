/**
 * Ideas for a first message: a few general ones, or ones about the selected
 * text, plus fixing the compile errors when the last compile has any.
 */
import { useMemo } from 'react'
import { sampleSize } from 'lodash'
import { useDetachCompileContext } from '@/shared/context/detach-compile-context'
import MaterialIcon from '@/shared/components/material-icon'
import { boxed, muted, plain, ruleAbove } from './themed'

type Idea = { label: string; message: string }

const ABOUT_THE_PROJECT: Idea[] = [
  { label: 'Add a table', message: 'Help me add a table. Ask me for its columns and rows, then propose the LaTeX.' },
  { label: 'Start a Beamer talk', message: 'Set up a short Beamer presentation in a new file and tell me how to fill it in.' },
  { label: 'Typeset an equation', message: 'I want to typeset an equation. Ask me for it, in words or as a picture.' },
  { label: 'Draw with TikZ', message: 'Help me draw a figure with TikZ. Ask me what it should show.' },
  { label: 'Set up references', message: 'Set up a bibliography for this project: a .bib file and an example citation.' },
  { label: 'Include an image', message: 'Help me include an image as a figure with a caption and a label.' },
  { label: 'Outline the document', message: 'Give me an outline of this document, section by section.' },
]

const ABOUT_THE_SELECTION: Idea[] = [
  { label: 'Explain this', message: 'Explain what the selected text says.' },
  { label: 'What do these commands do?', message: 'Explain the LaTeX commands used in the selection.' },
  { label: 'Fix errors here', message: 'Find and fix LaTeX errors in the selection.' },
  { label: 'Make it shorter', message: 'Make the selection shorter without losing what it says.' },
  { label: 'Improve the wording', message: 'Improve the wording of the selection.' },
  { label: 'Make it more formal', message: 'Rewrite the selection in a more formal, academic tone.' },
  { label: 'Change the formatting', message: 'I want to change how the selection is formatted. Ask me how.' },
  { label: 'Make it a list', message: 'Turn the selection into a bulleted list.' },
]

function IdeaButton({
  idea,
  onPick,
  disabled,
  first,
}: {
  idea: Idea
  onPick: (text: string) => void
  disabled: boolean
  first: boolean
}) {
  return (
    <button
      type="button"
      className="btn btn-link text-start text-decoration-none rounded-0 d-flex align-items-center gap-2 px-3 py-2"
      // One block: a line between the ideas, no gaps
      style={{
        border: 'none',
        ...(first ? {} : ruleAbove),
        ...(disabled ? { color: 'var(--content-disabled-themed)', opacity: 1 } : plain),
        fontSize: 'inherit',
      }}
      disabled={disabled}
      onClick={() => onPick(idea.message)}
    >
      <MaterialIcon type="prompt_suggestion" style={muted} />
      {idea.label}
    </button>
  )
}

export default function StarterPrompts({
  withSelection,
  onPick,
  disabled,
}: {
  withSelection: boolean
  onPick: (text: string) => void
  disabled: boolean
}) {
  const projectIdeas = useMemo(() => sampleSize(ABOUT_THE_PROJECT, 3), [])
  const selectionIdeas = useMemo(() => sampleSize(ABOUT_THE_SELECTION, 3), [])
  // Re-rendered when a compile finishes; warnings alone do not count
  const compileErrors = useDetachCompileContext().logEntries?.errors.length ?? 0
  const ideas: Idea[] = withSelection
    ? selectionIdeas
    : [
        { label: 'What can you do?', message: 'In a few sentences, tell me how you can help with this LaTeX project.' },
        ...projectIdeas,
      ]
  if (!withSelection && compileErrors > 0) {
    ideas.push({ label: 'Fix the compile errors', message: 'Check the compile log and fix the errors it reports.' })
  }
  return (
    <div className="mt-auto">
      <p className="mb-2" style={{ ...muted, fontSize: 'var(--font-size-01)' }}>
        Start a chat
      </p>
      <div className="d-flex flex-column rounded overflow-hidden" style={boxed}>
        {ideas.map((idea, i) => (
          <IdeaButton idea={idea} onPick={onPick} disabled={disabled} first={i === 0} key={idea.label} />
        ))}
      </div>
    </div>
  )
}
