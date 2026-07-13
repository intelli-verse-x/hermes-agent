import { atom } from 'nanostores'

import type {
  DeepTutorRendererStatus,
  IxUpdateStatus,
  QuizverseMcpStatus,
  QuizverseRendererSettings,
  QuizverseSettingsInput
} from '@/global'
import { notifyError } from '@/store/notifications'

import { TUTORX_NAME } from './tutorx'

// QuizVerse workspace state — DeepTutor supervisor status, locally-persisted
// settings and the update lamp. Everything
// flows through the brand's preload bridge (window.hermesDesktop.quizverse);
// the main-process handlers behind it only exist in QuizVerse builds.
//
// This view is brand-specific (not upstream), so its strings stay plain
// English — same posture as the ix-agency workspace.

const bridge = () => window.hermesDesktop?.quizverse

export function quizversePublicText(value: string): string {
  return value
    .replace(/deep[\s_-]*tutor/gi, TUTORX_NAME)
    .replace(/\bhermes(?:[\s-]agent)?\b/gi, 'QuizVerse')
}

function publicTutorStatus(status: DeepTutorRendererStatus): DeepTutorRendererStatus {
  return {
    ...status,
    detail: quizversePublicText(status.detail),
    logTail: status.logTail.map(quizversePublicText)
  }
}

export const $tutorStatus = atom<DeepTutorRendererStatus | null>(null)
export const $qvSettings = atom<QuizverseRendererSettings | null>(null)
export const $qvUpdate = atom<IxUpdateStatus | null>(null)
export const $qvMcpStatus = atom<QuizverseMcpStatus | null>(null)

export interface QvProvisionState {
  running: boolean
  lines: string[]
  error: null | string
}

/** Managed-install progress (Setup tab's "Install DeepTutor" flow). */
export const $qvProvision = atom<QvProvisionState>({ error: null, lines: [], running: false })

let tutorEventsInstalled = false
let autoStartAttempted = false

/** Live supervisor pushes → the status atom. Installed once per window. */
export function installTutorEvents() {
  if (tutorEventsInstalled) {
    return
  }

  const qv = bridge()
  const unsubscribe = qv?.onTutorEvent(status => $tutorStatus.set(publicTutorStatus(status)))

  qv?.onProvisionEvent(payload => {
    const current = $qvProvision.get()

    $qvProvision.set({
      error: payload.error ? quizversePublicText(payload.error) : (payload.done ? null : current.error),
      lines: payload.line ? [...current.lines.slice(-199), quizversePublicText(payload.line)] : current.lines,
      running: payload.done ? false : current.running
    })
  })

  tutorEventsInstalled = Boolean(unsubscribe)
}

/** Kick off (or join) the managed DeepTutor install, then reload settings. */
export async function provisionTutor() {
  const qv = bridge()

  if (!qv || $qvProvision.get().running) {
    return
  }

  $qvProvision.set({ error: null, lines: [], running: true })

  try {
    const result = await qv.provisionTutor()

    if (result.ok) {
      await loadQuizverseSettings()
      await refreshTutorStatus()
    }
  } catch (error) {
    const message = quizversePublicText(error instanceof Error ? error.message : String(error))

    $qvProvision.set({ ...$qvProvision.get(), error: message, running: false })
    notifyError(new Error(message), `${TUTORX_NAME} install failed`)
  }
}

export async function refreshTutorStatus() {
  const qv = bridge()

  if (!qv) {
    return
  }

  try {
    $tutorStatus.set(publicTutorStatus(await qv.tutorStatus()))
  } catch {
    // Non-QuizVerse build or main not ready — the lamp stays grey.
  }
}

export async function refreshQvMcpStatus() {
  const qv = bridge()

  if (!qv) {
    return
  }

  try {
    $qvMcpStatus.set(await qv.mcpStatus())
  } catch {
    $qvMcpStatus.set({
      auth: 'pending',
      detail: 'QuizVerse player tools are unavailable.',
      state: 'error',
      toolCount: 0
    })
  }
}

export async function startTutor() {
  const qv = bridge()

  if (!qv) {
    return
  }

  try {
    $tutorStatus.set(publicTutorStatus(await qv.tutorStart()))
  } catch (error) {
    notifyError(error, `Could not start ${TUTORX_NAME}`)
  }
}

export async function stopTutor() {
  const qv = bridge()

  if (!qv) {
    return
  }

  try {
    $tutorStatus.set(publicTutorStatus(await qv.tutorStop()))
  } catch (error) {
    notifyError(error, `Could not stop ${TUTORX_NAME}`)
  }
}

export async function restartTutor() {
  const qv = bridge()

  if (!qv) {
    return
  }

  try {
    $tutorStatus.set(publicTutorStatus(await qv.tutorRestart()))
  } catch (error) {
    notifyError(error, `Could not restart ${TUTORX_NAME}`)
  }
}

/** Boot the local DeepTutor once per app session when the workspace opens.
 *  Remote mode and already-running servers are no-ops inside the supervisor. */
export async function autoStartTutorOnce() {
  if (autoStartAttempted) {
    return
  }

  autoStartAttempted = true
  const qv = bridge()

  if (!qv) {
    return
  }

  try {
    const settings = await qv.getSettings()

    $qvSettings.set(settings)

    if (settings.tutorMode === 'local') {
      $tutorStatus.set(publicTutorStatus(await qv.tutorStart()))
    } else {
      $tutorStatus.set(publicTutorStatus(await qv.tutorStatus()))
    }
  } catch (error) {
    notifyError(error, `Could not start ${TUTORX_NAME}`)
  }
}

export async function loadQuizverseSettings() {
  const qv = bridge()

  if (!qv) {
    return
  }

  try {
    $qvSettings.set(await qv.getSettings())
  } catch {
    // Settings pane shows its own empty state.
  }
}

export async function saveQuizverseSettings(input: QuizverseSettingsInput): Promise<boolean> {
  const qv = bridge()

  if (!qv) {
    return false
  }

  try {
    $qvSettings.set(await qv.saveSettings(input))
    await refreshTutorStatus()

    return true
  } catch (error) {
    notifyError(error, 'Could not save QuizVerse settings')

    return false
  }
}

export async function refreshQvUpdate() {
  const qv = bridge()

  if (!qv) {
    return
  }

  try {
    $qvUpdate.set(await qv.updateCheck())
  } catch {
    // Update lamp stays hidden.
  }
}

export async function applyQvUpdate() {
  const qv = bridge()

  if (!qv) {
    return
  }

  try {
    await qv.updateApply()
  } catch (error) {
    notifyError(error, 'Update failed')
  }
}
