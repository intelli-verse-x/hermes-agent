import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { provisionDesktopBrand } from './desktop-brand-provision'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => fs.readFileSync(path.join(desktopRoot, relative), 'utf8')

test('standard chat, IX Copilot, and TutorX share the governed voice state machine', () => {
  const conversation = read('src/app/chat/composer/hooks/use-voice-conversation.ts')
  const standard = read('src/app/chat/composer/hooks/use-composer-voice.ts')
  const copilot = read('src/app/ix-agency/copilot-tab.tsx')
  const tutor = read('src/app/quizverse/native-tutor.tsx')

  for (const status of ['idle', 'listening', 'transcribing', 'thinking', 'awaiting-approval', 'speaking', 'error']) {
    assert.match(conversation, new RegExp(`['"]${status}['"]`))
  }

  assert.match(standard, /useVoiceConversation\(/)
  assert.match(standard, /inspectDesktopVoiceRoute\(/)
  assert.match(copilot, /useDesktopVoiceActions\(/)
  assert.match(copilot, /DesktopVoiceControls/)
  assert.match(tutor, /useDesktopVoiceActions\(/)
  assert.match(tutor, /DesktopVoiceControls/)
})

test('voice submissions use typed submit paths and trusted modality metadata', () => {
  const copilot = read('src/app/ix-agency/copilot-tab.tsx')
  const ixMain = read('electron/main.ts')
  const tutor = read('src/app/quizverse/tutor-chat-store.ts')
  const composer = read('src/app/chat/composer/index.tsx')
  const composerVoice = read('src/app/chat/composer/hooks/use-composer-voice.ts')
  const promptSubmit = read('src/app/session/hooks/use-prompt-actions/submit.ts')

  assert.match(copilot, /onSubmit:\s*\(text, metadata\) => send\(text, metadata\)/)
  assert.match(ixMain, /inputModality = input\?\.inputModality === 'voice' \? 'voice' : 'text'/)
  assert.match(tutor, /input_modality: options\.inputModality \?\? 'text'/)
  assert.match(composerVoice, /onSubmit\(text, \{ inputModality: 'voice' \}\)/)
  assert.match(promptSubmit, /input_modality: options\?\.inputModality \?\? 'text'/)
  assert.match(promptSubmit, /assertVoiceSubmissionAllowed\(visibleText\)/)
  assert.match(composer, /dictatedDraftRef\.current \? 'voice' : 'text'/)
  assert.match(composer, /blocked: awaitingInput/)
})

test('dictation and keyboard controls use the governed pre-capture and accessibility path', () => {
  const composerVoice = read('src/app/chat/composer/hooks/use-composer-voice.ts')
  const recorder = read('src/app/chat/composer/hooks/use-voice-recorder.ts')
  const conversation = read('src/app/chat/composer/hooks/use-voice-conversation.ts')

  assert.match(composerVoice, /preStartCheck: preCaptureCheck/)
  assert.match(recorder, /await preStartCheck\?\.\(\)/)
  assert.match(conversation, /target\.isContentEditable/)
  assert.match(conversation, /INPUT\|TEXTAREA\|SELECT\|BUTTON/)
})

test('IX voice IPC requires a single-use main-process microphone attestation', () => {
  const main = read('electron/main.ts')
  const preload = read('electron/preload.ts')

  assert.match(main, /voiceCaptureAttestations\.set\(webContents\.id/)
  assert.match(main, /isApprovedMicrophoneRequest\(webContents, permission, details, '', true\)/)
  assert.match(main, /isApprovedMicrophoneRequest\(webContents, permission, details, origin\)/)
  assert.match(main, /ipcMain\.handle\('hermes:requestMicrophoneAccess', async event =>/)
  assert.match(main, /event\.sender\.getURL\(\)/)
  assert.match(main, /VOICE_CAPTURE_PENDING_TTL_MS = 12 \* 60_000/)
  assert.match(main, /voiceCaptureAttestations\.delete\(event\.sender\.id\)/)
  assert.match(main, /crypto\.timingSafeEqual/)
  assert.match(preload, /voiceCaptureToken/)
})

test('both desktop brands discover the same shared voice skill in isolated homes', () => {
  const repoRoot = path.resolve(desktopRoot, '../..')

  for (const [brandId, productName] of [
    ['ix-agency', 'Agency'],
    ['quizverse', 'Learning']
  ] as const) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `${brandId}-voice-`))

    const result = provisionDesktopBrand({
      brandId,
      hermesHome: home,
      productName,
      sharedSkillsRoot: path.join(repoRoot, 'skills')
    })

    assert.equal(result.sharedSkillCount, 2)
    assert.equal(fs.existsSync(path.join(home, 'skills', 'desktop-voice-actions', 'SKILL.md')), true)
  }
})
