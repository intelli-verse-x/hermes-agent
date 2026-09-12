import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { AlertTriangle, BarChart3, Cpu, Globe, Loader2, Lock, Package, RefreshCw, Trash2, Wrench } from '@/lib/icons'
import {
  $localAi,
  changeLocalAiModel,
  chooseLocalAiMode,
  initializeLocalAi,
  type LocalAiMode,
  refreshLocalAi,
  reinstallLocalAi,
  repairLocalAi,
  setLocalAiTelemetryEnabled,
  uninstallLocalAi,
  verifyLocalAi
} from '@/store/local-ai'

import { ListRow, SectionHeading, SettingsContent } from './primitives'

const MODE_OPTIONS = [
  { id: 'local-first', label: 'Local first', icon: Cpu },
  { id: 'local-only', label: 'Local only', icon: Lock },
  { id: 'cloud-only', label: 'Cloud only', icon: Globe }
] as const

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? 'compact' : 'standard' }).format(value)
}

function statusBadge(label: string, tone: 'default' | 'muted' | 'warn' | 'destructive' | 'outline' = 'muted') {
  return <Badge variant={tone}>{label}</Badge>
}

export function LocalAiSettings() {
  const state = useStore($localAi)
  const [confirm, setConfirm] = useState<'reinstall' | 'uninstall' | null>(null)
  const status = state.status
  const busy = state.action !== null

  useEffect(() => {
    if (!state.initialized) {
      void initializeLocalAi()
    }
  }, [state.initialized])

  async function changeMode(mode: LocalAiMode) {
    await chooseLocalAiMode(mode)
  }

  async function runConfirmedAction() {
    const result = confirm === 'uninstall' ? await uninstallLocalAi() : await reinstallLocalAi()

    if (!result.ok) {
      throw new Error(result.message || 'Local AI action failed.')
    }
  }

  if (!state.initialized && !status) {
    return (
      <SettingsContent>
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          Loading local AI…
        </div>
      </SettingsContent>
    )
  }

  const runtimeTone =
    status?.runtime.state === 'ready'
      ? 'default'
      : status?.runtime.state === 'error' || status?.runtime.state === 'degraded'
        ? 'destructive'
        : 'muted'

  const routeTone =
    status?.routeHealth === 'healthy'
      ? 'default'
      : status?.routeHealth === 'degraded'
        ? 'warn'
        : status?.routeHealth === 'unavailable'
          ? 'destructive'
          : 'muted'

  return (
    <SettingsContent>
      <div className="mx-auto w-full max-w-2xl pt-4">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Adaptive Local AI</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Control on-device inference, cloud routing, and local model storage.
            </p>
          </div>
          <Button
            aria-label="Refresh local AI status"
            disabled={busy}
            onClick={() => void refreshLocalAi()}
            size="icon-xs"
            variant="ghost"
          >
            <RefreshCw className={state.action === 'loading' ? 'animate-spin motion-reduce:animate-none' : ''} />
          </Button>
        </div>

        {state.error && (
          <Alert className="mb-5" variant="destructive">
            <AlertTriangle />
            <AlertTitle>Local AI needs attention</AlertTitle>
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

        <SectionHeading icon={Cpu} title="Runtime and routing" />
        <div className="divide-y divide-border/60 rounded-xl border border-border/70 bg-muted/10 px-4">
          <ListRow
            action={
              status
                ? statusBadge(status.runtime.state.replace('-', ' '), runtimeTone)
                : statusBadge('Unavailable', 'destructive')
            }
            description={
              status?.runtime.endpoint
                ? `Endpoint ${status.runtime.endpoint}${status.runtime.version ? ` · Runtime ${status.runtime.version}` : ''}`
                : status?.runtime.error || 'No managed local runtime is installed.'
            }
            title="Runtime"
          />
          <ListRow
            action={statusBadge(
              status?.routeStatus?.label || status?.routeHealth?.replace('-', ' ') || 'unknown',
              routeTone
            )}
            description={
              status?.routeStatus
                ? `${status.routeStatus.localReady ? 'Verified local route is active.' : 'Local route is not ready.'} ${status.routeStatus.cloudFallbacks} cloud fallback${status.routeStatus.cloudFallbacks === 1 ? '' : 's'} recorded.`
                : 'Health of the route used for local inference and automatic local-first decisions.'
            }
            title="Smart route"
          />
          <ListRow
            action={
              status?.mode ? (
                <SegmentedControl
                  className={busy ? 'pointer-events-none opacity-50' : ''}
                  onChange={mode => void changeMode(mode)}
                  options={MODE_OPTIONS}
                  value={status.mode}
                />
              ) : (
                statusBadge('Not selected', 'warn')
              )
            }
            description={
              status?.mode === 'local-only'
                ? 'Inference stays on this device; unsupported requests are blocked.'
                : status?.mode === 'cloud-only'
                  ? 'Requests use configured cloud providers; the local runtime is bypassed.'
                  : 'Local inference is preferred; eligible cloud escalations require policy approval.'
            }
            title="Inference mode"
            wide
          />
          <ListRow
            action={
              <Button
                disabled={busy || status?.mode === 'cloud-only'}
                onClick={() => void changeLocalAiModel()}
                size="sm"
                variant="textStrong"
              >
                {state.action === 'changing-model' ? 'Opening…' : 'Change'}
              </Button>
            }
            description={
              status?.model
                ? `${status.model.displayName}${status.model.revision ? ` · ${status.model.revision}` : ''}`
                : status?.mode === 'cloud-only'
                  ? 'No local model is used in cloud-only mode.'
                  : 'No local model is installed.'
            }
            title="Model"
          />
          <ListRow
            action={statusBadge(`${status?.attempts?.length ?? 0} attempts`, 'outline')}
            description={
              status?.attempts?.at(-1)
                ? `${status.attempts.at(-1)?.modelDisplayName} · ${status.attempts.at(-1)?.status}${status.attempts.at(-1)?.reason ? ` · ${status.attempts.at(-1)?.reason}` : ''}`
                : 'No local install attempts have been recorded.'
            }
            title="Install readiness history"
          />
        </div>

        <SectionHeading icon={Package} title="Storage" />
        <div className="divide-y divide-border/60 rounded-xl border border-border/70 bg-muted/10 px-4">
          <ListRow
            action={
              <span className="text-sm font-medium tabular-nums">{formatBytes(status?.storage.usedBytes ?? 0)}</span>
            }
            description={
              status
                ? `${formatBytes(status.storage.availableBytes)} available${status.storage.location ? ` · ${status.storage.location}` : ''}`
                : 'Storage information unavailable.'
            }
            title="Local AI storage used"
          />
        </div>

        <SectionHeading icon={BarChart3} title="Local impact" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
            <p className="text-xs text-muted-foreground">Cloud escalations</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatCount(status?.cloudEscalations ?? 0)}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Requests sent to cloud because local execution was unavailable, unsupported, or explicitly requested.
            </p>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
            <p className="text-xs text-muted-foreground">Estimated cloud tokens avoided</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {formatCount(status?.estimatedTokensAvoided ?? status?.tokensAvoided ?? 0)}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Character-based cloud-equivalent estimate. Measured local usage:{' '}
              {formatCount(status?.measuredLocalTokens ?? 0)} tokens. Baseline:{' '}
              {status?.tokenBaseline ?? 'same-request cloud equivalent'}
              {status?.tokenSavingsPeriodStartedAt
                ? ` · since ${new Date(status.tokenSavingsPeriodStartedAt).toLocaleDateString()}`
                : ''}
              . No prompt bodies are stored.
            </p>
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-border/70 bg-muted/10 px-4">
          <ListRow
            action={
              <Button
                disabled={busy}
                onClick={() => void setLocalAiTelemetryEnabled(!status?.telemetryEnabled)}
                size="sm"
                variant="textStrong"
              >
                {status?.telemetryEnabled ? 'Disable' : 'Enable'}
              </Button>
            }
            description="Optional content-free local diagnostics: route, reason, counts, latency, and readiness freshness only."
            title="Local diagnostics telemetry"
          />
        </div>

        <SectionHeading icon={Wrench} title="Maintenance" />
        <div className="rounded-xl border border-border/70 bg-muted/10 px-4">
          <ListRow
            action={
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button
                  disabled={busy || status?.mode === 'cloud-only'}
                  onClick={() => void verifyLocalAi()}
                  size="sm"
                  variant="textStrong"
                >
                  {state.action === 'verifying' ? 'Verifying…' : 'Verify'}
                </Button>
                <Button
                  disabled={busy || status?.mode === 'cloud-only'}
                  onClick={() => void repairLocalAi()}
                  size="sm"
                  variant="textStrong"
                >
                  {state.action === 'repairing' ? 'Repairing…' : 'Repair'}
                </Button>
              </div>
            }
            description="Verify model integrity and endpoint health, or repair the runtime in place."
            title="Health checks"
          />
          <ListRow
            action={
              <Button
                disabled={busy || status?.mode === 'cloud-only'}
                onClick={() => setConfirm('reinstall')}
                size="sm"
                variant="textStrong"
              >
                Reinstall
              </Button>
            }
            description="Download a clean copy of the selected runtime and model."
            title="Reinstall local AI"
          />
        </div>

        <div className="mt-8 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-destructive">Uninstall local AI</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Remove the managed runtime and downloaded model files. App settings and cloud providers are kept.
              </p>
            </div>
            <Button
              disabled={busy || status?.runtime.state === 'not-installed'}
              onClick={() => setConfirm('uninstall')}
              size="sm"
              variant="destructive"
            >
              <Trash2 className="size-3.5" />
              Uninstall
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        busyLabel={confirm === 'uninstall' ? 'Uninstalling…' : 'Reinstalling…'}
        cancelLabel="Cancel"
        confirmLabel={confirm === 'uninstall' ? 'Uninstall local AI' : 'Reinstall'}
        description={
          confirm === 'uninstall'
            ? `This removes ${formatBytes(status?.storage.usedBytes ?? 0)} of local AI files. Cloud configuration and app data remain.`
            : 'The current runtime and model will be replaced with clean verified copies.'
        }
        destructive={confirm === 'uninstall'}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirmedAction}
        open={confirm !== null}
        title={confirm === 'uninstall' ? 'Remove local AI from this device?' : 'Reinstall local AI?'}
      />
    </SettingsContent>
  )
}
