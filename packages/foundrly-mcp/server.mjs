#!/usr/bin/env node
/**
 * Foundrly product-knowledge MCP — stdio JSON-RPC for left-rail Hermes.
 * No portal admin tools (Mail Studio / CRM). No broker secrets.
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const SUPPORTED_PROTOCOLS = ['2025-03-26', '2024-11-05']
const HERE = path.dirname(fileURLToPath(import.meta.url))
const KNOWLEDGE_PATH = path.join(HERE, 'knowledge.md')

const TOOLS = [
  {
    name: 'fd_product_knowledge',
    description:
      'Load Foundrly product identity and surface guidance for left-rail Hermes. Not Mail Studio or CRM.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        topic: {
          type: 'string',
          description: 'Optional focus hint (identity, surfaces, overnight, boundaries).'
        }
      }
    }
  }
]

class McpError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function invalid(message) {
  return new McpError(-32602, message)
}

function loadKnowledge() {
  try {
    return fs.readFileSync(KNOWLEDGE_PATH, 'utf8').trim()
  } catch {
    return [
      '# Foundrly product knowledge (embedded fallback)',
      '',
      'Foundrly is Intelliverse X\'s AI co-founder for local and small businesses.',
      'Product web: https://getfoundrly.com',
      'Admin portal: https://admin.intelli-verse-x.ai/admin/portal',
      'Mail Studio / CRM / portal tools: use Foundrly → Admin copilot (OTP), not this tool.'
    ].join('\n')
  }
}

function callTool(name, args = {}) {
  if (name !== 'fd_product_knowledge') {
    throw invalid(`Unknown tool: ${name}`)
  }
  const topic = typeof args.topic === 'string' ? args.topic.trim() : ''
  const body = loadKnowledge()
  const header = topic ? `Focus hint: ${topic}\n\n` : ''
  return {
    tool: name,
    data: {
      appId: 'foundrly',
      source: 'bundled-knowledge.md',
      text: `${header}${body}`,
      boundaries: {
        mailStudio: false,
        crm: false,
        automationStudio: false,
        adminCopilotRequiredForPortalTools: true
      }
    }
  }
}

function createConnectionState() {
  return {
    initialized: false,
    shuttingDown: false,
    protocolVersion: null,
    inFlight: new Map()
  }
}

async function handle(method, params = {}, state) {
  if (state.shuttingDown && method !== 'shutdown') {
    throw new McpError(-32000, 'Connection is shutting down')
  }

  if (method === 'initialize') {
    if (
      !params ||
      typeof params !== 'object' ||
      typeof params.protocolVersion !== 'string' ||
      !params.clientInfo ||
      typeof params.clientInfo.name !== 'string' ||
      typeof params.clientInfo.version !== 'string' ||
      !params.capabilities ||
      typeof params.capabilities !== 'object' ||
      Array.isArray(params.capabilities)
    ) {
      throw invalid('initialize requires protocolVersion, clientInfo name/version, and capabilities')
    }
    if (!SUPPORTED_PROTOCOLS.includes(params.protocolVersion)) {
      throw new McpError(-32602, `Unsupported protocol version: ${params.protocolVersion}`)
    }
    state.initialized = true
    state.protocolVersion = params.protocolVersion
    return {
      capabilities: { tools: {} },
      protocolVersion: params.protocolVersion,
      serverInfo: { name: 'foundrly-product-knowledge', version: '0.1.0' }
    }
  }

  if (method === 'ping') return {}
  if (method === 'shutdown') {
    state.shuttingDown = true
    for (const controller of state.inFlight.values()) controller.abort()
    return {}
  }
  if (!state.initialized) throw new McpError(-32002, 'Server connection is not initialized')

  if (method === 'tools/list') {
    return {
      tools: TOOLS.map(({ description, inputSchema, name }) => ({
        description,
        inputSchema,
        name
      }))
    }
  }

  if (method === 'tools/call') {
    if (!params || typeof params.name !== 'string') throw invalid('Tool name is required')
    const result = callTool(params.name, params.arguments || {})
    return {
      content: [{ text: JSON.stringify(result), type: 'text' }],
      isError: false,
      structuredContent: result
    }
  }

  if (method === 'resources/list') return { resources: [] }
  if (method === 'prompts/list') return { prompts: [] }

  throw new McpError(-32601, `Method not found: ${method}`)
}

export async function dispatch(message, _signal, state) {
  if (
    !message ||
    typeof message !== 'object' ||
    message.jsonrpc !== '2.0' ||
    typeof message.method !== 'string'
  ) {
    throw new McpError(-32600, 'Invalid JSON-RPC request')
  }
  return handle(message.method, message.params, state)
}

export { TOOLS, callTool, loadKnowledge }

function serve(inputStream, write, close, exitProcessOnShutdown = false) {
  const state = createConnectionState()
  const input = readline.createInterface({ input: inputStream, crlfDelay: Infinity })
  const send = payload => write(`${JSON.stringify(payload)}\n`)

  input.on('line', line => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      send({ error: { code: -32700, message: 'Parse error' }, id: null, jsonrpc: '2.0' })
      return
    }

    if (
      !message ||
      typeof message !== 'object' ||
      Array.isArray(message) ||
      message.jsonrpc !== '2.0' ||
      typeof message.method !== 'string'
    ) {
      send({
        error: { code: -32600, message: 'Invalid JSON-RPC request' },
        id: message && typeof message === 'object' && 'id' in message ? message.id : null,
        jsonrpc: '2.0'
      })
      return
    }

    if (message.method === 'notifications/cancelled') {
      state.inFlight.get(message.params?.requestId)?.abort()
      return
    }
    if (message.method?.startsWith('notifications/')) return

    if (message.id === undefined) {
      void dispatch(message, undefined, state).catch(() => {})
      return
    }

    const controller = new AbortController()
    state.inFlight.set(message.id, controller)
    void dispatch(message, controller.signal, state)
      .then(result => {
        send({ id: message.id, jsonrpc: '2.0', result })
        if (message.method === 'shutdown') {
          setTimeout(() => {
            close()
            if (exitProcessOnShutdown) process.exit(0)
          }, 0)
        }
      })
      .catch(error =>
        send({
          error: {
            code: error instanceof McpError ? error.code : -32603,
            message: error instanceof Error ? error.message : 'Internal error'
          },
          id: message.id ?? null,
          jsonrpc: '2.0'
        })
      )
      .finally(() => state.inFlight.delete(message.id))
  })

  return { input, state }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMain) {
  serve(process.stdin, text => process.stdout.write(text), () => process.stdin.destroy(), true)
  process.on('SIGTERM', () => process.exit(0))
}
