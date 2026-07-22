import crypto from 'node:crypto'

export interface QuizverseOAuthConfig {
  clientId: string
  domain: string
  issuer?: string
  redirectUri: string
}

export interface QuizverseOAuthPending {
  codeVerifier: string
  nonce: string
  state: string
}

export interface QuizverseOAuthTokens {
  accessToken: string
  idToken: string
  refreshToken: string
}

export interface QuizverseNakamaSession {
  refreshToken: string
  token: string
  userId: string
  username: string
}

export interface CompleteQuizverseOAuthOptions {
  authenticateNakama: (cognitoSub: string, username: string) => Promise<QuizverseNakamaSession>
  callbackUrl: string
  config: QuizverseOAuthConfig
  exchangeCode: (request: {
    clientId: string
    code: string
    codeVerifier: string
    domain: string
    issuer?: string
    redirectUri: string
  }) => Promise<QuizverseOAuthTokens>
  mergeGuest: (ghostUserId: string, cognitoSub: string, accessToken: string) => Promise<void>
  pending: QuizverseOAuthPending
  previousGuestUserId: string
  verifyIdToken: typeof verifyQuizverseIdToken
}

function base64url(value: Buffer): string {
  return value.toString('base64url')
}

export function beginQuizverseOAuth(config: QuizverseOAuthConfig): {
  pending: QuizverseOAuthPending
  url: string
} {
  const codeVerifier = base64url(crypto.randomBytes(48))
  const nonce = base64url(crypto.randomBytes(32))
  const state = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest())
  const url = new URL('/oauth2/authorize', normalizeDomain(config.domain))
  url.search = new URLSearchParams({
    client_id: config.clientId,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state
  }).toString()

  return { pending: { codeVerifier, nonce, state }, url: url.toString() }
}

export async function completeQuizverseOAuth(
  options: CompleteQuizverseOAuthOptions
): Promise<{ nakama: QuizverseNakamaSession; tokens: QuizverseOAuthTokens }> {
  const callback = new URL(options.callbackUrl)

  if (callback.toString().split('?')[0] !== options.config.redirectUri) {
    throw new Error('QuizVerse OAuth callback URI does not match')
  }

  if (callback.searchParams.get('state') !== options.pending.state) {
    throw new Error('QuizVerse OAuth state does not match')
  }

  const code = callback.searchParams.get('code')

  if (!code) {
    throw new Error(callback.searchParams.get('error_description') || 'QuizVerse OAuth code is missing')
  }

  const tokens = await options.exchangeCode({
    clientId: options.config.clientId,
    code,
    codeVerifier: options.pending.codeVerifier,
    domain: options.config.domain,
    issuer: options.config.issuer,
    redirectUri: options.config.redirectUri
  })

  const claims = await options.verifyIdToken(tokens.idToken, {
    clientId: options.config.clientId,
    domain: options.config.domain,
    nonce: options.pending.nonce
  })

  const cognitoSub = String(claims.sub ?? '')

  if (!cognitoSub) {
    throw new Error('Cognito identity token has no subject')
  }

  const username = String(claims['cognito:username'] ?? claims.email ?? cognitoSub)
  const nakama = await options.authenticateNakama(cognitoSub, username)

  if (options.previousGuestUserId && options.previousGuestUserId !== nakama.userId) {
    await options.mergeGuest(options.previousGuestUserId, cognitoSub, tokens.accessToken)
  }

  return { nakama, tokens }
}

interface VerifyIdTokenOptions {
  clientId: string
  domain: string
  issuer?: string
  nonce?: string
  now?: number
}

interface OidcDiscovery {
  authorization_endpoint: string
  issuer: string
  jwks_uri: string
  token_endpoint: string
}

function decodeJwtPart(token: string, index: number): Record<string, unknown> {
  const value = token.split('.')[index]

  if (!value) {
    throw new Error('Cognito token is malformed')
  }

  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
}

