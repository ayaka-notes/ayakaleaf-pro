// A stand-in for the AI services of the workbench and error-assistant
// modules: an OpenAI-compatible gateway (api.openai.com, streamed chat
// completions and Responses API), Tavily web search (api.tavily.com) and the GitBook MCP
// endpoint of the Overleaf documentation (docs.overleaf.com), and a web page
// on news.example.com. The tests queue the model's replies; everything lives
// in memory.
//
// Port 443 serves the four hosts over TLS, see services/lib/mock-server.mjs.
// Port 8080 is the control API for the tests (http://ai-mock:8080/_mock/...):
// reset, queue replies, set the search results, and read back the chat
// requests and the search queries Overleaf sent.

import crypto from 'node:crypto'
import { HttpError, listen, send } from './lib/mock-server.mjs'

const API_KEY = process.env.AI_MOCK_API_KEY
const TAVILY_KEY = process.env.AI_MOCK_TAVILY_KEY

let state

function reset() {
  state = {
    // Answers to the next chat completions, in order. A reply is
    // { text, reasoning, toolCalls: [{ name, args }], usage: { prompt,
    // completion }, status }; with status set, the request fails with it.
    replies: [],
    // { model, tools, messages }; from the Responses API
    // { api: 'responses', model, tools, input, store }
    requests: [],
    // Output items of stored responses by id, for item_reference inputs
    items: new Map(),
    webResults: [], // [{ title, url, content }]
    docsPages: [], // [{ title, link, content }]
    searches: [], // { service: 'web' | 'docs', query }
  }
}
reset()

function randomId() {
  return crypto.randomBytes(8).toString('hex')
}

function requireBearer(req, key) {
  if (req.headers.authorization !== `Bearer ${key}`) {
    throw new HttpError(401, 'invalid API key')
  }
}

// ------------------------------------------------------------------ openai

