import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateTokenSavings,
  compactCloudHandoff,
  decideInitialRoute,
  evaluateLocalOutcome,
  type LocalCapabilities,
  type LocalOutcome,
  type RequestClassification
} from './index'

const request: RequestClassification = {
  modality: 'text',
  estimatedContextTokens: 2_000,
  requiredTools: ['read_file'],
  sensitivity: 'internal',
  explicitFrontier: false
}

const capabilities: LocalCapabilities = {
  available: true,
  modalities: ['text'],
  maxContextTokens: 8_000,
  tools: ['read_file']
}

const goodOutcome: LocalOutcome = {
  transportOk: true,
  malformedToolJson: false,
  truncated: false,
  repeatedToolFailures: 0,
  validationPassed: true,
  responseText: 'Complete.',
  refused: false,
  explicitCloudRetry: false
}

test('policy modes deterministically select their intended route', () => {
  assert.deepEqual(decideInitialRoute('local-first', request, capabilities), {
    route: 'local',
    reason: 'local-capable'
  })
  assert.deepEqual(decideInitialRoute('local-only', request, capabilities), {
    route: 'local',
    reason: 'local-capable'
  })
  assert.deepEqual(decideInitialRoute('cloud-only', request, capabilities), {
    route: 'cloud',
    reason: 'policy-cloud-only'
  })
})

test('local capability checks cover availability, modality, context, and tools', () => {
  assert.equal(
    decideInitialRoute('local-first', request, { ...capabilities, available: false }).reason,
    'local-unavailable'
  )
  assert.equal(
    decideInitialRoute('local-first', { ...request, modality: 'image' }, capabilities).reason,
    'unsupported-modality'
  )
  assert.equal(
    decideInitialRoute(
      'local-first',
      { ...request, estimatedContextTokens: capabilities.maxContextTokens + 1 },
      capabilities
    ).reason,
    'context-limit-exceeded'
  )
  assert.equal(
    decideInitialRoute('local-first', { ...request, requiredTools: ['shell'] }, capabilities).reason,
    'unsupported-tool'
  )
})

test('frontier requests use cloud except where policy or sensitivity prohibits it', () => {
  assert.deepEqual(decideInitialRoute('local-first', { ...request, explicitFrontier: true }, capabilities), {
    route: 'cloud',
    reason: 'frontier-requested'
  })
  assert.deepEqual(
    decideInitialRoute('local-first', { ...request, explicitFrontier: true, sensitivity: 'restricted' }, capabilities),
    { route: 'blocked', reason: 'sensitive-cloud-blocked' }
  )
})

test('quality gate accepts a valid local result', () => {
  assert.deepEqual(evaluateLocalOutcome('local-first', goodOutcome), {
    route: 'local',
    reason: 'local-quality-passed'
  })
})

test('quality gate identifies every objective cloud retry condition', () => {
  const failures: Array<[Partial<LocalOutcome>, string]> = [
    [{ transportOk: false }, 'local-transport-failure'],
    [{ malformedToolJson: true }, 'local-malformed-tool-json'],
    [{ truncated: true }, 'local-truncated'],
    [{ repeatedToolFailures: 2 }, 'local-repeated-tool-failures'],
    [{ validationPassed: false }, 'local-validation-failed'],
    [{ responseText: '   ' }, 'local-empty-response'],
    [{ refused: true }, 'local-refusal'],
    [{ explicitCloudRetry: true }, 'explicit-cloud-retry']
  ]

  for (const [change, reason] of failures) {
    assert.deepEqual(evaluateLocalOutcome('local-first', { ...goodOutcome, ...change }), {
      route: 'cloud',
      reason
    })
  }
})

test('local-only never emits a cloud route', () => {
  const initialRequests: RequestClassification[] = [
    request,
    { ...request, explicitFrontier: true },
    { ...request, modality: 'video' },
    { ...request, estimatedContextTokens: 99_999 },
    { ...request, requiredTools: ['missing'] }
  ]

  for (const candidate of initialRequests) {
    assert.notEqual(decideInitialRoute('local-only', candidate, capabilities).route, 'cloud')
  }

  const outcomeChanges: Array<Partial<LocalOutcome>> = [
    { transportOk: false },
    { malformedToolJson: true },
    { truncated: true },
    { repeatedToolFailures: 10 },
    { validationPassed: false },
    { responseText: '' },
    { refused: true },
    { explicitCloudRetry: true }
  ]

  for (const change of outcomeChanges) {
    assert.notEqual(evaluateLocalOutcome('local-only', { ...goodOutcome, ...change }).route, 'cloud')
  }
})

