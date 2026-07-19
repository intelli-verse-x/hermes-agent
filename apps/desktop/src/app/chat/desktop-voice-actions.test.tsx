import { describe, expect, it } from 'vitest'

import { evaluateDesktopVoiceRoute } from './voice-policy'
import { voiceSubmissionBlockReason } from './voice-submission-policy'

const readyLocal = {
  mode: 'local-only' as const,
  runtime: { state: 'ready' as const }
}

describe('desktop voice route policy', () => {
  it('allows fully local audio in local-only mode', () => {
    expect(
      evaluateDesktopVoiceRoute(
        { stt: { enabled: true, provider: 'local' }, tts: { provider: 'piper' } },
        readyLocal,
        false
      )
    ).toMatchObject({ allowed: true, localOnly: true, usesCloudAudio: false })
  })

  it('blocks cloud STT or TTS before capture in local-only mode', () => {
    expect(
      evaluateDesktopVoiceRoute(
        { stt: { enabled: true, provider: 'openai' }, tts: { provider: 'piper' } },
        readyLocal,
        true
      )
    ).toMatchObject({ allowed: false, localOnly: true, usesCloudAudio: true })
  })

  it.each([
    {},
    { stt: { enabled: true, provider: 'auto' }, tts: { provider: 'piper' } },
    { stt: { enabled: true, provider: 'local' }, tts: { provider: 'auto' } },
    { stt: { enabled: true, provider: 'local' }, tts: { provider: 'edge' } }
  ])('does not assume omitted, auto, or Edge audio routes are local: %o', config => {
    expect(evaluateDesktopVoiceRoute(config, readyLocal, true).allowed).toBe(false)
  })

  it('requires cloud-audio consent separately from inference routing', () => {
    const config = { stt: { enabled: true, provider: 'groq' }, tts: { provider: 'edge' } }
    const localFirst = { mode: 'local-first' as const, runtime: { state: 'ready' as const } }

    expect(evaluateDesktopVoiceRoute(config, localFirst, false).allowed).toBe(false)
    expect(evaluateDesktopVoiceRoute(config, localFirst, true).allowed).toBe(true)
  })

  it('fails before capture when a remote gateway cannot verify the desktop attestation', () => {
    const route = evaluateDesktopVoiceRoute(
      { stt: { enabled: true, provider: 'local' }, tts: { provider: 'piper' } },
      readyLocal,
      false,
      true
    )

    expect(route).toMatchObject({ allowed: false })
    expect(route.reason).toContain('remote gateway')
    expect(route.reason).toContain('typed input')
  })
})

describe('trusted voice submission policy', () => {
  it.each([
    '/yolo on',
    'always allow this tool',
    'approve for this session',
    'my password is hunter2',
    'OTP: 123456',
    'grant admin permissions'
  ])('blocks non-authoritative voice input before dispatch: %s', text => {
    expect(voiceSubmissionBlockReason(text)).toBeTruthy()
  })

  it.each(['yes', 'confirm', 'please inspect the current screen'])(
    'keeps ordinary spoken prose non-authoritative: %s',
    text => {
      expect(voiceSubmissionBlockReason(text)).toBeNull()
    }
  )
})