// Streams the reply as chat.completion.chunk events: reasoning, the text word
// by word, the tool calls, the finish reason and the usage, like OpenAI does
// with stream_options.include_usage.
function streamReply(res, model, reply) {
  const id = `chatcmpl-${randomId()}`
  const created = Math.floor(Date.now() / 1000)
  const event = data => res.write(`data: ${JSON.stringify(data)}\n\n`)
  const chunk = (delta, finishReason = null) =>
    event({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })

  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  chunk({ role: 'assistant', content: '' })
  if (reply.reasoning) chunk({ reasoning_content: reply.reasoning })
  for (const word of (reply.text || '').match(/\S+\s*/g) || []) {
    chunk({ content: word })
  }
  const toolCalls = reply.toolCalls || []
  toolCalls.forEach(({ name, args }, index) => {
    chunk({
      tool_calls: [
        {
          index,
          id: `call_${randomId()}`,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    })
  })
  chunk({}, toolCalls.length > 0 ? 'tool_calls' : 'stop')
  const { prompt = 10, completion = 5 } = reply.usage || {}
  event({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
    },
  })
  res.write('data: [DONE]\n\n')
  res.end()
}

// The ids of tool calls that no tool message answers. OpenAI refuses a
// request with any: each assistant message with tool_calls must be followed
// by a tool message for every tool_call_id.
function unansweredToolCalls(messages) {
  return messages.flatMap((message, index) => {
    const answered = new Set()
    for (let next = index + 1; messages[next]?.role === 'tool'; next++) {
      answered.add(messages[next].tool_call_id)
    }
    return (message.tool_calls || [])
      .map(call => call.id)
      .filter(id => !answered.has(id))
  })
}

const openai = [
  [
    'POST',
    /^\/v1\/chat\/completions$/,
    ({ req, res, body }) => {
      requireBearer(req, API_KEY)
      state.requests.push({
        model: body.model,
        tools: (body.tools || []).map(tool => tool.function.name),
        messages: body.messages,
      })
      const unanswered = unansweredToolCalls(body.messages)
      if (unanswered.length > 0) {
        throw new HttpError(
          400,
          "An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. " +
            `The following tool_call_ids did not have response messages: ${unanswered.join(', ')}`
        )
      }
      const reply = state.replies.shift()
      if (!reply) throw new HttpError(500, 'no reply queued')
      if (reply.status) {
        throw new HttpError(reply.status, 'failing as asked')
      }
      if (!body.stream) throw new HttpError(400, 'only streaming is mocked')
      streamReply(res, body.model, reply)
    },
  ],
]

// -------------------------------------------------------- openai responses

// Streams the reply as Responses API events: a reasoning item with its
// summary, a message with the text word by word, a function_call item for
// each tool call, then response.completed with the usage.
function streamResponse(res, model, reply, store) {
  const id = `resp_${randomId()}`
  const createdAt = Math.floor(Date.now() / 1000)
  const response = (status, output, usage = null) => ({
    id,
    object: 'response',
    created_at: createdAt,
    status,
    model,
    output,
    store,
    usage,
  })
  let sequence = 0
  const event = data => {
    const payload = { ...data, sequence_number: sequence++ }
    res.write(`event: ${data.type}\ndata: ${JSON.stringify(payload)}\n\n`)
  }
  const output = []
  const addItem = (item, streamContent, done) => {
    const ids = { output_index: output.length }
    event({ type: 'response.output_item.added', ...ids, item })
    streamContent({ item_id: item.id, ...ids })
    output.push({ ...item, ...done })
    event({ type: 'response.output_item.done', ...ids, item: output.at(-1) })
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  event({ type: 'response.created', response: response('in_progress', []) })
  event({ type: 'response.in_progress', response: response('in_progress', []) })
  if (reply.reasoning) {
    const part = { type: 'summary_text', text: reply.reasoning }
    addItem(
      { id: `rs_${randomId()}`, type: 'reasoning', summary: [] },
      ids => {
        const summary = { ...ids, summary_index: 0 }
        event({
          type: 'response.reasoning_summary_part.added',
          ...summary,
          part: { ...part, text: '' },
        })
        event({
          type: 'response.reasoning_summary_text.delta',
          ...summary,
          delta: part.text,
        })
        event({
          type: 'response.reasoning_summary_text.done',
          ...summary,
          text: part.text,
        })
        event({
          type: 'response.reasoning_summary_part.done',
          ...summary,
          part,
        })
      },
      { summary: [part] }
    )
  }
  if (reply.text) {
    const part = { type: 'output_text', text: reply.text, annotations: [] }
    addItem(
      {
        id: `msg_${randomId()}`,
        type: 'message',
        status: 'in_progress',
        role: 'assistant',
        content: [],
      },
      ids => {
        const content = { ...ids, content_index: 0 }
        event({
          type: 'response.content_part.added',
          ...content,
          part: { ...part, text: '' },
        })
        for (const word of reply.text.match(/\S+\s*/g) || []) {
          event({
            type: 'response.output_text.delta',
            ...content,
            delta: word,
            logprobs: [],
          })
        }
        event({
          type: 'response.output_text.done',
          ...content,
          text: reply.text,
          logprobs: [],
        })
        event({ type: 'response.content_part.done', ...content, part })
      },
      { status: 'completed', content: [part] }
    )
  }
  for (const { name, args } of reply.toolCalls || []) {
    const argumentsText = JSON.stringify(args)
    addItem(
      {
        id: `fc_${randomId()}`,
        type: 'function_call',
        status: 'in_progress',
        call_id: `call_${randomId()}`,
        name,
        arguments: '',
      },
      ids => {
        event({
          type: 'response.function_call_arguments.delta',
          ...ids,
          delta: argumentsText,
        })
        event({
          type: 'response.function_call_arguments.done',
          ...ids,
          arguments: argumentsText,
        })
      },
      { status: 'completed', arguments: argumentsText }
    )
  }
  // Stored before the response completes, so the next request can refer to it
  if (store) {
    for (const item of output) state.items.set(item.id, item)
  }
  const { prompt = 10, completion = 5 } = reply.usage || {}
  event({
    type: 'response.completed',
    response: response('completed', output, {
      input_tokens: prompt,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: completion,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: prompt + completion,
    }),
  })
  res.end()
}

// The input with each item_reference replaced by the stored item. OpenAI
// answers 404 for an id it does not have.
function resolveItemReferences(input) {
  return input.map(item => {
    if (item.type !== 'item_reference') return item
    const stored = state.items.get(item.id)
    if (!stored) {
      throw new HttpError(
        404,
        `Item with id '${item.id}' not found. Items are not persisted when \`store\` is set to false. ` +
          'Try again with `store` set to true, or remove this item from your input.'
      )
    }
    return stored
  })
}

// OpenAI refuses an input with a function call and no output for it, or an
// output for a call it does not have
function checkFunctionCallOutputs(input) {
  const callIds = type =>
    new Set(input.filter(item => item.type === type).map(item => item.call_id))
  const calls = callIds('function_call')
  const outputs = callIds('function_call_output')
  for (const callId of outputs) {
    if (!calls.has(callId)) {
      throw new HttpError(
        400,
        `No tool call found for function call output with call_id ${callId}.`
      )
    }
  }
  for (const callId of calls) {
    if (!outputs.has(callId)) {
      throw new HttpError(
        400,
        `No tool output found for function call ${callId}.`
      )
    }
  }
}

openai.push([
  'POST',
  /^\/v1\/responses$/,
  ({ req, res, body }) => {
    requireBearer(req, API_KEY)
    // Stored unless the request says otherwise
    const store = body.store !== false
    state.requests.push({
      api: 'responses',
      model: body.model,
      tools: (body.tools || []).map(tool => tool.name),
      input: body.input,
      store,
    })
    checkFunctionCallOutputs(resolveItemReferences(body.input))
    const reply = state.replies.shift()
    if (!reply) throw new HttpError(500, 'no reply queued')
    if (reply.status) {
      throw new HttpError(reply.status, 'failing as asked')
    }
    if (!body.stream) throw new HttpError(400, 'only streaming is mocked')
    streamResponse(res, body.model, reply, store)
  },
])

// ------------------------------------------------------------------ tavily

const tavily = [
  [
    'POST',
    /^\/search$/,
    ({ req, res, body }) => {
      requireBearer(req, TAVILY_KEY)
      state.searches.push({ service: 'web', query: body.query })
      send(res, 200, { query: body.query, results: state.webResults })
    },
  ],
]

// -------------------------------------------------------------------- news

// A web page for web_fetch, which reads it through the linked-url-proxy
const news = [
  [
    'GET',
    /^\/e2e$/,
    ({ res }) => {
      send(
        res,
        200,
        [
          '<!doctype html><html><head><title>E2E news</title>',
          '<style>p { color: red }</style>',
          "<script>window.tracker = 'e2e-script'</script></head>",
          '<body><h1>E2E news</h1><p>The e2e tests passed today.</p>',
          '<p>Fish &amp; chips</p></body></html>',
        ].join(''),
        { 'Content-Type': 'text/html; charset=utf-8' }
      )
    },
  ],
]

// -------------------------------------------------------------------- docs

// The MCP server answers a tools/call of searchDocumentation over streamable
// HTTP, as one SSE message
const docs = [
  [
    'POST',
    /^\/~gitbook\/mcp$/,
    ({ res, body }) => {
      if (body.method !== 'tools/call') {
        throw new HttpError(400, 'only tools/call is mocked')
      }
      state.searches.push({ service: 'docs', query: body.params.arguments.query })
      const message = {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: state.docsPages.map(page => ({
            type: 'text',
            text: `Title: ${page.title}\nLink: ${page.link}\nContent: ${page.content}`,
          })),
        },
      }
      send(res, 200, `event: message\ndata: ${JSON.stringify(message)}\n\n`, {
        'Content-Type': 'text/event-stream',
      })
    },
  ],
]

// ----------------------------------------------------------------- control

const control = [
  [
    'POST',
    /^\/_mock\/reset$/,
    ({ res }) => {
      reset()
      send(res, 204)
    },
  ],
  // Body: { replies: [reply] } - replaces the queue
  [
    'PUT',
    /^\/_mock\/replies$/,
    ({ res, body }) => {
      state.replies = body.replies
      send(res, 204)
    },
  ],
  [
    'GET',
    /^\/_mock\/requests$/,
    ({ res }) => {
      send(res, 200, state.requests)
    },
  ],
  // Body: { results: [{ title, url, content }] }
  [
    'PUT',
    /^\/_mock\/web-results$/,
    ({ res, body }) => {
      state.webResults = body.results
      send(res, 204)
    },
  ],
  // Body: { pages: [{ title, link, content }] }
  [
    'PUT',
    /^\/_mock\/docs-pages$/,
    ({ res, body }) => {
      state.docsPages = body.pages
      send(res, 204)
    },
  ],
  [
    'GET',
    /^\/_mock\/searches$/,
    ({ res }) => {
      send(res, 200, state.searches)
    },
  ],
]

listen({
  name: 'ai mock',
  routes: {
    'api.openai.com': openai,
    'api.tavily.com': tavily,
    'docs.overleaf.com': docs,
    'news.example.com': news,
  },
  control,
})
