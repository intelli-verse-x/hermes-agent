import path from 'node:path'

export const QUIZVERSE_AI_ORIGIN = 'https://ai.intelli-verse-x.ai'
export const QUIZVERSE_AI_BASE_PATH = '/api/ai'
const IMMUTABLE_WORDS_CACHE_MS = 365 * 24 * 60 * 60 * 1000

interface ProductRoute {
  methods: readonly string[]
  path: RegExp
}

const PRODUCT_ROUTES: readonly ProductRoute[] = [
  { methods: ['GET', 'POST'], path: /^\/notes$/ },
  { methods: ['GET'], path: /^\/notes\/(?:recent|stats\/overview)$/ },
  { methods: ['DELETE', 'GET', 'PUT'], path: /^\/notes\/[^/]+$/ },
  { methods: ['GET'], path: /^\/notes\/jobs\/[^/]+\/status$/ },
  { methods: ['POST'], path: /^\/notes\/jobs\/[^/]+\/cancel$/ },
  { methods: ['GET'], path: /^\/notes\/[^/]+\/(?:debate-topics|recommended-content|with-chat)$/ },
  { methods: ['GET'], path: /^\/notes\/[^/]+\/figurine-prompt$/ },
  { methods: ['GET'], path: /^\/notes\/[^/]+\/explainer-status\/[^/]+$/ },
  {
    methods: ['POST'],
    path: /^\/notes\/[^/]+\/(?:audio-overview|chat|generate-all|generate-all\/async|generate-explainer-video|generate-figurine|generate-flashcards-quizzes|generate-music|microlearning|mindmap|speed-reading)$/
  },
  { methods: ['POST'], path: /^\/notes\/[^/]+\/debate\/(?:start|timed|rapid-fire|multi-round)$/ },
  { methods: ['POST'], path: /^\/notes\/[^/]+\/debate\/oxford\/start$/ },
  { methods: ['GET'], path: /^\/notes\/debate\/modes$/ },
  { methods: ['GET'], path: /^\/notes\/debate\/[^/]+\/(?:timed-status|oxford\/status)$/ },
  { methods: ['POST'], path: /^\/notes\/debate\/[^/]+\/(?:next-round|score|oxford\/advance-phase)$/ },
  { methods: ['POST'], path: /^\/notes\/[^/]+\/audiobook\/from-chunk$/ },
  { methods: ['GET'], path: /^\/notes\/chat\/[^/]+\/history$/ },
  { methods: ['GET', 'POST'], path: /^\/notes\/chat\/[^/]+\/stream$/ },
  { methods: ['GET'], path: /^\/notes\/graph$/ },
  { methods: ['POST'], path: /^\/notes\/graph\/build$/ },
  { methods: ['GET'], path: /^\/notes\/graph\/bridge-pairs$/ },
  { methods: ['POST'], path: /^\/notes\/graph\/(?:bridge-quiz|learning-path|readiness)$/ },
  { methods: ['POST'], path: /^\/notes\/multimedia\/v2\/(?:backfill-mine|chat)$/ },
  { methods: ['POST'], path: /^\/notes\/multimedia\/v2\/(?:chat|search)\/note\/[^/]+$/ },
  { methods: ['POST'], path: /^\/flashcards\/[^/]+\/review$/ },
  { methods: ['GET'], path: /^\/flashcards\/srs\/(?:queue|stats|mastery-by-note)$/ },
  { methods: ['POST'], path: /^\/flashcards\/srs\/(?:highlight-to-card|image-occlusion)$/ },
  { methods: ['GET'], path: /^\/learner\/streak$/ },
  {
    methods: ['POST'],
    path: /^\/learner\/(?:streak|note-microlearning|daily-microlearning|note-mind-map|user-mind-map|audio-overview|speed-reading)$/
  },
  { methods: ['GET', 'POST'], path: /^\/library$/ },
  { methods: ['DELETE', 'GET', 'PATCH'], path: /^\/library\/[^/]+$/ },
  { methods: ['GET', 'POST'], path: /^\/note-share$/ },
  { methods: ['DELETE', 'GET'], path: /^\/note-share\/[^/]+$/ },
  { methods: ['POST'], path: /^\/multimedia\/(?:chat-v2|search-v2|instant-quiz|battle-session)$/ },
  {
    methods: ['POST'],
    path: /^\/audiobook\/(?:create|daily-briefing|quiz-review|summary|url-digest|upsell-data|validate-purchase)$/
  },
  { methods: ['GET'], path: /^\/audiobook\/(?:products|social-proof)$/ },
  { methods: ['GET'], path: /^\/audiobook\/(?:status|stream|streaming-info|library|entitlement)\/[^/]+$/ },
  { methods: ['GET'], path: /^\/audiobook\/[^/]+$/ },
  { methods: ['POST'], path: /^\/audiobook\/[^/]+\/position$/ },
  { methods: ['GET'], path: /^\/figurine\/job\/[^/]+\/status$/ },
  { methods: ['POST'], path: /^\/unified-content\/(?:figurine|preview-figurine-prompt)$/ },
  { methods: ['GET'], path: /^\/unified-content\/status$/ },
  { methods: ['GET'], path: /^\/content-generation\/job\/[^/]+\/status$/ },
  { methods: ['GET'], path: /^\/ai-voice\/(?:personas|products|entitlements|warmup)$/ },
  { methods: ['POST'], path: /^\/ai-voice\/sessions$/ },
  { methods: ['DELETE', 'GET'], path: /^\/ai-voice\/sessions\/[^/]+$/ },
  { methods: ['GET'], path: /^\/ai-voice\/sessions\/[^/]+\/messages$/ },
  { methods: ['POST'], path: /^\/ai-voice\/sessions\/[^/]+\/(?:text|audio|trigger)$/ },
  { methods: ['POST'], path: /^\/ai-voice\/sessions\/[^/]+\/audio\/commit$/ }
]

