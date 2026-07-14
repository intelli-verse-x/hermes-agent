import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { notify } from '@/store/notifications'

import {
  $qvMcpStatus,
  $qvProvision,
  $qvSettings,
  $tutorStatus,
  loadQuizverseSettings,
  provisionTutor,
  refreshQvMcpStatus,
  refreshTutorStatus,
  restartTutor,
  saveQuizverseSettings,
  startTutor,
  stopTutor
} from './store'
import { TUTORX_NAME } from './tutorx'

// Setup: how this desktop reaches TutorX. Local mode supervises the user's
// own DeepTutor install (FastAPI + Next standalone) as a child process; remote
// mode points the Tutor webview at a hosted deployment. Mirrors the shape of
// the IX Agency Connect tab: a form over the brand's settings IPC plus live
// supervisor controls.

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground/60">
      {children}
    </span>
  )
}

const STATE_DOT: Record<string, string> = {
  error: 'bg-red-500',
  remote: 'bg-sky-500',
  running: 'bg-emerald-500',
  starting: 'bg-amber-500 animate-pulse',
  stopped: 'bg-neutral-400'
}

export function SetupTab() {
  const settings = useStore($qvSettings)
  const status = useStore($tutorStatus)
  const provision = useStore($qvProvision)
  const mcp = useStore($qvMcpStatus)

  const [tutorMode, setTutorMode] = useState<'local' | 'remote'>('local')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [localCommand, setLocalCommand] = useState('')
  const [localDirectory, setLocalDirectory] = useState('')
  // '' = auto (a free port is allocated when the servers spawn).
  const [apiPort, setApiPort] = useState('')
  const [webPort, setWebPort] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [litellmUrl, setLitellmUrl] = useState('')
  const [litellmKey, setLitellmKey] = useState('')
  const [litellmStatus, setLitellmStatus] = useState('')
  const [cognitoDomain, setCognitoDomain] = useState('')
  const [cognitoClientId, setCognitoClientId] = useState('')
  const [cognitoIssuer, setCognitoIssuer] = useState('')
  const [accountStatus, setAccountStatus] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void loadQuizverseSettings()
    void refreshTutorStatus()
    void refreshQvMcpStatus()
  }, [])

  // Hydrate the form once from the persisted settings.
  useEffect(() => {
    if (!settings || hydrated) {
      return
    }

    setTutorMode(settings.tutorMode)
    setRemoteUrl(settings.remoteUrl)
    setLocalCommand(settings.localCommand)
    setLocalDirectory(settings.localDirectory)
    setApiPort(settings.apiPort > 0 ? String(settings.apiPort) : '')
    setWebPort(settings.webPort > 0 ? String(settings.webPort) : '')
    setLitellmUrl(settings.litellmUrl)
    setCognitoDomain(settings.cognitoDomain)
    setCognitoClientId(settings.cognitoClientId)
    setCognitoIssuer(settings.cognitoIssuer)
    setHydrated(true)
  }, [hydrated, settings])

  // The managed install rewrites command/directory — re-hydrate on success.
  useEffect(() => {
    if (!provision.running && !provision.error && provision.lines.length > 0) {
      setHydrated(false)
    }
  }, [provision.error, provision.lines.length, provision.running])

  const pickDirectory = async () => {
    const result = await window.hermesDesktop?.quizverse?.pickTutorDirectory()

    if (result && !result.canceled && result.dir) {
      setLocalDirectory(result.dir)
    }
  }

  const save = async () => {
    setSaving(true)

    const ok = await saveQuizverseSettings({
      tutorMode,
      remoteUrl,
      localCommand,
      localDirectory,
      // Blank = auto (0): a free port is allocated at spawn time.
      apiPort: apiPort.trim() === '' ? 0 : Number(apiPort),
      webPort: webPort.trim() === '' ? 0 : Number(webPort),
      litellmUrl,
      cognitoDomain,
      cognitoClientId,
      cognitoIssuer,
      // Empty input = keep the stored key (it never round-trips back here).
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(litellmKey.trim() ? { litellmKey: litellmKey.trim() } : {})
    })

    setSaving(false)

    if (ok) {
      setApiKey('')
      notify({ kind: 'success', title: 'QuizVerse settings saved', message: `${TUTORX_NAME} connection updated.` })
    }
  }

  const state = status?.state ?? 'stopped'
  const localBusy = state === 'starting'

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-2xl space-y-6">
        <section className="rounded-lg border border-(--ui-border-primary) bg-(--ui-bg-quinary) p-4">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn('size-2 rounded-full', mcp?.state === 'ready' ? 'bg-emerald-500' : 'bg-red-500')}
            />
            <span className="text-sm font-medium">Chat player tools</span>
            <span className="text-xs text-muted-foreground">
              {mcp?.state === 'ready' ? `${mcp.toolCount} tools · ${mcp.auth}` : 'offline'}
            </span>
            <div className="flex-1" />
            <Button onClick={() => void refreshQvMcpStatus()} size="xs" variant="secondary">
              Check
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {mcp?.detail ?? 'Checking the local player-scoped MCP and desktop auth broker…'}
          </p>
        </section>

        <section className="space-y-3 rounded-lg border border-(--ui-border-primary) bg-(--ui-bg-quinary) p-4">
          <div>
            <h3 className="text-sm font-medium">QuizVerse account</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Native Cognito PKCE links the account to the same Nakama identity as web and Unity. Tokens remain in
              the system keychain.
            </p>
          </div>
          <label className="block space-y-1">
            <FieldLabel>Cognito domain</FieldLabel>
            <Input
              onChange={event => setCognitoDomain(event.target.value)}
              placeholder="auth.quizverse.world"
              value={cognitoDomain}
            />
          </label>
          <label className="block space-y-1">
            <FieldLabel>Cognito app client id</FieldLabel>
            <Input onChange={event => setCognitoClientId(event.target.value)} value={cognitoClientId} />
          </label>
          <label className="block space-y-1">
            <FieldLabel>Cognito OIDC issuer</FieldLabel>
            <Input
              onChange={event => setCognitoIssuer(event.target.value)}
              placeholder="https://cognito-idp.region.amazonaws.com/user-pool-id"
              value={cognitoIssuer}
            />
          </label>
          <Button
            disabled={!settings?.cognitoDomain || !settings.cognitoClientId || !settings.cognitoIssuer}
            onClick={() => {
              setAccountStatus('Opening secure sign-in…')
              void window.hermesDesktop.quizverse?.authStart()
                .then(() => setAccountStatus('Complete sign-in in your browser.'))
                .catch(error => setAccountStatus(error instanceof Error ? error.message : String(error)))
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            Connect account
          </Button>
          {accountStatus && <p className="text-xs" role="status">{accountStatus}</p>}
        </section>

        {/* Supervisor status + controls */}
        <section className="rounded-lg border border-(--ui-border-primary) bg-(--ui-bg-quinary) p-4">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', STATE_DOT[state] ?? STATE_DOT.stopped)} />
            <span className="text-sm font-medium text-foreground">{TUTORX_NAME}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{status?.detail ?? ''}</span>
          </div>
          {settings?.tutorMode !== 'remote' && (
            <div className="mt-3 flex items-center gap-2">
              <Button disabled={localBusy || state === 'running'} onClick={() => void startTutor()} size="xs">
                <Codicon name="play" size="0.75rem" />
                Start
              </Button>
              <Button disabled={state === 'stopped'} onClick={() => void stopTutor()} size="xs" variant="secondary">
                <Codicon name="debug-stop" size="0.75rem" />
                Stop
              </Button>
              <Button disabled={localBusy} onClick={() => void restartTutor()} size="xs" variant="secondary">
                <Codicon name="debug-restart" size="0.75rem" />
                Restart
              </Button>
            </div>
          )}
          {status?.logTail && status.logTail.length > 0 && (
            <pre className="mt-3 max-h-36 overflow-auto rounded-md bg-(--ui-chat-surface-background) p-2 font-mono text-[0.65rem] leading-relaxed text-muted-foreground">
              {status.logTail.join('\n')}
            </pre>
          )}
        </section>

        {/* Mode */}
        <section className="space-y-3">
          <FieldLabel>{TUTORX_NAME} mode</FieldLabel>
          <div className="flex items-center gap-2">
            <Button onClick={() => setTutorMode('local')} size="sm" variant={tutorMode === 'local' ? 'default' : 'secondary'}>
              <Codicon name="device-desktop" size="0.8rem" />
              Local
            </Button>
            <Button onClick={() => setTutorMode('remote')} size="sm" variant={tutorMode === 'remote' ? 'default' : 'secondary'}>
              <Codicon name="cloud" size="0.8rem" />
              Remote
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Local runs {TUTORX_NAME} on this machine and keeps your knowledge base private. Remote uses a hosted
            deployment instead.
          </p>
        </section>

        {tutorMode === 'local' ? (
          <section className="space-y-4">
            {/* Managed install: no checkout needed — venv + pip under the
                app's own data dir, settings wired up automatically. */}
            <div className="rounded-lg border border-(--ui-border-primary) bg-(--ui-bg-quinary) p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">No {TUTORX_NAME} install yet?</p>
                  <p className="text-xs text-muted-foreground">
                    Install a managed copy (Python 3.11+ required) — or point the fields below at your own checkout.
                  </p>
                </div>
                <Button disabled={provision.running} onClick={() => void provisionTutor()} size="sm" variant="secondary">
                  {provision.running ? <Codicon name="loading~spin" size="0.8rem" /> : <Codicon name="cloud-download" size="0.8rem" />}
                  {provision.running ? 'Installing…' : `Install ${TUTORX_NAME}`}
                </Button>
              </div>
              {provision.error && <p className="mt-2 text-xs text-red-500">{provision.error}</p>}
              {provision.lines.length > 0 && (
                <pre className="mt-2 max-h-36 overflow-auto rounded-md bg-(--ui-chat-surface-background) p-2 font-mono text-[0.65rem] leading-relaxed text-muted-foreground">
                  {provision.lines.slice(-40).join('\n')}
                </pre>
              )}
            </div>
            <label className="block space-y-1">
              <FieldLabel>{TUTORX_NAME} directory</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  onChange={event => setLocalDirectory(event.target.value)}
                  placeholder="/path/to/tutorx-workspace"
                  value={localDirectory}
                />
                <Button onClick={() => void pickDirectory()} size="sm" variant="secondary">
                  Browse…
                </Button>
              </div>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <FieldLabel>API port (FastAPI)</FieldLabel>
                <Input inputMode="numeric" onChange={event => setApiPort(event.target.value)} placeholder="auto" value={apiPort} />
              </label>
              <label className="block space-y-1">
                <FieldLabel>Web port (Next.js)</FieldLabel>
                <Input inputMode="numeric" onChange={event => setWebPort(event.target.value)} placeholder="auto" value={webPort} />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave the ports blank to allocate free ones automatically at start. When a LiteLLM key is saved, local
              {TUTORX_NAME} uses it as the LLM provider on spawn.
            </p>
            <label className="block space-y-1">
              <FieldLabel>LiteLLM base URL</FieldLabel>
              <Input
                onChange={event => setLitellmUrl(event.target.value)}
                placeholder="https://litellm.intelli-verse-x.ai"
                value={litellmUrl}
              />
            </label>
            <label className="block space-y-1">
              <FieldLabel>
                LiteLLM API key {settings?.litellmKeySet ? '(saved — leave blank to keep)' : '(required for local TutorX)'}
              </FieldLabel>
              <Input
                autoComplete="off"
                onChange={event => setLitellmKey(event.target.value)}
                placeholder={settings?.litellmKeySet ? '••••••••' : 'sk-…'}
                type="password"
                value={litellmKey}
              />
            </label>
            <div className="flex items-center gap-2">
              <Button
                disabled={!settings?.litellmKeySet && !litellmKey.trim()}
                onClick={() => {
                  setLitellmStatus('Testing model discovery and completion…')
                  void window.hermesDesktop?.quizverse
                    ?.validateLitellm({ key: litellmKey.trim() || undefined, url: litellmUrl })
                    .then(result => setLitellmStatus(`${result.provider} · ${result.model} · ${result.modelCount} models`))
                    .catch(error => setLitellmStatus(error instanceof Error ? error.message : String(error)))
                }}
                size="sm"
                type="button"
                variant="secondary"
              >
                Test LiteLLM
              </Button>
              {litellmStatus && <span className="text-xs text-muted-foreground">{litellmStatus}</span>}
            </div>
          </section>
        ) : (
          <section className="space-y-4">
            <label className="block space-y-1">
              <FieldLabel>Hosted {TUTORX_NAME} URL</FieldLabel>
              <Input
                onChange={event => setRemoteUrl(event.target.value)}
                placeholder="https://tutor.intelli-verse-x.ai"
                value={remoteUrl}
              />
            </label>
            <label className="block space-y-1">
              <FieldLabel>API key {settings?.apiKeySet ? '(saved — leave blank to keep)' : '(optional)'}</FieldLabel>
              <Input
                autoComplete="off"
                onChange={event => setApiKey(event.target.value)}
                placeholder={settings?.apiKeySet ? '••••••••' : ''}
                type="password"
                value={apiKey}
              />
            </label>
          </section>
        )}

        <div className="flex items-center gap-2">
          <Button disabled={saving} onClick={() => void save()} size="sm">
            {saving ? <Codicon name="loading~spin" size="0.8rem" /> : <Codicon name="check" size="0.8rem" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
