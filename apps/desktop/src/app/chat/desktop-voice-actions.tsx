import { useCallback, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { type ConversationStatus, useVoiceConversation } from './composer/hooks/use-voice-conversation'
import {
  type DesktopVoiceRoute,
  grantCloudAudioConsent,
  inspectDesktopVoiceRoute,
  transcribeDesktopVoice
} from './voice-policy'

export interface VoiceReply {
  id: string
  pending: boolean
  text: string
}

interface DesktopVoiceActionsOptions {
  blocked: boolean
  busy: boolean
  consumePendingResponse: () => void
  onSubmit: (text: string, metadata: { input_modality: 'voice' }) => Promise<void> | void
  pendingResponse: () => VoiceReply | null
}

export function useDesktopVoiceActions({
  blocked,
  busy,
  consumePendingResponse,
  onSubmit,
  pendingResponse
}: DesktopVoiceActionsOptions) {
  const [active, setActive] = useState(false)
  const [route, setRoute] = useState<DesktopVoiceRoute | null>(null)

  const preCaptureCheck = useCallback(async () => {
    const next = await inspectDesktopVoiceRoute()
    setRoute(next)

    if (!next.allowed) {
      throw new Error(next.reason)
    }
  }, [])

  const conversation = useVoiceConversation({
    blocked,
    busy,
    consumePendingResponse,
    continuous: false,
    enabled: active,
    onFatalError: () => setActive(false),
    onSubmit: text => onSubmit(text, { input_modality: 'voice' }),
    onTranscribeAudio: transcribeDesktopVoice,
    pendingResponse,
    preCaptureCheck
  })

  const start = useCallback(() => {
    setActive(true)
  }, [])

  const stop = useCallback(() => {
    setActive(false)
    void conversation.end()
  }, [conversation])

  const allowCloudAudio = useCallback(() => {
    grantCloudAudioConsent()
    setRoute(current => (current ? { ...current, allowed: true, reason: undefined } : current))
  }, [])

  return useMemo(
    () => ({ active, allowCloudAudio, conversation, route, start, stop }),
    [active, allowCloudAudio, conversation, route, start, stop]
  )
}

const STATUS_META: Record<ConversationStatus, { icon: string; label: string }> = {
  idle: { icon: 'mic', label: 'Push to talk' },
  listening: { icon: 'record', label: 'Listening — press again to send' },
  transcribing: { icon: 'loading~spin', label: 'Transcribing…' },
  thinking: { icon: 'loading~spin', label: 'Thinking…' },
  'awaiting-approval': { icon: 'shield', label: 'Awaiting visual confirmation' },
  speaking: { icon: 'unmute', label: 'Speaking — press to stop' },
  error: { icon: 'error', label: 'Voice error' }
}

export function DesktopVoiceControls({
  controller,
  className
}: {
  controller: ReturnType<typeof useDesktopVoiceActions>
  className?: string
}) {
  const status = controller.conversation.status
  const meta = STATUS_META[status]
  const captureBlocked = status === 'awaiting-approval' || status === 'transcribing'
  const cloudConsentNeeded =
    controller.route?.usesCloudAudio && !controller.route.allowed && !controller.route.localOnly

  return (
    <div className={cn('flex min-w-0 items-center gap-2 text-[0.68rem]', className)}>
      <Button
        aria-label={meta.label}
        aria-pressed={status === 'listening' || status === 'speaking'}
        disabled={captureBlocked}
        onClick={() => {
          if (status === 'listening' || status === 'speaking') {
            controller.conversation.stopTurn()
          } else if (controller.active && (status === 'idle' || status === 'error')) {
            void controller.conversation.start()
          } else if (controller.active) {
            controller.stop()
          } else {
            controller.start()
          }
        }}
        size="icon-xs"
        title={meta.label}
        type="button"
        variant={status === 'listening' ? 'destructive' : 'secondary'}
      >
        <Codicon name={meta.icon} size="0.8125rem" />
      </Button>
      <span aria-live="polite" className="shrink-0 text-muted-foreground" role="status">
        {meta.label}
      </span>
      {controller.route && (
        <span className="min-w-0 truncate text-muted-foreground/60" title={controller.route.disclosure}>
          {controller.route.disclosure}
        </span>
      )}
      {cloudConsentNeeded && (
        <Button onClick={controller.allowCloudAudio} size="xs" type="button" variant="outline">
          Allow cloud audio
        </Button>
      )}
    </div>
  )
}