test('handoff keeps only latest system/user and relevant tool results in source order', () => {
  const handoff = compactCloudHandoff(
    [
      { role: 'system', content: 'old system' },
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'verbose reasoning' },
      { role: 'tool', toolCallId: 'irrelevant', content: 'unused result' },
      { role: 'system', content: 'current system' },
      { role: 'tool', toolCallId: 'needed', content: 'required fact' },
      { role: 'user', content: 'latest question' }
    ],
    ['needed'],
    { maxCharacters: 1_000, maxTokens: 1_000 }
  )

  assert.deepEqual(handoff.messages, [
    { role: 'system', content: 'current system' },
    { role: 'tool', toolCallId: 'needed', content: 'required fact' },
    { role: 'user', content: 'latest question' }
  ])
  assert.equal(handoff.omittedMessages, 4)
})

test('handoff obeys both character and estimated token caps while retaining message roles', () => {
  const handoff = compactCloudHandoff(
    [
      { role: 'system', content: 'S'.repeat(100) },
      { role: 'tool', toolCallId: 'needed', content: 'T'.repeat(100) },
      { role: 'user', content: 'U'.repeat(100) }
    ],
    ['needed'],
    { maxCharacters: 100, maxTokens: 10, charactersPerToken: 4 }
  )

  assert.equal(handoff.messages.length, 3)
  assert.ok(handoff.messages.every(message => message.content.length > 0))
  assert.ok(handoff.characterCount <= 40)
  assert.ok(handoff.estimatedTokens <= 10)
  assert.equal(handoff.truncatedMessages, 3)
})

test('token telemetry reports numeric savings without accepting content', () => {
  const telemetry = calculateTokenSavings({
    route: 'cloud',
    reason: 'local-validation-failed',
    baselineCloudInputTokens: 1_000,
    baselineCloudOutputTokens: 500,
    actualCloudInputTokens: 300,
    actualCloudOutputTokens: 200,
    localInputTokens: 800,
    localOutputTokens: 100
  })

  assert.deepEqual(telemetry, {
    route: 'cloud',
    reason: 'local-validation-failed',
    baselineCloudTokens: 1_500,
    actualCloudTokens: 500,
    localTokens: 900,
    cloudTokensSaved: 1_000,
    savingsRate: 2 / 3
  })
  assert.equal(
    Object.values(telemetry).some(value => typeof value === 'string' && value.includes('prompt')),
    false
  )
})

test('token-weighted benchmark fixture clears the 60% estimated cloud-savings gate', () => {
  const corpus: Array<{ classification: RequestClassification; baselineCloudTokens: number }> = [
    { classification: request, baselineCloudTokens: 420 },
    { classification: { ...request, estimatedContextTokens: 500 }, baselineCloudTokens: 610 },
    { classification: { ...request, requiredTools: [] }, baselineCloudTokens: 380 },
    { classification: { ...request, estimatedContextTokens: 4_000 }, baselineCloudTokens: 4_240 },
    { classification: { ...request, sensitivity: 'confidential' }, baselineCloudTokens: 900 },
    { classification: { ...request, estimatedContextTokens: 7_500 }, baselineCloudTokens: 7_740 },
    { classification: { ...request, requiredTools: ['read_file'] }, baselineCloudTokens: 1_180 },
    { classification: { ...request, modality: 'image' }, baselineCloudTokens: 1_900 },
    { classification: { ...request, explicitFrontier: true }, baselineCloudTokens: 2_600 },
    { classification: { ...request, estimatedContextTokens: 6_000 }, baselineCloudTokens: 6_240 }
  ]

  const routed = corpus.map(item => ({
    ...item,
    decision: decideInitialRoute('local-first', item.classification, capabilities)
  }))

  const actualCloudTokens = routed
    .filter(item => item.decision.route === 'cloud')
    .reduce((sum, item) => sum + item.baselineCloudTokens, 0)

  const eligibleBaselineTokens = routed
    .filter(item => item.decision.route !== 'blocked')
    .reduce((sum, item) => sum + item.baselineCloudTokens, 0)

  const savingsRate = 1 - actualCloudTokens / eligibleBaselineTokens

  assert.ok(routed.filter(item => item.decision.route === 'local').length >= 7)
  assert.ok(savingsRate >= 0.6, `expected >=60% cloud-token savings, received ${savingsRate * 100}%`)
})
