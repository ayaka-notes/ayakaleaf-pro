export function createToolCallLimit(messages, limit) {
  const lastUser = messages.findLastIndex(message => message.role === 'user')
  const previousCalls = new Set(
    messages.slice(lastUser + 1).flatMap(message =>
      message.role === 'assistant'
        ? message.parts
            .filter(part =>
              typeof part.toolCallId === 'string' &&
              (typeof part.type === 'string' && part.type.startsWith('tool-') ||
                part.type === 'dynamic-tool')
            )
            .map(part => part.toolCallId)
        : []
    )
  )
  let remaining = limit - previousCalls.size
  const admitted = new Map()

  function allow(toolCallId) {
    if (!admitted.has(toolCallId)) {
      const allowed = remaining > 0
      admitted.set(toolCallId, allowed)
      if (allowed) remaining--
    }
    return admitted.get(toolCallId)
  }

  return {
    exhausted: () => remaining <= 0,
    middleware: {
      specificationVersion: 'v3',
      wrapStream: async ({ doStream }) => {
        const result = await doStream()
        return {
          ...result,
          // Filter before SDK tool execution and browser delivery. Keep reading
          // the model's stream so its final token usage is still recorded.
          stream: result.stream.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                const id = chunk.type === 'tool-call'
                  ? chunk.toolCallId
                  : chunk.type.startsWith('tool-input-') ? chunk.id : undefined
                if (id !== undefined && !allow(id)) return
                controller.enqueue(chunk)
              },
            })
          ),
        }
      },
    },
  }
}
