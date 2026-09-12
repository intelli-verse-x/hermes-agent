import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { BrandMark } from '@/components/brand-mark'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BRAND_NAME } from '@/lib/brand'
import { AlertTriangle, CheckCircle2, Cpu, Download, Globe, Loader2, Lock, RefreshCw } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  $localAi,
  cancelLocalAiInstall,
  chooseLocalAiMode,
  initializeLocalAi,
  installLocalAi,
  type LocalAiMode,
  refreshLocalAi,
  retryLocalAiInstall,
  verifyLocalAi
} from '@/store/local-ai'

interface LocalAiSetupOverlayProps {
  enabled?: boolean
  forceOpen?: boolean
  onCompleted?: () => void
}

const MODE_COPY: Record<
  LocalAiMode,
  { title: string; summary: string; disclosure: string; icon: typeof Cpu; badge?: string }
> = {
  'local-first': {
    title: 'Local first',
    summary: 'Use the on-device model when it can handle the request, then ask before eligible cloud escalation.',
    disclosure:
      'Local requests stay on this device. If you approve a cloud escalation, the minimum needed request and recent tool context are sent to the selected cloud provider.',
    icon: Cpu,
    badge: 'Recommended'
  },
  'local-only': {
    title: 'Local only',
    summary: 'Keep inference on this device. Requests the local model cannot handle are blocked.',
    disclosure:
      'Prompts and responses are not sent to a cloud inference provider. Features requiring unsupported models, modalities, or cloud tools may be unavailable.',
    icon: Lock
  },
  'cloud-only': {
    title: 'Cloud only',
    summary: 'Do not install a local model. Continue using configured cloud providers.',
    disclosure:
      'Prompts, relevant conversation context, attachments, and tool inputs may be sent to your configured cloud provider under its privacy and billing terms.',
    icon: Globe
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function formatEta(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return 'Estimating time remaining…'
  }

  if (seconds < 60) {
    return `About ${Math.max(1, Math.ceil(seconds))} seconds remaining`
  }

  return `About ${Math.ceil(seconds / 60)} minutes remaining`
}

export function LocalAiSetupOverlay({ enabled = true, forceOpen = false, onCompleted }: LocalAiSetupOverlayProps) {
  const state = useStore($localAi)
  const [choice, setChoice] = useState<LocalAiMode | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const busy = state.action !== null
  const progress = state.progress

  const visible = enabled && (forceOpen || !state.initialized || state.status?.setupRequired !== false || submitted)

  const installing =
    submitted &&
    choice !== 'cloud-only' &&
    (state.action === 'installing' ||
      state.action === 'retrying' ||
      Boolean(progress && !['complete', 'cancelled', 'error'].includes(progress.stage)))

  useEffect(() => {
    if (enabled && !state.initialized) {
      void initializeLocalAi()
    }
  }, [enabled, state.initialized])

  useEffect(() => {
    if (!visible) {
      return
    }
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    titleRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy && onCompleted) {
        event.preventDefault()
        onCompleted()

        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) {
        return
      }

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )

      if (!focusable.length) {
        event.preventDefault()

        return
      }

      const first = focusable[0]
      const last = focusable.at(-1)!

      if (document.activeElement === titleRef.current) {
        event.preventDefault()

        if (event.shiftKey) {
          last.focus()
        } else {
          first.focus()
        }
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [busy, onCompleted, visible])

  if (!visible) {
    return null
  }

  const selectedCopy = choice ? MODE_COPY[choice] : null
  const percent = Math.max(0, Math.min(100, progress?.percent ?? 0))
  const completed = progress?.stage === 'complete' || (!progress && state.status?.runtime.state === 'ready')

  function finishSetup() {
    setSubmitted(false)
    onCompleted?.()
  }

  async function continueSetup() {
    if (!choice) {
      return
    }

    setSubmitted(true)
    const modeResult = await chooseLocalAiMode(choice)

    if (!modeResult.ok) {
      return
    }

    if (choice === 'cloud-only') {
      finishSetup()

      return
    }

    await installLocalAi(choice)
  }

  return (
    <div
      aria-label="Set up Adaptive Local AI"
      aria-labelledby="local-ai-setup-title"
      aria-modal="true"
      className="fixed inset-0 z-[1450] flex items-center justify-center bg-background/92 p-4 backdrop-blur-md"
      data-readiness-verified={completed ? 'true' : 'false'}
      ref={dialogRef}
      role="dialog"
    >
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-(--stroke-nous) bg-card shadow-nous">
        <header className="flex items-start gap-4 border-b border-border/60 px-6 py-5">
          <BrandMark className="size-10 shrink-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1
                className="text-lg font-semibold tracking-tight"
                id="local-ai-setup-title"
                ref={titleRef}
                tabIndex={-1}
              >
                Choose how {BRAND_NAME} runs AI
              </h1>
              <Badge variant="muted">First-run choice</Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Nothing downloads until you explicitly choose a mode. You can change this later in Settings.
            </p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {!state.initialized ? (
            <div
              aria-live="polite"
              className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              Checking this device…
            </div>
          ) : installing || progress?.stage === 'error' || progress?.stage === 'cancelled' || completed ? (
            <div className="mx-auto max-w-xl">
              <div aria-live="polite" className="flex items-start gap-3">
                {completed ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : progress?.stage === 'error' ? (
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
                ) : (
                  <Download className="mt-0.5 size-5 shrink-0 text-primary" />
                )}
                <div>
                  <h2 className="font-semibold">
                    {completed
                      ? 'Local AI is ready'
                      : progress?.stage === 'error'
                        ? 'Setup needs attention'
                        : progress?.stage === 'cancelled'
                          ? 'Download cancelled'
                          : 'Installing local AI'}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {progress?.message ||
                      (completed
                        ? `${state.status?.model?.displayName || state.recommendation?.displayName || 'The local model'} passed verification.`
                        : 'Preparing the model download…')}
                  </p>
                  {progress?.attemptIndex && progress.attemptTotal ? (
                    <p className="mt-1 text-xs font-medium text-primary" data-testid="local-ai-attempt-status">
                      Attempt {progress.attemptIndex} of {progress.attemptTotal}
                      {progress.attemptModel ? ` · ${progress.attemptModel}` : ''}
                      {progress.attemptPhase === 'runtime-repair' ? ' · runtime repair' : ''}
                    </p>
                  ) : null}
                </div>
              </div>

              {!completed && progress?.stage !== 'error' && progress?.stage !== 'cancelled' && (
                <div className="mt-6">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {progress?.completedBytes !== undefined && progress?.totalBytes !== undefined
                        ? `${formatBytes(progress.completedBytes)} of ${formatBytes(progress.totalBytes)}`
                        : state.recommendation
                          ? `${formatBytes(state.recommendation.downloadBytes)} download`
                          : 'Preparing download'}
                    </span>
                    <span className="tabular-nums">
                      {progress?.percent !== undefined ? `${Math.round(percent)}%` : ''}
                    </span>
                  </div>
                  <div
                    aria-label="Local AI installation progress"
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={progress?.percent !== undefined ? Math.round(percent) : undefined}
                    className="h-2 overflow-hidden rounded-full bg-(--ui-bg-tertiary)"
                    role="progressbar"
                  >
                    <div
                      className={cn(
                        'h-full bg-primary transition-[width] duration-300 motion-reduce:transition-none',
                        progress?.percent === undefined && 'w-1/3 animate-pulse motion-reduce:animate-none'
                      )}
                      style={progress?.percent !== undefined ? { width: `${percent}%` } : undefined}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{formatEta(progress?.etaSeconds)}</p>
                </div>
              )}

              {state.error && (
                <Alert className="mt-5" variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Local AI setup failed</AlertTitle>
                  <AlertDescription>{state.error}</AlertDescription>
                </Alert>
              )}

              <div className="mt-6 flex flex-wrap justify-end gap-2">
                {installing && (
                  <Button
                    disabled={state.action === 'cancelling'}
                    onClick={() => void cancelLocalAiInstall()}
                    variant="ghost"
                  >
                    {state.action === 'cancelling' ? 'Cancelling…' : 'Cancel'}
                  </Button>
                )}
                {(progress?.stage === 'error' || progress?.stage === 'cancelled') && (
                  <Button disabled={busy} onClick={() => void retryLocalAiInstall()} variant="secondary">
                    <RefreshCw className="size-3.5" />
                    Retry
                  </Button>
                )}
                {completed && (
                  <>
                    <Badge variant="outline">{state.status?.routeStatus?.label || 'Smart local ready'}</Badge>
                    <Button disabled={busy} onClick={() => void verifyLocalAi()} variant="secondary">
                      {state.action === 'verifying' ? 'Verifying…' : 'Verify again'}
                    </Button>
                    <Button onClick={finishSetup}>Continue</Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              <fieldset>
                <legend className="text-sm font-medium">Inference mode</legend>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  {(Object.keys(MODE_COPY) as LocalAiMode[]).map(mode => {
                    const copy = MODE_COPY[mode]
                    const Icon = copy.icon
                    const selected = choice === mode

                    return (
                      <button
                        aria-pressed={selected}
                        className={cn(
                          'relative rounded-lg border p-4 text-left outline-none transition-colors motion-reduce:transition-none focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50',
                          selected
                            ? 'border-primary bg-primary/5'
                            : 'border-border/70 bg-muted/10 hover:bg-(--chrome-action-hover)'
                        )}
                        key={mode}
                        onClick={() => setChoice(mode)}
                        type="button"
                      >
                        <span className="flex items-center gap-2">
                          <Icon className={cn('size-4', selected ? 'text-primary' : 'text-muted-foreground')} />
                          <span className="text-sm font-semibold">{copy.title}</span>
                          {copy.badge && <Badge className="ml-auto">{copy.badge}</Badge>}
                        </span>
                        <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">{copy.summary}</span>
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              {state.recommendation && choice !== 'cloud-only' && (
                <section
                  aria-labelledby="recommendation-title"
                  className="mt-5 rounded-lg border border-border/70 bg-muted/15 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="flex items-center gap-2 text-sm font-semibold" id="recommendation-title">
                      <Cpu className="size-4 text-primary" />
                      Recommended for this device
                    </h2>
                    <Badge variant="outline">{state.recommendation.acceleration.toUpperCase()}</Badge>
                  </div>
                  <p className="mt-2 text-sm font-medium">{state.recommendation.displayName}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{state.recommendation.rationale}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-muted-foreground">Download</dt>
                      <dd className="mt-0.5 font-medium tabular-nums">
                        {formatBytes(state.recommendation.downloadBytes)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Disk required</dt>
                      <dd className="mt-0.5 font-medium tabular-nums">{formatBytes(state.recommendation.diskBytes)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Memory target</dt>
                      <dd className="mt-0.5 font-medium tabular-nums">
                        {formatBytes(state.recommendation.memoryBytes)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Context</dt>
                      <dd className="mt-0.5 font-medium tabular-nums">
                        {state.recommendation.contextTokens.toLocaleString()} tokens
                      </dd>
                    </div>
                  </dl>
                </section>
              )}

              {selectedCopy && (
                <Alert className="mt-5" variant={choice === 'cloud-only' ? 'warning' : 'default'}>
                  {choice === 'cloud-only' ? <Globe /> : <Lock />}
                  <AlertTitle>
                    {choice === 'cloud-only' ? 'Cloud and privacy disclosure' : 'Privacy disclosure'}
                  </AlertTitle>
                  <AlertDescription>{selectedCopy.disclosure}</AlertDescription>
                </Alert>
              )}

              {state.error && (
                <Alert className="mt-5" variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Local AI is unavailable</AlertTitle>
                  <AlertDescription>
                    {state.error}{' '}
                    <Button onClick={() => void refreshLocalAi()} size="inline" variant="textStrong">
                      Check again
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </div>

        {!submitted && state.initialized && (
          <footer className="flex items-center justify-between gap-3 border-t border-border/60 px-6 py-4">
            <p className="text-xs text-muted-foreground">
              {choice ? `Selected: ${MODE_COPY[choice].title}` : 'Select one mode to continue.'}
            </p>
            <Button
              disabled={!choice || busy || (choice !== 'cloud-only' && !state.recommendation)}
              onClick={() => void continueSetup()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : null}
              {choice === 'cloud-only' ? 'Use cloud only' : 'Download and set up'}
            </Button>
          </footer>
        )}
      </div>
    </div>
  )
}
