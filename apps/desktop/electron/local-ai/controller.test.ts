import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { LocalAiController } from './controller'

test('inference target uses the verified model context limit', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-controller-'))

  try {
    await fs.writeFile(
      path.join(dataRoot, 'controller.json'),
      JSON.stringify({
        schemaVersion: 1,
        mode: 'local-first',
        endpointMode: 'existing',
        endpoint: 'http://127.0.0.1:12345/v1',
        modelId: 'qwen-context-test',
        contextTokens: 32_768,
        lastVerifiedAt: new Date().toISOString(),
        cloudEscalations: 0,
        tokensAvoided: 0,
        runtimeReportedTokens: 0,
        attempts: []
      })
    )
    const controller = new LocalAiController({ dataRoot, assetsRoot: dataRoot })

    const target = await controller.getInferenceTarget()

    assert.equal(target.available, true)
    assert.equal(target.maxContextTokens, 32_768)
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
