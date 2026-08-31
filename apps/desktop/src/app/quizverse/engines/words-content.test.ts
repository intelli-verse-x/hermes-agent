import { afterEach, describe, expect, it, vi } from 'vitest'

import fixture from './fixtures/words-content-manifest.json'
import { loadWordsDataset, parseWordsContentManifest } from './words-content'

const validBody = '["ALPHA"]'
const validHash = '5b096965fe56384dd9b97c03976e82801c9b87ee5817260ebcdb003aea6f0250'

function manifest(contentVersion = 'v1', sha256 = validHash, minItems = 1) {
  return {
    ...fixture,
    content_version: contentVersion,
    datasets: [
      {
        ...fixture.datasets[0],
        bytes: 9,
        min_items: minItems,
        sha256
      }
    ]
  }
}

function response(body: string, options: { etag?: string; offline?: boolean; status?: number } = {}) {
  return {
    body,
    contentType: 'application/json',
    etag: options.etag ?? '"fixture"',
    offline: options.offline,
    status: options.status ?? 200
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  window.hermesDesktop = undefined as never
})

describe('Words first-party content manifest', () => {
  it('accepts the versioned integrity contract fixture', () => {
    const manifest = parseWordsContentManifest(fixture)

    expect(manifest.manifest_version).toBe(1)
    expect(manifest.datasets[0]).toMatchObject({
      bytes: 9,
      id: 'guess-5-shared-test',
      kind: 'guess-5',
      min_items: 1,
      skin: 'shared'
    })
  })

  it('rejects external dataset URLs, duplicate IDs, and missing integrity', () => {
    expect(() =>
      parseWordsContentManifest({
        ...fixture,
        datasets: [{ ...fixture.datasets[0], url: 'https://evil.example/bank.json' }]
      })
    ).toThrow(/malformed/)
    expect(() =>
      parseWordsContentManifest({
        ...fixture,
        datasets: [fixture.datasets[0], fixture.datasets[0]]
      })
    ).toThrow(/malformed/)
    expect(() =>
      parseWordsContentManifest({
        ...fixture,
        datasets: [{ ...fixture.datasets[0], sha256: '' }]
      })
    ).toThrow(/malformed/)
    expect(() =>
      parseWordsContentManifest({
        ...fixture,
        expires_at: fixture.generated_at
      })
    ).toThrow(/expiry/)
  })

  it('refetches an expired cached manifest and fails closed when no current manifest is available', async () => {
    const expired = {
      ...manifest(),
      expires_at: '2020-01-02T00:00:00.000Z',
      generated_at: '2020-01-01T00:00:00.000Z'
    }

    const request = vi
      .fn()
      .mockResolvedValueOnce(response(JSON.stringify(expired), { offline: true }))
      .mockResolvedValueOnce(response(JSON.stringify(expired), { offline: true }))

    window.hermesDesktop = { quizverse: { productRequest: request } } as never

    await expect(loadWordsDataset<string[]>('guess-5', 'shared')).rejects.toThrow(/expired/)
    expect(request.mock.calls.map(([input]) => input.cacheMode)).toEqual(['default', 'reload'])
  })

  it('evicts a tampered cached body and refetches exactly once without a 304 loop', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(JSON.stringify(manifest())))
      .mockResolvedValueOnce(response('["BRAVO"]'))
      .mockResolvedValueOnce(response(JSON.stringify(manifest())))
      .mockResolvedValueOnce(response(validBody))

    window.hermesDesktop = { quizverse: { productRequest: request } } as never

    await expect(loadWordsDataset<string[]>('guess-5', 'shared')).resolves.toMatchObject({
      contentVersion: 'v1',
      data: ['ALPHA'],
      source: 'first-party-network'
    })
    expect(request.mock.calls.map(([input]) => input.cacheMode)).toEqual(['default', 'default', 'reload', 'reload'])
  })

  it('refreshes the manifest and dataset together on content rollover', async () => {
    const bravoHash = 'b425d6b246fb2b1559085da4b4468574b7ec6de57a67648967b64ec25e95aa47'

    const request = vi
      .fn()
      .mockResolvedValueOnce(response(JSON.stringify(manifest('v1'))))
      .mockResolvedValueOnce(response('["BRAVO"]'))
      .mockResolvedValueOnce(response(JSON.stringify(manifest('v2', bravoHash))))
      .mockResolvedValueOnce(response('["BRAVO"]'))

    window.hermesDesktop = { quizverse: { productRequest: request } } as never

    await expect(loadWordsDataset<string[]>('guess-5', 'shared')).resolves.toMatchObject({
      contentVersion: 'v2',
      data: ['BRAVO']
    })
  })

  it('uses a verified encrypted-cache response offline and rejects incomplete content after one retry', async () => {
    const offlineRequest = vi
      .fn()
      .mockResolvedValueOnce(response(JSON.stringify(manifest())))
      .mockResolvedValueOnce(response(validBody, { offline: true }))

    window.hermesDesktop = { quizverse: { productRequest: offlineRequest } } as never

    await expect(loadWordsDataset<string[]>('guess-5', 'shared')).resolves.toMatchObject({
      offline: true,
      source: 'first-party-cache'
    })

    const incompleteRequest = vi
      .fn()
      .mockResolvedValueOnce(response(JSON.stringify(manifest('count-v1', validHash, 2))))
      .mockResolvedValueOnce(response(validBody))
      .mockResolvedValueOnce(response(JSON.stringify(manifest('count-v1', validHash, 2))))
      .mockResolvedValueOnce(response(validBody))

    window.hermesDesktop = { quizverse: { productRequest: incompleteRequest } } as never

    await expect(loadWordsDataset<string[]>('guess-5', 'shared')).rejects.toThrow(/incomplete/)
    expect(incompleteRequest).toHaveBeenCalledTimes(4)
  })

  it('does not hide a first-party manifest 404 behind an unverified legacy dictionary', async () => {
    const request = vi.fn().mockResolvedValue(response('not found', { status: 404 }))
    window.hermesDesktop = { quizverse: { productRequest: request } } as never

    await expect(loadWordsDataset<string[]>('guess-5', 'shared')).rejects.toThrow(/failed \(404\)/)
    expect(request).toHaveBeenCalledTimes(1)
  })
})
