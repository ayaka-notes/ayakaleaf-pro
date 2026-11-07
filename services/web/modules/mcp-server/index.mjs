import Settings from '@overleaf/settings'
import McpRouter from './app/src/McpRouter.mjs'

// The MCP server complements git-bridge: files are cloned and pushed with git,
// and the same Personal Access Tokens authenticate both
const McpServerModule = Settings.enableGitBridge ? { router: McpRouter } : {}

export default McpServerModule
