import Settings from '@overleaf/settings'
import WorkbenchRouter from './app/src/WorkbenchRouter.mjs'

// Configures the shared AI gateway, token quota, and search providers
// from environment variables:
//   AI_ENABLED   — set to 'true' to enable chat and error suggestions;
//                  disabled by default
//   AI_BASE_URL  — e.g. https://api.openai.com/v1 or https://ai-api.example.com/api/v1
//   AI_API_KEY   — key for that gateway
//   AI_MODEL     — default model for chat and error suggestions
//   AI_IMAGE_MODEL — optional; model on the same gateway for chats with images
//   AI_MAX_STEPS — optional; tool calls per user message, across requests (default 20)
//   AI_PROXY_URL — optional; route gateway calls through an HTTP proxy
//                  (like the GITHUB_/PAPERS_ proxy env vars)
//   AI_TOKEN_QUOTA — optional; per-user tokens per period for chat and error fixes
//                  (prompt+completion, all agent steps). Counted in Redis.
//                  Unset/0 = unlimited.
//   AI_TOKEN_QUOTA_PERIOD — 'month' (default; resets on the 1st, UTC) or
//                  'week' (resets Monday 00:00 UTC)
Settings.workbenchAi = {
  enabled: process.env.AI_ENABLED === 'true',
  baseURL: process.env.AI_BASE_URL,
  apiKey: process.env.AI_API_KEY,
  model: process.env.AI_MODEL,
  imageModel: process.env.AI_IMAGE_MODEL,
  maxSteps: parseInt(process.env.AI_MAX_STEPS || '', 10) || 20,
  proxyUrl: process.env.AI_PROXY_URL,
  tokenQuota: parseInt(process.env.AI_TOKEN_QUOTA || '', 10) || 0,
  tokenQuotaPeriod:
    process.env.AI_TOKEN_QUOTA_PERIOD === 'week' ? 'week' : 'month',
}

// Web search backend for the chat's "Web" tool. Default provider is Tavily
// (search API built for LLMs); the endpoint is overridable so a self-hosted,
// Tavily-compatible backend (e.g. tavily-open / SearXNG gateway) can be used.
//   WEB_SEARCH_PROVIDER   — 'tavily' (default)
//   TAVILY_API_KEY        — Tavily key (or WEB_SEARCH_API_KEY)
//   WEB_SEARCH_URL        — override the search endpoint
//   WEB_SEARCH_MAX_RESULTS— results per query (default 5)
//   WEB_SEARCH_DEPTH      — 'basic' (default) | 'advanced'
Settings.workbenchWebSearch = {
  provider: process.env.WEB_SEARCH_PROVIDER || 'tavily',
  apiKey: process.env.TAVILY_API_KEY || process.env.WEB_SEARCH_API_KEY,
  url: process.env.WEB_SEARCH_URL,
  maxResults: parseInt(process.env.WEB_SEARCH_MAX_RESULTS || '', 10) || 5,
  searchDepth: process.env.WEB_SEARCH_DEPTH || 'basic',
}

// Documentation search through a GitBook MCP endpoint.
// Set DOCS_MCP_URL to an empty string to disable it.
Settings.workbenchDocsSearch = {
  mcpUrl:
    process.env.DOCS_MCP_URL ?? 'https://docs.overleaf.com/~gitbook/mcp',
}

export default {
  router: WorkbenchRouter,
}
