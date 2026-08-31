/**
 * Tests for electron/qv-deeptutor.ts — the QuizVerse DeepTutor supervisor's
 * settings store (defaults, secret round-trip, input sanitizing, renderer
 * projection) and URL derivation for local vs remote mode.
 *
 * Run with: node --test electron/qv-deeptutor.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  allocateFreePort,
  configuredTutorExecutable,
  deepTutorApiUrl,
  deeptutorBinPath,
  deepTutorWebUrl,
  DEFAULT_QUIZVERSE_SETTINGS,
  findPythonInterpreter,
  injectTutorXLitellmConfig,
  killTutorProcessTree,
  managedLocalCommand,
  parsePythonVersion,
  probeDeepTutorApi,
  pythonMeetsFloor,
  quizverseSettingsForRenderer,
  readQuizverseSettings,
  sanitizeQuizverseSettingsInput,
  writeQuizverseSettings
} from './qv-deeptutor'

// Same envelope shape as main.ts's safeStorage helpers, minus the encryption.
const encryptSecret = (value: string) => ({ encoding: 'plain', value })

test('managed command quotes paths containing spaces', () => {
  assert.equal(
    managedLocalCommand('C:\\Program Files\\QuizVerse\\TutorX\\deeptutor.exe'),
    '"C:\\Program Files\\QuizVerse\\TutorX\\deeptutor.exe" start'
  )
})

test('managed executable parsing and platform path shapes are stable', () => {
  const root = path.join('tmp', 'Quiz Verse', 'runtime')

  assert.equal(
    configuredTutorExecutable(`"${path.join(root, 'bin', 'deeptutor')}" start`),
    path.join(root, 'bin', 'deeptutor')
  )
  assert.equal(deeptutorBinPath(root, 'darwin'), path.join(root, 'bin', 'deeptutor'))
  assert.equal(deeptutorBinPath(root, 'linux'), path.join(root, 'bin', 'deeptutor'))
  assert.equal(deeptutorBinPath(root, 'win32'), path.join(root, 'Scripts', 'deeptutor.exe'))
})

test('Windows process shutdown uses taskkill descendant-tree flags', () => {
  const calls: unknown[][] = []

  const fakeSpawn = ((...args: unknown[]) => {
    calls.push(args)

    return { on: () => {} }
  }) as never

  killTutorProcessTree({ kill: () => true, pid: 42 }, 'win32', fakeSpawn)
  assert.deepEqual(calls[0]?.slice(0, 2), ['taskkill.exe', ['/PID', '42', '/T', '/F']])
})

const decryptSecret = (secret: unknown) =>
  secret && typeof secret === 'object' ? String((secret as { value?: string }).value || '') : ''

function tmpSettingsPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qv-settings-')), 'quizverse.json')
}

test('readQuizverseSettings: missing/corrupt file falls back to defaults', () => {
  assert.deepEqual(readQuizverseSettings('/nonexistent/quizverse.json', decryptSecret), DEFAULT_QUIZVERSE_SETTINGS)

  const filePath = tmpSettingsPath()

  fs.writeFileSync(filePath, 'not json', 'utf8')
  assert.deepEqual(readQuizverseSettings(filePath, decryptSecret), DEFAULT_QUIZVERSE_SETTINGS)
})

test('write/read round-trip preserves settings and the secret survives the envelope', () => {
  const filePath = tmpSettingsPath()

  const settings = {
    tutorMode: 'remote' as const,
    remoteUrl: 'https://tutor.example.com',
    localCommand: 'npm run dev',
    localDirectory: '/opt/deeptutor',
    apiPort: 9001,
    webPort: 4000,
    apiKey: 'sk-secret',
    litellmUrl: DEFAULT_QUIZVERSE_SETTINGS.litellmUrl,
    litellmKey: '',
    cognitoDomain: 'auth.quizverse.world',
    cognitoClientId: 'desktop-client',
    cognitoIssuer: 'https://cognito-idp.us-east-1.amazonaws.com/pool'
  }

  writeQuizverseSettings(filePath, settings, encryptSecret)

  // The raw key never persists in cleartext at the settings key.
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))

  assert.notEqual(raw.apiKey, 'sk-secret')

  assert.deepEqual(readQuizverseSettings(filePath, decryptSecret), settings)
})

test('readQuizverseSettings: clamps out-of-range ports back to defaults', () => {
  const filePath = tmpSettingsPath()

  fs.writeFileSync(filePath, JSON.stringify({ tutorMode: 'local', apiPort: -5, webPort: 700000 }), 'utf8')

  const settings = readQuizverseSettings(filePath, decryptSecret)

  assert.equal(settings.apiPort, DEFAULT_QUIZVERSE_SETTINGS.apiPort)
  assert.equal(settings.webPort, DEFAULT_QUIZVERSE_SETTINGS.webPort)
})

test('ports: default is auto (0), explicit ports round-trip, 0 stays auto', () => {
  // Dynamic allocation is the default posture — no fixed 8001/3782.
  assert.equal(DEFAULT_QUIZVERSE_SETTINGS.apiPort, 0)
  assert.equal(DEFAULT_QUIZVERSE_SETTINGS.webPort, 0)

  const explicit = sanitizeQuizverseSettingsInput({ apiPort: 9001, webPort: 4000 }, DEFAULT_QUIZVERSE_SETTINGS)

  assert.equal(explicit.apiPort, 9001)
  assert.equal(explicit.webPort, 4000)

  // Switching back to auto is expressible from the renderer.
  const backToAuto = sanitizeQuizverseSettingsInput({ apiPort: 0, webPort: 0 }, explicit)

  assert.equal(backToAuto.apiPort, 0)
  assert.equal(backToAuto.webPort, 0)
})

test('allocateFreePort returns a bindable ephemeral port', async () => {
  const port = await allocateFreePort()

  assert.ok(port > 0 && port < 65536)
})

test('sanitizeQuizverseSettingsInput: partial input merges over current settings', () => {
  const current = { ...DEFAULT_QUIZVERSE_SETTINGS, apiKey: 'kept-key' }
  const next = sanitizeQuizverseSettingsInput({ tutorMode: 'remote', webPort: 4321 }, current)

  assert.equal(next.tutorMode, 'remote')
  assert.equal(next.webPort, 4321)
  assert.equal(next.apiPort, current.apiPort)
  assert.equal(next.localCommand, current.localCommand)
  assert.equal(next.apiKey, 'kept-key')
})

test('sanitizeQuizverseSettingsInput: garbage input keeps current values', () => {
  const current = { ...DEFAULT_QUIZVERSE_SETTINGS, tutorMode: 'remote' as const }

  assert.deepEqual(sanitizeQuizverseSettingsInput(null, current), current)

  const next = sanitizeQuizverseSettingsInput({ tutorMode: 'bogus', apiPort: 'nope' }, current)

  assert.equal(next.tutorMode, 'remote')
  assert.equal(next.apiPort, current.apiPort)
})

test('quizverseSettingsForRenderer: never exposes the raw API key', () => {
  const withKey = quizverseSettingsForRenderer({ ...DEFAULT_QUIZVERSE_SETTINGS, apiKey: 'sk-secret' })

  assert.equal(withKey.apiKeySet, true)
  assert.equal('apiKey' in withKey, false)
  assert.equal(JSON.stringify(withKey).includes('sk-secret'), false)

  const withoutKey = quizverseSettingsForRenderer(DEFAULT_QUIZVERSE_SETTINGS)

  assert.equal(withoutKey.apiKeySet, false)
})

test('quizverseSettingsForRenderer: never exposes the raw LiteLLM key', () => {
  const withKey = quizverseSettingsForRenderer({
    ...DEFAULT_QUIZVERSE_SETTINGS,
    litellmKey: 'sk-litellm'
  })

  assert.equal(withKey.litellmKeySet, true)
  assert.equal('litellmKey' in withKey, false)
  assert.equal(JSON.stringify(withKey).includes('sk-litellm'), false)
})

test('injectTutorXLitellmConfig: writes model_catalog.json with OpenAI binding', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'qv-litellm-'))

  injectTutorXLitellmConfig(workspace, 'https://litellm.example.com', 'sk-test')

  const catalogPath = path.join(workspace, 'data', 'user', 'settings', 'model_catalog.json')
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  const llm = catalog.services.llm

  assert.equal(llm.active_profile_id, 'qv-litellm')
  assert.equal(llm.profiles[0].binding, 'openai')
  assert.equal(llm.profiles[0].base_url, 'https://litellm.example.com/v1')
  assert.equal(llm.profiles[0].api_key, 'sk-test')
})

test('write/read round-trip preserves litellm settings and secret envelope', () => {
  const filePath = tmpSettingsPath()

  const settings = {
    ...DEFAULT_QUIZVERSE_SETTINGS,
    litellmUrl: 'https://litellm.custom.example',
    litellmKey: 'sk-litellm-secret'
  }

  writeQuizverseSettings(filePath, settings, encryptSecret)

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))

  assert.notEqual(raw.litellmKey, 'sk-litellm-secret')

  const loaded = readQuizverseSettings(filePath, decryptSecret)

  assert.equal(loaded.litellmUrl, settings.litellmUrl)
  assert.equal(loaded.litellmKey, settings.litellmKey)
})

test('URL derivation: local mode targets loopback ports, remote mode the hosted origin', () => {
  const local = { ...DEFAULT_QUIZVERSE_SETTINGS, apiPort: 9001, webPort: 4000 }

  assert.equal(deepTutorWebUrl(local), 'http://127.0.0.1:4000')
  assert.equal(deepTutorApiUrl(local), 'http://127.0.0.1:9001')

  const remote = { ...local, tutorMode: 'remote' as const, remoteUrl: 'https://tutor.example.com///' }

  assert.equal(deepTutorWebUrl(remote), 'https://tutor.example.com')
  assert.equal(deepTutorApiUrl(remote), 'https://tutor.example.com')
})

test('URL derivation: auto ports are unknown until spawn, then the active port wins', () => {
  // Auto ports (0) → no URL before the supervisor has resolved ports.
  assert.equal(deepTutorWebUrl(DEFAULT_QUIZVERSE_SETTINGS), '')
  assert.equal(deepTutorApiUrl(DEFAULT_QUIZVERSE_SETTINGS), '')

  // The dynamically-allocated port takes over once the servers spawn.
  assert.equal(deepTutorWebUrl(DEFAULT_QUIZVERSE_SETTINGS, 49321), 'http://127.0.0.1:49321')
  assert.equal(deepTutorApiUrl(DEFAULT_QUIZVERSE_SETTINGS, 49322), 'http://127.0.0.1:49322')
})

test('probeDeepTutorApi: adopts only a real DeepTutor API root', async () => {
  const respond = (payload: string, contentType = 'application/json') =>
    new Promise<{ close: () => void; url: string }>(resolve => {
      const server = http.createServer((_req, res) => {
        res.setHeader('content-type', contentType)
        res.end(payload)
      })

      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as { port: number }

        resolve({ close: () => server.close(), url: `http://127.0.0.1:${port}` })
      })
    })

  // Real DeepTutor identity payload → adopt.
  const deeptutor = await respond(JSON.stringify({ message: 'Welcome to DeepTutor API' }))

  assert.equal(await probeDeepTutorApi(deeptutor.url), true)
  deeptutor.close()

  // Some other JSON service on the port → do NOT adopt.
  const stranger = await respond(JSON.stringify({ message: 'hello from some other app' }))

  assert.equal(await probeDeepTutorApi(stranger.url), false)
  stranger.close()

  // Non-JSON listener (dev server, docs page, …) → do NOT adopt.
  const html = await respond('<html>hi</html>', 'text/html')

  assert.equal(await probeDeepTutorApi(html.url), false)
  html.close()

  // Nothing listening at all → false, no throw.
  const idle = await allocateFreePort()

  assert.equal(await probeDeepTutorApi(`http://127.0.0.1:${idle}`), false)
})

test('managed install helpers: python floor, entry-point paths, quoted command', async () => {
  assert.deepEqual(parsePythonVersion('Python 3.12.4'), [3, 12])
  assert.equal(parsePythonVersion('zsh: command not found: python3'), null)

  assert.equal(pythonMeetsFloor([3, 11]), true)
  assert.equal(pythonMeetsFloor([3, 10]), false)
  assert.equal(pythonMeetsFloor([4, 0]), true)
  assert.equal(pythonMeetsFloor(null), false)

  assert.equal(deeptutorBinPath('/venv', 'linux'), path.join('/venv', 'bin', 'deeptutor'))
  assert.equal(deeptutorBinPath('C:\\venv', 'win32'), path.join('C:\\venv', 'Scripts', 'deeptutor.exe'))

  // Spaces in userData paths must survive the shell:true spawn.
  assert.equal(
    managedLocalCommand('/Users/x/Library/App Support/deeptutor/venv/bin/deeptutor'),
    '"/Users/x/Library/App Support/deeptutor/venv/bin/deeptutor" start'
  )

  // Interpreter discovery honors the version floor (probe stubbed).
  const found = await findPythonInterpreter(
    [
      { command: 'python-old', args: [] },
      { command: 'python-new', args: [] },
      { command: 'python-broken', args: [] }
    ],
    async spec =>
      spec.command === 'python-old' ? 'Python 3.9.2' : spec.command === 'python-new' ? 'Python 3.12.1' : null
  )

  assert.equal(found?.command, 'python-new')

  const none = await findPythonInterpreter([{ command: 'missing', args: [] }], async () => null)

  assert.equal(none, null)
})
