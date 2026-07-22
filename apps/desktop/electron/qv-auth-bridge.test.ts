import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import {
  beginQuizverseOAuth,
  completeQuizverseOAuth,
  refreshQuizverseOAuthTokens,
  verifyQuizverseIdToken
} from './qv-auth-bridge'

function jwt(claims: Record<string, unknown>): string {
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`
}

test('builds a Cognito PKCE authorization request without exposing tokens', () => {
  const config = {
    clientId: 'desktop-client',
    domain: 'auth.quizverse.world',
    redirectUri: 'quizverse://auth/callback'
  }

  const started = beginQuizverseOAuth(config)
  const url = new URL(started.url)

  assert.equal(url.origin, 'https://auth.quizverse.world')
  assert.equal(url.searchParams.get('client_id'), 'desktop-client')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri)
  assert.ok(url.searchParams.get('code_challenge'))
  assert.ok(started.pending.codeVerifier)
  assert.ok(started.pending.nonce)
  assert.equal(url.searchParams.get('nonce'), started.pending.nonce)
  assert.ok(started.pending.state)
  assert.equal(started.url.includes(started.pending.codeVerifier), false)
})

test('exchanges callback, authenticates Cognito Nakama identity, and merges guest', async () => {
  const config = {
    clientId: 'desktop-client',
    domain: 'auth.quizverse.world',
    redirectUri: 'quizverse://auth/callback'
  }

  const started = beginQuizverseOAuth(config)
  const merged: unknown[] = []

  const result = await completeQuizverseOAuth({
    authenticateNakama: async (sub, username) => ({
      refreshToken: 'nakama-refresh',
      token: 'nakama-token',
      userId: sub,
      username
    }),
    callbackUrl: `${config.redirectUri}?code=fixture-code&state=${started.pending.state}`,
    config,
    exchangeCode: async request => {
      assert.equal(request.codeVerifier, started.pending.codeVerifier)

      return {
        accessToken: 'cognito-access',
        idToken: jwt({ 'cognito:username': 'Ada', sub: 'cognito-user-1' }),
        refreshToken: 'cognito-refresh'
      }
    },
    mergeGuest: async (...args) => {
      merged.push(args)
    },
    pending: started.pending,
    previousGuestUserId: 'guest-user-1',
    verifyIdToken: async token => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'))
  })

  assert.equal(result.nakama.userId, 'cognito-user-1')
  assert.equal(result.nakama.username, 'Ada')
  assert.deepEqual(merged, [['guest-user-1', 'cognito-user-1', 'cognito-access']])
})

test('rejects callback state and URI mismatches before token exchange', async () => {
  const config = {
    clientId: 'desktop-client',
    domain: 'auth.quizverse.world',
    redirectUri: 'quizverse://auth/callback'
  }

  const started = beginQuizverseOAuth(config)
  let exchanges = 0

  const common = {
    authenticateNakama: async () => {
      throw new Error('unreachable')
    },
    config,
    exchangeCode: async () => {
      exchanges += 1
      throw new Error('unreachable')
    },
    mergeGuest: async () => undefined,
    pending: started.pending,
    previousGuestUserId: '',
    verifyIdToken: async () => {
      throw new Error('unreachable')
    }
  }

  await assert.rejects(
    completeQuizverseOAuth({
      ...common,
      callbackUrl: `${config.redirectUri}?code=fixture&state=wrong`
    }),
    /state/
  )
  await assert.rejects(
    completeQuizverseOAuth({
      ...common,
      callbackUrl: `quizverse://other/callback?code=fixture&state=${started.pending.state}`
    }),
    /URI/
  )
  assert.equal(exchanges, 0)
})

test('verifies OIDC issuer, audience, expiry, nonce, and RSA signature', async t => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = publicKey.export({ format: 'jwk' })
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture-key', typ: 'JWT' })).toString('base64url')

  const claims = {
    aud: 'desktop-client',
    exp: now + 300,
    iss: 'https://issuer.quizverse.test',
    nonce: 'fixture-nonce',
    sub: 'user-1',
    token_use: 'id'
  }

  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')
  const token = `${header}.${payload}.${signature}`
  const originalFetch = globalThis.fetch

  t.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = (async input => {
    const url = String(input)

    if (url.endsWith('/.well-known/openid-configuration')) {
      return new Response(
        JSON.stringify({
          authorization_endpoint: 'https://auth.quizverse.test/oauth2/authorize',
          issuer: claims.iss,
          jwks_uri: 'https://issuer.quizverse.test/.well-known/jwks.json',
          token_endpoint: 'https://auth.quizverse.test/oauth2/token'
        })
      )
    }

    return new Response(
      JSON.stringify({
        keys: [{ ...jwk, kid: 'fixture-key', use: 'sig' }]
      })
    )
  }) as typeof fetch

  await assert.doesNotReject(
    verifyQuizverseIdToken(token, {
      clientId: 'desktop-client',
      domain: 'auth.quizverse.test',
      issuer: claims.iss,
      nonce: 'fixture-nonce',
      now
    })
  )
  await assert.rejects(
    verifyQuizverseIdToken(token, {
      clientId: 'other-client',
      domain: 'auth.quizverse.test',
      issuer: claims.iss,
      nonce: 'fixture-nonce',
      now
    }),
    /claims/
  )
})

test('refreshes Cognito tokens with the stored refresh grant', async t => {
  const originalFetch = globalThis.fetch

  t.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = (async (_input, init) => {
    assert.equal(init?.method, 'POST')
    assert.match(String(init?.body), /grant_type=refresh_token/)
    assert.match(String(init?.body), /refresh_token=stored-refresh/)

    return new Response(
      JSON.stringify({
        access_token: 'fresh-access',
        id_token: 'fresh-id'
      })
    )
  }) as typeof fetch

  assert.deepEqual(
    await refreshQuizverseOAuthTokens({
      clientId: 'desktop-client',
      domain: 'auth.quizverse.test',
      refreshToken: 'stored-refresh'
    }),
    {
      accessToken: 'fresh-access',
      idToken: 'fresh-id',
      refreshToken: 'stored-refresh'
    }
  )
})