export interface CanonicalProductRequest {
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
  requestPath: string
  requiresAuth: boolean
  requiresConfirmation: boolean
  url: string
}

export interface QuizverseWordsCacheRecord {
  body: string
  contentType: string
  etag: string
  expiresAt: number
  savedAt: number
}

export function quizverseWordsCacheExpiry(requestPath: string, body: string, savedAt: number): number {
  if (!Number.isFinite(savedAt) || savedAt <= 0) {
    return 0
  }

  if (requestPath === '/api/words/content/manifest') {
    try {
      const value = JSON.parse(body) as { cache_max_age_seconds?: unknown; expires_at?: unknown }
      const expiresAt = Date.parse(String(value.expires_at ?? ''))
      const cacheMaxAgeSeconds = Number(value.cache_max_age_seconds)

      const cacheExpiry =
        Number.isInteger(cacheMaxAgeSeconds) && cacheMaxAgeSeconds > 0 ? savedAt + cacheMaxAgeSeconds * 1000 : expiresAt

      return Number.isFinite(expiresAt) && expiresAt > savedAt ? Math.min(expiresAt, cacheExpiry) : 0
    } catch {
      return 0
    }
  }

  return savedAt + IMMUTABLE_WORDS_CACHE_MS
}

export function isQuizverseWordsCacheFresh(
  value: Partial<QuizverseWordsCacheRecord>,
  now = Date.now()
): value is QuizverseWordsCacheRecord {
  return (
    typeof value.body === 'string' &&
    typeof value.contentType === 'string' &&
    typeof value.etag === 'string' &&
    typeof value.savedAt === 'number' &&
    Number.isFinite(value.savedAt) &&
    value.savedAt <= now + 300_000 &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt) &&
    value.expiresAt > value.savedAt &&
    value.expiresAt > now
  )
}

