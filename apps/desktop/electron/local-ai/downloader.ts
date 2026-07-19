import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { request as httpsRequest } from 'node:https'
import path from 'node:path'
import type { Readable } from 'node:stream'

export interface DownloadSpec {
  url: string
  destinationPath: string
  sha256: string
  sizeBytes: number
}

export interface DownloadResult {
  path: string
  bytesDownloaded: number
  resumedFromBytes: number
  sha256: string
}

export interface DownloadResponse {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: Readable
}

export type DownloadTransport = (
  url: URL,
  headers: Record<string, string>,
  signal?: AbortSignal
) => Promise<DownloadResponse>

export interface DownloaderOptions {
  signal?: AbortSignal
  transport?: DownloadTransport
  redirectLimit?: number
  diskReserveBytes?: number
  onProgress?: (downloadedBytes: number, totalBytes: number) => void
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/i

function abortError(): Error {
  const error = new Error('Download cancelled')
  error.name = 'AbortError'

  return error
}

function headerValue(headers: DownloadResponse['headers'], name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]

  return Array.isArray(value) ? value[0] : value
}

export const defaultDownloadTransport: DownloadTransport = (url, headers, signal) =>
  new Promise((resolve, reject) => {
    if (url.protocol !== 'https:') {
      reject(new Error('Downloads require HTTPS'))

      return
    }

    const request = httpsRequest(url, { method: 'GET', headers, signal }, response => {
      resolve({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: response
      })
    })

    request.once('error', reject)
    request.end()
  })

async function sha256File(filePath: string): Promise<{ digest: string; size: number }> {
  const file = await fs.open(filePath, 'r')
  const hash = createHash('sha256')
  let size = 0

  try {
    for await (const chunk of file.createReadStream()) {
      hash.update(chunk)
      size += chunk.length
    }
  } finally {
    await file.close()
  }

  return { digest: hash.digest('hex'), size }
}

async function availableDiskBytes(directory: string): Promise<number> {
  const stats = await fs.statfs(directory)

  return Number(stats.bavail) * Number(stats.bsize)
}

async function removeIfPresent(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true })
}

async function requestFollowingRedirects(
  initialUrl: URL,
  headers: Record<string, string>,
  options: DownloaderOptions
): Promise<DownloadResponse> {
  const transport = options.transport ?? defaultDownloadTransport
  const limit = options.redirectLimit ?? 5
  let current = initialUrl

  for (let redirects = 0; ; redirects += 1) {
    if (options.signal?.aborted) {throw abortError()}
    const response = await transport(current, headers, options.signal)

    if (![301, 302, 303, 307, 308].includes(response.statusCode)) {return response}
    response.body.destroy()

    if (redirects >= limit) {throw new Error(`Download exceeded redirect limit of ${limit}`)}
    const location = headerValue(response.headers, 'location')

    if (!location) {throw new Error('Redirect response omitted Location')}
    const next = new URL(location, current)

    if (next.protocol !== 'https:') {throw new Error('Download redirect must use HTTPS')}

    if (next.username || next.password) {throw new Error('Download redirect must not contain credentials')}
    current = next
  }
}

export async function downloadModel(
  spec: DownloadSpec,
  options: DownloaderOptions = {}
): Promise<DownloadResult> {
  if (!SHA256_PATTERN.test(spec.sha256)) {throw new Error('Expected SHA-256 must contain 64 hexadecimal characters')}

  if (!Number.isSafeInteger(spec.sizeBytes) || spec.sizeBytes <= 0) {throw new Error('Expected size must be positive')}
  const initialUrl = new URL(spec.url)

  if (initialUrl.protocol !== 'https:') {throw new Error('Downloads require HTTPS')}

  if (initialUrl.username || initialUrl.password) {throw new Error('Download URL must not contain credentials')}

  const directory = path.dirname(spec.destinationPath)
  const temporaryPath = `${spec.destinationPath}.part`
  await fs.mkdir(directory, { recursive: true })

  try {
    const existing = await sha256File(spec.destinationPath)

    if (existing.size === spec.sizeBytes && existing.digest.toLowerCase() === spec.sha256.toLowerCase()) {
      return {
        path: spec.destinationPath,
        bytesDownloaded: 0,
        resumedFromBytes: existing.size,
        sha256: existing.digest
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {throw error}
  }

  let resumedFromBytes = 0

  try {
    resumedFromBytes = (await fs.stat(temporaryPath)).size

    if (resumedFromBytes > spec.sizeBytes) {
      await removeIfPresent(temporaryPath)
      resumedFromBytes = 0
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {throw error}
  }

  const neededBytes = spec.sizeBytes - resumedFromBytes + (options.diskReserveBytes ?? 64 * 1024 * 1024)

  if ((await availableDiskBytes(directory)) < neededBytes) {
    throw new Error(`Insufficient disk space: ${neededBytes} bytes required`)
  }

  const headers: Record<string, string> = { 'accept-encoding': 'identity' }

  if (resumedFromBytes > 0) {headers.range = `bytes=${resumedFromBytes}-`}
  let response: DownloadResponse

  try {
    response = await requestFollowingRedirects(initialUrl, headers, options)
  } catch (error) {
    if (options.signal?.aborted) {await removeIfPresent(temporaryPath)}
    throw error
  }

  let append = resumedFromBytes > 0

  if (append && response.statusCode === 206) {
    const contentRange = headerValue(response.headers, 'content-range')

    if (!contentRange?.startsWith(`bytes ${resumedFromBytes}-`)) {
      response.body.destroy()
      throw new Error('Resume response returned an invalid Content-Range')
    }
  } else if (response.statusCode === 200) {
    append = false
    resumedFromBytes = 0
  } else {
    response.body.destroy()
    throw new Error(`Download returned HTTP ${response.statusCode}`)
  }

  const hash = createHash('sha256')

  if (append) {
    const partial = await fs.open(temporaryPath, 'r')

    try {
      for await (const chunk of partial.createReadStream()) {
        hash.update(chunk)
      }
    } finally {
      await partial.close()
    }
  }

  const file = await fs.open(temporaryPath, append ? 'a' : 'w', 0o600)
  let downloaded = resumedFromBytes
  const onAbort = () => response.body.destroy(abortError())
  options.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    for await (const chunk of response.body) {
      if (options.signal?.aborted) {throw abortError()}
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      downloaded += buffer.length

      if (downloaded > spec.sizeBytes) {throw new Error('Download exceeded expected size')}
      hash.update(buffer)
      await file.write(buffer)
      options.onProgress?.(downloaded, spec.sizeBytes)
    }
  } catch (error) {
    if (options.signal?.aborted || (error as Error).name === 'AbortError') {
      await file.close()
      await removeIfPresent(temporaryPath)
      throw abortError()
    }

    throw error
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
    await file.close().catch(() => undefined)
  }

  const digest = hash.digest('hex')

  if (downloaded !== spec.sizeBytes || digest.toLowerCase() !== spec.sha256.toLowerCase()) {
    await removeIfPresent(temporaryPath)
    throw new Error(
      downloaded !== spec.sizeBytes ? 'Downloaded size did not match catalog' : 'Downloaded SHA-256 did not match catalog'
    )
  }

  await fs.rename(temporaryPath, spec.destinationPath)

  return {
    path: spec.destinationPath,
    bytesDownloaded: downloaded - resumedFromBytes,
    resumedFromBytes,
    sha256: digest
  }
}

export async function cleanupPartialDownload(destinationPath: string): Promise<void> {
  await removeIfPresent(`${destinationPath}.part`)
}
