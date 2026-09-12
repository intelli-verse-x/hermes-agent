import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalizeQuizverseProductRequest,
  isQuizverseWordsCacheFresh,
  quizverseWordsCacheExpiry
} from './qv-product-proxy'

test('canonicalizes exact QuizVerse product method and path templates', () => {
  assert.deepEqual(canonicalizeQuizverseProductRequest('/notes/note-1/chat?stream=1', 'POST'), {
    method: 'POST',
    requestPath: '/notes/note-1/chat?stream=1',
    requiresAuth: true,
    requiresConfirmation: false,
    url: 'https://ai.intelli-verse-x.ai/api/ai/notes/note-1/chat?stream=1'
  })
  assert.equal(canonicalizeQuizverseProductRequest('/flashcards/srs/queue', 'GET').requestPath, '/flashcards/srs/queue')
  assert.equal(
    canonicalizeQuizverseProductRequest('/flashcards/card-1/review', 'POST').requestPath,
    '/flashcards/card-1/review'
  )
  assert.deepEqual(canonicalizeQuizverseProductRequest('/notes/note-1', 'PUT'), {
    method: 'PUT',
    requestPath: '/notes/note-1',
    requiresAuth: true,
    requiresConfirmation: false,
    url: 'https://ai.intelli-verse-x.ai/api/ai/notes/note-1'
  })
  assert.equal(
    canonicalizeQuizverseProductRequest('/ai-voice/sessions/session-1/audio/commit', 'POST').requestPath,
    '/ai-voice/sessions/session-1/audio/commit'
  )
  assert.deepEqual(canonicalizeQuizverseProductRequest('/api/words/daily?mode=spell&skin=gre-easy', 'GET'), {
    method: 'GET',
    requestPath: '/api/words/daily?mode=spell&skin=gre-easy',
    requiresAuth: false,
    requiresConfirmation: false,
    url: 'https://quizverse.world/api/words/daily?mode=spell&skin=gre-easy'
  })
  assert.deepEqual(canonicalizeQuizverseProductRequest('/api/words/content/manifest', 'GET'), {
    method: 'GET',
    requestPath: '/api/words/content/manifest',
    requiresAuth: false,
    requiresConfirmation: false,
    url: 'https://quizverse.world/api/words/content/manifest'
  })
  assert.deepEqual(canonicalizeQuizverseProductRequest('/api/lap/notes/create', 'POST'), {
    method: 'POST',
    requestPath: '/api/lap/notes/create',
    requiresAuth: true,
    requiresConfirmation: false,
    url: 'https://quizverse.world/api/lap/notes/create'
  })
  assert.equal(
    canonicalizeQuizverseProductRequest('/notes/chat/chat-1/stream?message=hello', 'GET').requestPath,
    '/notes/chat/chat-1/stream?message=hello'
  )
})

test('confirms only destructive, spend, and external-write product actions', () => {
  assert.equal(canonicalizeQuizverseProductRequest('/flashcards/card-1/review', 'POST').requiresConfirmation, false)
  assert.equal(canonicalizeQuizverseProductRequest('/notes/note-1/speed-reading', 'POST').requiresConfirmation, false)
  assert.equal(
    canonicalizeQuizverseProductRequest('/notes/note-1/generate-figurine', 'POST').requiresConfirmation,
    false
  )
  assert.equal(canonicalizeQuizverseProductRequest('/notes/note-1', 'DELETE').requiresConfirmation, true)
  assert.equal(canonicalizeQuizverseProductRequest('/note-share', 'POST').requiresConfirmation, true)
  assert.equal(canonicalizeQuizverseProductRequest('/api/stripe/voyage/checkout', 'POST').requiresConfirmation, true)
})

test('uses the implemented Voyage checkout route and rejects fictional verification routes', () => {
  assert.deepEqual(canonicalizeQuizverseProductRequest('/api/stripe/voyage/checkout', 'POST'), {
    method: 'POST',
    requestPath: '/api/stripe/voyage/checkout',
    requiresAuth: true,
    requiresConfirmation: true,
    url: 'https://quizverse.world/api/stripe/voyage/checkout'
  })
  assert.throws(() => canonicalizeQuizverseProductRequest('/api/voyage/checkout/session', 'POST'), /not allowed/)
  assert.throws(() => canonicalizeQuizverseProductRequest('/api/voyage/checkout/verify', 'POST'), /not allowed/)
})

test('enforces manifest and immutable dataset cache expiry', () => {
  const savedAt = Date.parse('2026-07-13T00:00:00.000Z')

  const manifestExpiry = quizverseWordsCacheExpiry(
    '/api/words/content/manifest',
    JSON.stringify({
      cache_max_age_seconds: 300,
      expires_at: '2026-07-14T00:00:00.000Z'
    }),
    savedAt
  )

  assert.equal(manifestExpiry, savedAt + 300_000)
  assert.equal(quizverseWordsCacheExpiry('/api/words/content/manifest', '{}', savedAt), 0)
  assert.ok(quizverseWordsCacheExpiry('/api/words/content/dataset-id', '[]', savedAt) > manifestExpiry)
  assert.equal(
    isQuizverseWordsCacheFresh(
      {
        body: '{}',
        contentType: 'application/json',
        etag: '"v1"',
        expiresAt: manifestExpiry,
        savedAt
      },
      manifestExpiry - 1
    ),
    true
  )
  assert.equal(
    isQuizverseWordsCacheFresh(
      {
        body: '{}',
        contentType: 'application/json',
        etag: '"v1"',
        expiresAt: manifestExpiry,
        savedAt
      },
      manifestExpiry
    ),
    false
  )
  assert.equal(
    isQuizverseWordsCacheFresh(
      {
        body: '{}',
        contentType: 'application/json',
        etag: '"v1"',
        expiresAt: savedAt,
        savedAt
      },
      savedAt - 1
    ),
    false
  )
})

test('rejects traversal, encoded bypasses, external URLs, and method mismatches', () => {
  for (const requestPath of [
    '/notes/../../admin',
    '/notes/%2e%2e/admin',
    '/notes/%252e%252e/admin',
    '/notes%2f..%2fadmin',
    '/notes\\..\\admin',
    '//evil.example/notes',
    'https://evil.example/notes'
  ]) {
    assert.throws(() => canonicalizeQuizverseProductRequest(requestPath, 'GET'), /not allowed|path syntax|traversal/)
  }

  assert.throws(() => canonicalizeQuizverseProductRequest('/flashcards/srs/queue', 'DELETE'), /method and path/)
  assert.throws(() => canonicalizeQuizverseProductRequest('/unknown', 'GET'), /method and path/)
})
