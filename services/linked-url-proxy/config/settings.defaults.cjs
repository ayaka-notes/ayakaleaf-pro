const blockedNetworks = (process.env.OVERLEAF_LINKED_URL_BLOCKED_NETWORKS || '')
  .split(/[,\s]+/)
  .filter(Boolean)
  .map(cidr => cidr.trim())

const allowedResources = process.env.OVERLEAF_LINKED_URL_ALLOWED_RESOURCES
  ? new RegExp(process.env.OVERLEAF_LINKED_URL_ALLOWED_RESOURCES)
  : null

// Optional HTTP proxy for outbound requests, e.g. http://proxy.internal:3128
const outboundProxy = process.env.OVERLEAF_LINKED_URL_OUTBOUND_PROXY || null

module.exports = {
  maxRedirects: 5,
  outboundProxy,
  fetchTimeoutMs: 30000,
  blockedNetworks,
  allowedResources,
  userAgentHeader: {
     'User-Agent': 'Overleaf Extended CE - LinkedURLProxy (https://github.com/yu-i-i/overleaf-cep)'
  },
  maxUploadSize: process.env.MAX_UPLOAD_SIZE
    ? parseInt(process.env.MAX_UPLOAD_SIZE, 10) * 1024 * 1024
    : 50 * 1024 * 1024, // 50 MB
  internal: {
    linkedUrlProxy: {
      port: 3066,
      host: process.env.LINKED_URL_PROXY_HOST || '127.0.0.1',
    },
  },
}
