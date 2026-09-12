import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { $gatewayState } from '@/store/session'

import {
  $qvMcpStatus,
  $qvUpdate,
  $tutorStatus,
  applyQvUpdate,
  installTutorEvents,
  refreshQvMcpStatus,
  refreshQvUpdate,
  refreshTutorStatus
} from './store'
import { TUTORX_NAME } from './tutorx'

// Slim strip above the QuizVerse surfaces: TutorX platform lamp, agent
// backend lamp, and the non-blocking update button — same posture as the IX
// Agency strip, fed by the QuizVerse supervisor + the shared gateway state.

const POLL_MS = 30_000

function Lamp({ color, label, title }: { color: string; label: string; title: string }) {
  return (
    <Tip label={title} side="bottom">
      <span className="flex min-w-0 items-center gap-1.5 text-[0.7rem] text-muted-foreground">
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', color)} />
        <span className="truncate">{label}</span>
      </span>
    </Tip>
  )
}

const TUTOR_LAMP_COLOR: Record<string, string> = {
  error: 'bg-red-500',
  remote: 'bg-emerald-500',
  running: 'bg-emerald-500',
  starting: 'bg-amber-500 animate-pulse',
  stopped: 'bg-neutral-400'
}

const TUTOR_LAMP_LABEL: Record<string, string> = {
  error: `${TUTORX_NAME} error`,
  remote: `${TUTORX_NAME} remote`,
  running: `${TUTORX_NAME} running`,
  starting: `${TUTORX_NAME} starting`,
  stopped: `${TUTORX_NAME} off`
}

export function QvStatusStrip() {
  const tutor = useStore($tutorStatus)
  const gatewayState = useStore($gatewayState)
  const update = useStore($qvUpdate)
  const mcp = useStore($qvMcpStatus)

  useEffect(() => {
    installTutorEvents()
    void refreshTutorStatus()
    void refreshQvUpdate()
    void refreshQvMcpStatus()

    const timer = setInterval(() => {
      void refreshTutorStatus()
      void refreshQvMcpStatus()
    }, POLL_MS)

    return () => clearInterval(timer)
  }, [])

  const tutorState = tutor?.state ?? 'stopped'

  const tutorColor =
    tutor?.state === 'remote' && tutor.reachable === false
      ? 'bg-red-500'
      : (TUTOR_LAMP_COLOR[tutorState] ?? 'bg-neutral-400')

  const hermesUp = gatewayState === 'open'

  return (
    <div className="flex h-9 w-full shrink-0 items-center gap-3 rounded-md border border-(--ui-border-primary) bg-(--ui-bg-quinary) px-3">
      <Lamp
        color={tutorColor}
        label={TUTOR_LAMP_LABEL[tutorState] ?? TUTORX_NAME}
        title={tutor?.detail ?? `Checking ${TUTORX_NAME}…`}
      />
      <span className="h-4 w-px bg-(--ui-border-primary)" />
      <Lamp
        color={hermesUp ? 'bg-emerald-500' : 'bg-amber-500'}
        label={`Agent ${hermesUp ? 'connected' : gatewayState}`}
        title={hermesUp ? 'Agent backend is connected' : `Agent gateway state: ${gatewayState}`}
      />
      <span className="h-4 w-px bg-(--ui-border-primary)" />
      <Lamp
        color={mcp?.state === 'ready' ? 'bg-emerald-500' : 'bg-red-500'}
        label={`Player tools ${mcp?.state === 'ready' ? mcp.auth : 'offline'}`}
        title={mcp?.detail ?? 'Checking QuizVerse player tools…'}
      />
      <div className="min-w-0 flex-1" />
      {update?.updateAvailable && (
        <Tip
          label={`${update.currentVersion} → ${update.latestVersion}${update.notes ? ` — ${update.notes}` : ''}`}
          side="bottom"
        >
          <Button onClick={() => void applyQvUpdate()} size="xs" variant="secondary">
            <Codicon name="arrow-circle-up" size="0.75rem" />
            {update.inPlace ? 'Update available — Restart to update' : 'Update available — Get the new version'}
          </Button>
        </Tip>
      )}
    </div>
  )
}
