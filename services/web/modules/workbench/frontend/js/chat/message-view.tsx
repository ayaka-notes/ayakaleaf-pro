/**
 * One message of the chat. The user's own text without the editor context
 * that was sent along, the assistant's text, reasoning and tool calls.
 */
import { memo, type ReactNode } from 'react'
import type { UIMessage } from 'ai'
import { TOOLS, type Respond } from '../agent/tools'
import Markdown from './markdown'
import Thinking from './thinking'
import ToolCard from './tool-card'
import { boxed, plain, ruleAbove, surface } from './themed'
import ImagePreview from './image-preview'

export const CONTEXT_OPEN = '<editor-context>'

const toolNameOf = (part: any): string | undefined =>
  part.type === 'dynamic-tool'
    ? part.toolName
    : part.type.startsWith('tool-')
      ? part.type.slice(5)
      : undefined

function UserMessage({ message }: { message: UIMessage }) {
  return (
    <div className="align-self-end rounded-3 px-3 py-2" style={{ ...surface, ...plain, maxWidth: '85%' }}>
      {message.parts.map((part, index) => {
        if (part.type === 'text') {
          return <Markdown text={part.text.split(CONTEXT_OPEN)[0].trimEnd()} key={index} />
        }
        if (part.type === 'file') {
          const name = part.filename ?? 'Attached image'
          return (
            <ImagePreview src={part.url} name={name} key={index}>
              <img className="rounded me-1" style={{ ...boxed, height: 48 }} src={part.url} alt={name} tabIndex={0} />
            </ImagePreview>
          )
        }
        return null
      })}
    </div>
  )
}

function AssistantMessage({
  message,
  streaming,
  respond,
}: {
  message: UIMessage
  streaming: boolean
  respond: Respond
}) {
  // Reasoning and tool calls in a row share one box, a line between each;
  // the reply's text in between starts a new box
  const blocks: ReactNode[] = []
  let steps: ReactNode[] = []
  const endSteps = () => {
    if (steps.length) {
      blocks.push(
        <div className="rounded overflow-hidden" style={boxed} key={`steps-${blocks.length}`}>
          {steps}
        </div>
      )
      steps = []
    }
  }
  const addStep = (step: ReactNode, key: string | number) => {
    steps.push(
      <div className="px-2 py-1" style={steps.length ? ruleAbove : undefined} key={key}>
        {step}
      </div>
    )
  }
  message.parts.forEach((part: any, index) => {
    if (part.type === 'text') {
      endSteps()
      blocks.push(<Markdown text={part.text} key={index} />)
      return
    }
    if (part.type === 'reasoning') {
      const active = streaming && index === message.parts.length - 1
      addStep(<Thinking text={part.text} active={active} />, index)
      return
    }
    const name = toolNameOf(part)
    if (!name) return
    const tool = TOOLS[name]
    addStep(
      <ToolCard
        name={name}
        state={part.state}
        label={tool && part.input ? tool.label(part.input) : name}
        errorText={part.errorText}
      >
        {tool?.body?.(part, respond)}
      </ToolCard>,
      part.toolCallId
    )
  })
  endSteps()
  return <div className="d-flex flex-column gap-2">{blocks}</div>
}

export default memo(function MessageView({
  message,
  streaming,
  respond,
}: {
  message: UIMessage
  streaming: boolean
  respond: Respond
}) {
  return message.role === 'user' ? (
    <UserMessage message={message} />
  ) : (
    <AssistantMessage message={message} streaming={streaming} respond={respond} />
  )
})
