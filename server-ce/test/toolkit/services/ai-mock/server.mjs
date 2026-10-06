// A stand-in for the AI services of the workbench and error-assistant
// modules: an OpenAI-compatible gateway (api.openai.com, streamed chat
// completions), Tavily web search (api.tavily.com) and the GitBook MCP
// endpoint of the Overleaf documentation (docs.overleaf.com). The tests queue
// the model's replies; everything lives in memory.
//
// Port 443 serves the three hosts over TLS, see services/lib/mock-server.mjs.
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
    requests: [], // { model, tools, messages }
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
  },
  control,
})