export async function verifyQuizverseIdToken(
  token: string,
  options: VerifyIdTokenOptions
): Promise<Record<string, unknown>> {
  const domain = normalizeDomain(options.domain)
  const issuer = normalizeDomain(options.issuer ?? options.domain)

  const discoveryResponse = await fetch(new URL('/.well-known/openid-configuration', issuer), {
    signal: AbortSignal.timeout(12_000)
  })

  if (!discoveryResponse.ok) {
    throw new Error(`Cognito OIDC discovery failed (${discoveryResponse.status})`)
  }

  const discovery = (await discoveryResponse.json()) as Partial<OidcDiscovery>

  if (
    !discovery.issuer ||
    !discovery.jwks_uri ||
    !discovery.authorization_endpoint ||
    !discovery.token_endpoint ||
    new URL(discovery.authorization_endpoint).origin !== new URL(domain).origin ||
    new URL(discovery.jwks_uri).protocol !== 'https:' ||
    new URL(discovery.token_endpoint).protocol !== 'https:'
  ) {
    throw new Error('Cognito OIDC discovery document is invalid')
  }

  const header = decodeJwtPart(token, 0)
  const claims = decodeJwtPart(token, 1)

  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new Error('Cognito identity token algorithm is not allowed')
  }

  const jwksResponse = await fetch(discovery.jwks_uri, { signal: AbortSignal.timeout(12_000) })

  if (!jwksResponse.ok) {
    throw new Error(`Cognito JWKS fetch failed (${jwksResponse.status})`)
  }

  const jwks = (await jwksResponse.json()) as { keys?: Array<Record<string, unknown>> }
  const jwk = jwks.keys?.find(key => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig')

  if (!jwk) {
    throw new Error('Cognito identity token signing key was not found')
  }

  const [encodedHeader, encodedPayload, signature] = token.split('.')

  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    crypto.createPublicKey({ format: 'jwk', key: jwk as crypto.JsonWebKey }),
    Buffer.from(signature ?? '', 'base64url')
  )

  if (!verified) {
    throw new Error('Cognito identity token signature is invalid')
  }

  const now = options.now ?? Math.floor(Date.now() / 1000)
  const audience = claims.aud

  const audienceMatches =
    audience === options.clientId || (Array.isArray(audience) && audience.includes(options.clientId))

  if (
    discovery.issuer !== issuer.replace(/\/$/, '') ||
    claims.iss !== discovery.issuer ||
    !audienceMatches ||
    typeof claims.exp !== 'number' ||
    claims.exp <= now ||
    (options.nonce !== undefined && claims.nonce !== options.nonce) ||
    (claims.token_use !== undefined && claims.token_use !== 'id')
  ) {
    throw new Error('Cognito identity token claims are invalid')
  }

  return claims
}

export async function refreshQuizverseOAuthTokens(request: {
  clientId: string
  domain: string
  refreshToken: string
}): Promise<QuizverseOAuthTokens> {
  const response = await fetch(new URL('/oauth2/token', normalizeDomain(request.domain)), {
    body: new URLSearchParams({
      client_id: request.clientId,
      grant_type: 'refresh_token',
      refresh_token: request.refreshToken
    }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    signal: AbortSignal.timeout(12_000)
  })

  const body = (await response.json()) as Record<string, unknown>

  if (!response.ok) {
    throw new Error(String(body.error_description ?? body.error ?? `Cognito token refresh failed (${response.status})`))
  }

  return {
    accessToken: String(body.access_token ?? ''),
    idToken: String(body.id_token ?? ''),
    refreshToken: String(body.refresh_token ?? request.refreshToken)
  }
}

export async function exchangeQuizverseOAuthCode(
  request: Parameters<CompleteQuizverseOAuthOptions['exchangeCode']>[0]
): Promise<QuizverseOAuthTokens> {
  const response = await fetch(new URL('/oauth2/token', normalizeDomain(request.domain)), {
    body: new URLSearchParams({
      client_id: request.clientId,
      code: request.code,
      code_verifier: request.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: request.redirectUri
    }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    signal: AbortSignal.timeout(12_000)
  })

  const body = (await response.json()) as Record<string, unknown>

  if (!response.ok) {
    throw new Error(
      String(body.error_description ?? body.error ?? `Cognito token exchange failed (${response.status})`)
    )
  }

  return {
    accessToken: String(body.access_token ?? ''),
    idToken: String(body.id_token ?? ''),
    refreshToken: String(body.refresh_token ?? '')
  }
}

function normalizeDomain(domain: string): string {
  const value = domain.startsWith('https://') ? domain : `https://${domain}`
  const url = new URL(value)

  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('QuizVerse Cognito domain must be HTTPS')
  }

  return `${url.origin}/`
}