export function requiresQuizverseProductConfirmation(
  method: CanonicalProductRequest['method'],
  requestPath: string
): boolean {
  if (method === 'DELETE' || /\/cancel$/.test(requestPath)) {
    return true
  }

  return (
    requestPath === '/note-share' ||
    requestPath === '/api/kyc/age/start' ||
    requestPath === '/api/stripe/voyage/checkout' ||
    requestPath === '/audiobook/validate-purchase'
  )
}

export function canonicalizeQuizverseProductRequest(rawPath: string, rawMethod = 'GET'): CanonicalProductRequest {
  const method = rawMethod.toUpperCase()

  if (!['DELETE', 'GET', 'PATCH', 'POST', 'PUT'].includes(method)) {
    throw new Error('QuizVerse product API method is not allowed')
  }

  if (!rawPath.startsWith('/') || rawPath.startsWith('//') || rawPath.includes('\\')) {
    throw new Error('QuizVerse product API path is not allowed')
  }

  let decoded = rawPath

  for (let pass = 0; pass < 3; pass += 1) {
    if (/%(?:2e|2f|5c|25)/i.test(decoded)) {
      throw new Error('QuizVerse product API path contains encoded path syntax')
    }

    const next = decodeURIComponent(decoded)

    if (next === decoded) {
      break
    }

    decoded = next
  }

  const requestUrl = new URL(decoded, `${QUIZVERSE_AI_ORIGIN}/`)

  if (requestUrl.origin !== QUIZVERSE_AI_ORIGIN || requestUrl.username || requestUrl.password || requestUrl.hash) {
    throw new Error('QuizVerse product API URL is not allowed')
  }

  const rawPathname = decoded.split('?')[0]
  const normalizedPath = path.posix.normalize(rawPathname)

  if (
    normalizedPath !== rawPathname ||
    requestUrl.pathname !== rawPathname ||
    !normalizedPath.startsWith('/') ||
    normalizedPath.includes('/../')
  ) {
    throw new Error('QuizVerse product API path traversal is not allowed')
  }

  const requestPath = normalizedPath

  if (
    requestPath === '/api/words/daily' ||
    requestPath === '/api/voyage/tier' ||
    requestPath === '/api/words/content/manifest' ||
    /^\/api\/words\/content\/[A-Za-z0-9._-]+$/.test(requestPath) ||
    requestPath === '/quizverse-words-guess-5.json' ||
    requestPath === '/quizverse-words-spell-dict.json'
  ) {
    if (method !== 'GET') {
      throw new Error('QuizVerse product API method and path are not allowed')
    }

    return {
      method: 'GET',
      requestPath: `${requestPath}${requestUrl.search}`,
      requiresAuth: false,
      requiresConfirmation: false,
      url: new URL(`${requestPath}${requestUrl.search}`, 'https://quizverse.world').toString()
    }
  }

  if (
    requestPath === '/api/lap/notes/create' ||
    requestPath === '/api/kyc/age/start' ||
    requestPath === '/api/stripe/voyage/checkout'
  ) {
    if (method !== 'POST') {
      throw new Error('QuizVerse product API method and path are not allowed')
    }

    return {
      method: 'POST',
      requestPath,
      requiresAuth: true,
      requiresConfirmation: requiresQuizverseProductConfirmation('POST', requestPath),
      url: new URL(requestPath, 'https://quizverse.world').toString()
    }
  }

  const allowed = PRODUCT_ROUTES.some(route => route.methods.includes(method) && route.path.test(requestPath))

  if (!allowed) {
    throw new Error('QuizVerse product API method and path are not allowed')
  }

  const url = new URL(`${QUIZVERSE_AI_BASE_PATH}${requestPath}${requestUrl.search}`, QUIZVERSE_AI_ORIGIN)

  return {
    method: method as CanonicalProductRequest['method'],
    requestPath: `${requestPath}${url.search}`,
    requiresAuth: true,
    requiresConfirmation: requiresQuizverseProductConfirmation(
      method as CanonicalProductRequest['method'],
      requestPath
    ),
    url: url.toString()
  }
}
