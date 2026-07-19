import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import { cleanupPartialDownload, downloadModel, type DownloadTransport } from './downloader'

const payload = Buffer.from('hello local model')
const digest = createHash('sha256').update(payload).digest('hex')

async function temporaryDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-download-'))
}

test('downloader resumes to a temp file and verifies size and SHA-256', async t => {
  const directory = await temporaryDirectory()
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const destinationPath = path.join(directory, 'model.gguf')
  const partial = payload.subarray(0, 6)
  await fs.writeFile(`${destinationPath}.part`, partial)
  let receivedRange = ''

  const transport: DownloadTransport = async (_url, headers) => {
    receivedRange = headers.range

    return {
      statusCode: 206,
      headers: { 'content-range': `bytes ${partial.length}-${payload.length - 1}/${payload.length}` },
      body: Readable.from([payload.subarray(partial.length)])
    }
  }

  const result = await downloadModel(
    {
      url: 'https://models.example/model.gguf',
      destinationPath,
      sha256: digest,
      sizeBytes: payload.length
    },
    { transport, diskReserveBytes: 0 }
  )

  assert.equal(receivedRange, `bytes=${partial.length}-`)
  assert.equal(result.resumedFromBytes, partial.length)
  assert.deepEqual(await fs.readFile(destinationPath), payload)
  await assert.rejects(fs.stat(`${destinationPath}.part`), { code: 'ENOENT' })
})

test('downloader rejects insecure redirects and enforces cleanup on cancellation', async t => {
  const directory = await temporaryDirectory()
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const destinationPath = path.join(directory, 'model.gguf')

  const redirectTransport: DownloadTransport = async () => ({
    statusCode: 302,
    headers: { location: 'http://models.example/insecure.gguf' },
    body: Readable.from([])
  })

  await assert.rejects(
    downloadModel(
      {
        url: 'https://models.example/model.gguf',
        destinationPath,
        sha256: digest,
        sizeBytes: payload.length
      },
      { transport: redirectTransport, diskReserveBytes: 0 }
    ),
    /redirect must use HTTPS/
  )

  await fs.writeFile(`${destinationPath}.part`, payload.subarray(0, 3))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    downloadModel(
      {
        url: 'https://models.example/model.gguf',
        destinationPath,
        sha256: digest,
        sizeBytes: payload.length
      },
      { signal: controller.signal, transport: redirectTransport, diskReserveBytes: 0 }
    ),
    { name: 'AbortError' }
  )
  await assert.rejects(fs.stat(`${destinationPath}.part`), { code: 'ENOENT' })
  await cleanupPartialDownload(destinationPath)
})

test('downloader removes corrupt completed temp files', async t => {
  const directory = await temporaryDirectory()
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const destinationPath = path.join(directory, 'model.gguf')

  await assert.rejects(
    downloadModel(
      {
        url: 'https://models.example/model.gguf',
        destinationPath,
        sha256: digest,
        sizeBytes: payload.length
      },
      {
        diskReserveBytes: 0,
        transport: async () => ({
          statusCode: 200,
          headers: {},
          body: Readable.from([Buffer.alloc(payload.length)])
        })
      }
    ),
    /SHA-256/
  )
  await assert.rejects(fs.stat(`${destinationPath}.part`), { code: 'ENOENT' })
})
