import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

interface RuntimeAssetFixture {
  acceleration: string
  architecture: string
  archive: string
  executable: string
  platform: string
  sha256: string
  sizeBytes: number
  url: string
}

const catalogPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../assets/local-ai-runtime-catalog.v1.json'
)
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as {
  assets: RuntimeAssetFixture[]
  schemaVersion: number
}

test('runtime catalog covers supported desktop platform and architecture pairs', () => {
  const supported = [
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['win32', 'arm64'],
    ['win32', 'x64'],
    ['linux', 'arm64'],
    ['linux', 'x64']
  ] as const

  assert.equal(catalog.schemaVersion, 1)

  for (const [platform, architecture] of supported) {
    const assets = catalog.assets.filter(
      asset => asset.platform === platform && asset.architecture === architecture
    )

    assert.ok(assets.length > 0, `missing ${platform}/${architecture} runtime`)

    for (const asset of assets) {
      assert.equal(asset.archive, platform === 'win32' ? 'zip' : 'tar.gz')
      assert.equal(asset.executable, platform === 'win32' ? 'llama-server.exe' : 'llama-server')
      assert.match(asset.sha256, /^[a-f0-9]{64}$/)
      assert.ok(asset.sizeBytes > 0)
      assert.match(asset.url, /^https:\/\//)
    }
  }
})
