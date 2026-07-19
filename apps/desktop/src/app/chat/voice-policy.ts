import { getHermesConfig, transcribeAudio } from '@/hermes'
import type { LocalAiRendererBridge, LocalAiStatus } from '@/store/local-ai'
import { $connection } from '@/store/session'

const CLOUD_AUDIO_CONSENT_KEY = 'hermes.voice.cloud-audio-consent.v1'
const LOCAL_STT_PROVIDERS = new Set(['local'])
const LOCAL_TTS_PROVIDERS = new Set(['piper', 'neutts', 'kittentts', 'none'])

type VoiceConfig = {
  stt?: { enabled?: boolean; provider?: string }
  tts?: { provider?: string }
}

export interface DesktopVoiceRoute {
  allowed: boolean
  disclosure: string
  localOnly: boolean
  reason?: string
  sttProvider: string
  ttsProvider: string
  usesCloudAudio: boolean
}

export function evaluateDesktopVoiceRoute(
  config: VoiceConfig,
  localAi: Pick<LocalAiStatus, 'mode' | 'runtime'> | null,
  cloudAudioConsented: boolean,
  remoteGateway = false
): DesktopVoiceRoute {
  const sttProvider = String(config.stt?.provider || 'unresolved').toLowerCase()
  const ttsProvider = String(config.tts?.provider || 'unresolved').toLowerCase()
  const localOnly = localAi?.mode === 'local-only'
  const sttLocal = LOCAL_STT_PROVIDERS.has(sttProvider)
  const ttsLocal = LOCAL_TTS_PROVIDERS.has(ttsProvider)
  const usesCloudAudio = !sttLocal || !ttsLocal
  const disclosure = `Audio: STT ${sttProvider} · TTS ${ttsProvider} · inference ${localAi?.mode ?? 'configured route'}`

  if (config.stt?.enabled === false) {
    return { allowed: false, disclosure, localOnly, reason: 'Speech-to-text is disabled.', sttProvider, ttsProvider, usesCloudAudio }
  }

  if (remoteGateway) {
    return {
      allowed: false,
      disclosure: `${disclosure} · gateway remote`,
      localOnly,
      reason:
        'Voice capture is unavailable with a remote gateway because this desktop cannot securely transfer its ' +
        'single-use microphone attestation. Switch to a local gateway or use typed input.',
      sttProvider,
      ttsProvider,
      usesCloudAudio
    }
  }

  if (localOnly && (!sttLocal || !ttsLocal)) {
    return {
      allowed: false,
      disclosure,
      localOnly,
      reason: 'Local-only mode blocks capture because the configured STT or TTS route is cloud-backed.',
      sttProvider,
      ttsProvider,
      usesCloudAudio
    }
  }

  if (localOnly && localAi?.runtime.state !== 'ready') {
    return {
      allowed: false,
      disclosure,
      localOnly,
      reason: 'Local-only voice is unavailable until the local runtime is ready.',
      sttProvider,
      ttsProvider,
      usesCloudAudio
    }
  }

  if (usesCloudAudio && !cloudAudioConsented) {
    return {
      allowed: false,
      disclosure,
      localOnly,
      reason: 'Cloud audio needs separate consent before microphone capture.',
      sttProvider,
      ttsProvider,
      usesCloudAudio
    }
  }

  return { allowed: true, disclosure, localOnly, sttProvider, ttsProvider, usesCloudAudio }
}

export function grantCloudAudioConsent() {
  window.localStorage.setItem(CLOUD_AUDIO_CONSENT_KEY, 'allowed')
}

export async function consumeDesktopVoiceAttestation(): Promise<string> {
  const consume = window.hermesDesktop?.voice?.consumeCaptureAttestation

  if (!consume) {
    throw new Error('Trusted microphone capture attestation is unavailable.')
  }

  return consume()
}

export async function inspectDesktopVoiceRoute(): Promise<DesktopVoiceRoute> {
  const [config, localAi] = await Promise.all([
    getHermesConfig() as Promise<VoiceConfig>,
    (window.hermesDesktop?.localAi as LocalAiRendererBridge | undefined)?.getStatus().catch(() => null) ?? null
  ])

  return evaluateDesktopVoiceRoute(
    config,
    localAi,
    window.localStorage.getItem(CLOUD_AUDIO_CONSENT_KEY) === 'allowed',
    $connection.get()?.mode === 'remote'
  )
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read recorded audio.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

export async function transcribeDesktopVoice(audio: Blob): Promise<string> {
  const result = await transcribeAudio(await blobToDataUrl(audio), audio.type)

  return result.transcript
}
