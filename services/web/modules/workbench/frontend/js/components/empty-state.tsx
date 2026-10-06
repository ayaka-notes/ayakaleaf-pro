/**
 * Displays starter prompts for a new conversation.
 * Suggestions depend on the editor selection and available LaTeX diagnostics.
 */
import { useCallback, useMemo, type FC, type PropsWithChildren, type ReactNode } from 'react'
import { shuffle } from 'lodash'
import { diagnosticCount } from '@codemirror/lint'
import MaterialIcon from '@/shared/components/material-icon'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import { sendMB } from '@/infrastructure/event-tracking'
import { usePromptInput } from './prompt-input'
import type { WorkbenchTab } from '../context/workbench-settings-context'

type PromptSuggestion = {
  title: string
  category: string
  prompt?: string
}

// Starter prompts when no text is selected.
const GENERAL_SUGGESTIONS: PromptSuggestion[] = [
  {
    category: 'latex',
    title: 'Generate a table',
    prompt:
      'Generate an example table for my document and explain succinctly how you can adjust it to suit my needs.',
  },
  {
    title: 'Create a Beamer presentation',
    category: 'latex',
    prompt:
      'Create a minimal Beamer presentation template in a new file. Explain how to use it and what help you can provide to change the formatting and design.',
  },
  {
    title: 'Add a bibliography',
    prompt: 'Add a bibliography file to this project',
    category: 'latex',
  },
  {
    title: 'Insert an equation',
    category: 'latex',
    prompt:
      'I want to insert an equation. Tell me succinctly what information you need from me to do this. Can I provide an image?',
  },
  {
    title: 'Generate a TikZ image',
    category: 'latex',
    prompt:
      'I want to insert a TikZ image. Tell me succinctly what information you need from me to do this. Can I provide an existing image for you to work from?',
  },
  {
    title: 'Insert a bullet list',
    category: 'latex',
  },
  {
    title: 'Insert a figure',
    category: 'latex',
    prompt:
      'I want to insert a figure. Explain succinctly what you need from me in order to do this.',
  },
  {
    title: 'Summarize this file',
    category: 'thinking',
  },
  {
    title: 'Find relevant research',
    category: 'thinking',
    prompt: 'Find research papers relevant to this project',
  },
]

// Starter prompts for the current editor selection.
const SELECTION_SUGGESTIONS: PromptSuggestion[] = [
  {
    title: 'Fix LaTeX errors',
    category: 'latex',
    prompt:
      'Identify any LaTeX errors in the highlighted text and provide appropriate fixes for them.',
  },
  {
    title: 'Change the text formatting',
    category: 'latex',
    prompt:
      'I would like to change the formatting of the highlighted text. Ask me what I would like to change, with suggestions for how you can help.',
  },
  {
    title: 'Explain the LaTeX code used here',
    category: 'latex',
  },
  {
    title: 'Suggest citation',
    category: 'thinking',
    prompt: 'Suggest a citation for this statement',
  },
  {
    title: 'Explain what this means',
    category: 'thinking',
    prompt: 'Explain what the selected text means',
  },
  {
    title: 'Refine my writing',
    category: 'writing',
  },
  {
    title: 'Make concise',
    category: 'writing',
  },
  {
    title: 'Make punchy',
    category: 'writing',
  },
  {
    title: 'Make scientific',
    category: 'writing',
  },
]

function pickRandom<T>(items: T[], count: number): T[] {
  return shuffle(items).slice(0, count)
}

export const ConversationEmptyState = ({
  hasSelection,
  sendMessage,
  setTab,
  disabled,
}: {
  hasSelection: boolean
  sendMessage: (message: { text: string }) => void
  setTab: (tab: WorkbenchTab) => void
  disabled: boolean
}) => {
  const { view } = useEditorViewContext()
  const promptInput = usePromptInput()
  const generalSuggestions = useMemo(() => pickRandom(GENERAL_SUGGESTIONS, 3), [])
  const selectionSuggestions = useMemo(() => pickRandom(SELECTION_SUGGESTIONS, 3), [])
  const suggestions = hasSelection ? selectionSuggestions : generalSuggestions

  if (promptInput.textInput.value.length > 0) {
    return <div className="conversation-empty-state" />
  }

  return (
    <div className="conversation-empty-state">
      <div className="flex-grow-1" />
      <EmptyStateSection>
        <EmptyStateSectionHeader title="Start a chat" />
        <EmptyStateActionList>
          <PromptSuggestionItem
            text="What can the assistant do for me?"
            prompt="Succinctly explain your capabilities and what you can do for me in Overleaf. This should include help with LaTeX, refining writing, reviewing their content, and finding citations."
            sendMessage={sendMessage}
            disabled={disabled}
          />
          {suggestions.map(({ title, prompt }) => (
            <PromptSuggestionItem
              text={title}
              prompt={prompt}
              sendMessage={sendMessage}
              disabled={disabled}
              key={title}
            />
          ))}
          {!hasSelection && view && diagnosticCount(view.state) > 0 && (
            <PromptSuggestionItem
              text="Fix LaTeX errors"
              prompt="Identify any LaTeX errors in this file and provide appropriate fixes for all of them."
              sendMessage={sendMessage}
              disabled={disabled}
            />
          )}
        </EmptyStateActionList>
      </EmptyStateSection>
    </div>
  )
}

const EmptyStateSection: FC<PropsWithChildren> = ({ children }) => (
  <div className="empty-state-section">{children}</div>
)

const EmptyStateSectionHeader = ({ title }: { title: string }) => (
  <div className="empty-state-section-header">{title}</div>
)

const EmptyStateActionList: FC<PropsWithChildren> = ({ children }) => (
  <ul className="empty-state-action-list">{children}</ul>
)

export const EmptyStateActionItem = ({
  title,
  description,
  icon,
  postfix,
  onClick,
  disabled,
  isHighlighted,
}: {
  title: string
  description?: string
  icon: string
  postfix?: ReactNode
  onClick: () => void
  disabled?: boolean
  isHighlighted?: boolean
}) => (
  <li>
    <button
      className={
        'empty-state-action-list-item' +
        (isHighlighted && !disabled ? ' highlighted' : '')
      }
      onClick={onClick}
      disabled={disabled}
    >
      <MaterialIcon type={icon} className="empty-state-action-list-item-icon" />
      <div className="empty-state-action-list-item-content">
        <span className="empty-state-action-list-item-text">{title}</span>
        {description && (
          <span className="empty-state-action-list-item-description">{description}</span>
        )}
      </div>
      {!disabled && postfix}
    </button>
  </li>
)

const PromptSuggestionItem = ({
  text,
  prompt,
  sendMessage,
  disabled,
}: {
  text: string
  prompt?: string
  sendMessage: (message: { text: string }) => void
  disabled: boolean
}) => {
  const handleClick = useCallback(() => {
    sendMessage({ text: prompt ?? text })
    sendMB('ai-chat', { type: 'prompt', action: text })
  }, [sendMessage, text, prompt])
  return (
    <EmptyStateActionItem
      title={text}
      icon="prompt_suggestion"
      onClick={handleClick}
      disabled={disabled}
    />
  )
}
