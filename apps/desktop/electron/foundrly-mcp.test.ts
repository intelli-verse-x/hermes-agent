import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { test } from 'vitest'

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/foundrly-mcp')
const serverPath = path.join(mcpRoot, 'server.mjs')

async function rpcRoundTrip(messages: object[]): Promise<object[]> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    const expected = messages.filter(m => Object.prototype.hasOwnProperty.call(m, 'id')).length

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`timeout; stdout=${out}`))
    }, 5000)

    child.stdout.on('data', chunk => {
      out += chunk.toString()

      const lines = out.trim().split(/\n/).filter(Boolean)

      if (lines.length >= expected) {
        clearTimeout(timer)
        child.kill()

        try {
          resolve(lines.map(line => JSON.parse(line)))
        } catch (error) {
          reject(error)
        }
      }
    })
    child.on('error', reject)

    for (const message of messages) {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    }
  })
}

test('foundrly-mcp server answers initialize, tools/list, and fd_product_knowledge', async () => {
  const replies = await rpcRoundTrip([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.0' }
      }
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'fd_product_knowledge', arguments: { topic: 'boundaries' } }
    }
  ])

  const init = replies.find(r => (r as { id?: number }).id === 1) as {
    result?: { serverInfo?: { name?: string } }
  }

  const list = replies.find(r => (r as { id?: number }).id === 2) as {
    result?: { tools?: Array<{ name: string }> }
  }

  const call = replies.find(r => (r as { id?: number }).id === 3) as {
    result?: {
      structuredContent?: { data?: { boundaries?: { mailStudio?: boolean; crm?: boolean }; text?: string } }
    }
  }

  assert.equal(init.result?.serverInfo?.name, 'foundrly-product-knowledge')
  assert.equal(list.result?.tools?.[0]?.name, 'fd_product_knowledge')
  assert.equal(list.result?.tools?.length, 1)
  assert.equal(call.result?.structuredContent?.data?.boundaries?.mailStudio, false)
  assert.equal(call.result?.structuredContent?.data?.boundaries?.crm, false)
  assert.match(call.result?.structuredContent?.data?.text || '', /Focus hint: boundaries/)
})

test('foundrly-mcp package contains knowledge.md and no portal admin tools in server source', () => {
  const serverSource = fs.readFileSync(serverPath, 'utf8')
  const knowledge = fs.readFileSync(path.join(mcpRoot, 'knowledge.md'), 'utf8')
  assert.match(serverSource, /fd_product_knowledge/)
  assert.doesNotMatch(serverSource, /\bfd_crm\b|\bfd_mail_studio\b/)
  assert.match(knowledge, /getfoundrly\.com/)
})
