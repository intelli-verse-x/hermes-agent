import { atom } from 'nanostores'

import { consumeDesktopVoiceAttestation } from '../chat/voice-policy'
import { assertVoiceSubmissionAllowed } from '../chat/voice-submission-policy'

import { createTutorSocket, tutorFetch, type TutorSocket } from './tutor-api'

export type TutorMode = 'chat' | 'deep_question' | 'deep_research' | 'deep_solve' | 'mastery_path' | 'visualize'

export interface TutorTrace {
  type: string
  label: string
  content: string
}

export interface TutorMessage {
  artifact?: TutorVisualArtifact
  capability?: TutorMode
  id: string
  researchOutline?: TutorResearchOutline
  role: 'assistant' | 'user'
  turnId?: string
  content: string
  traces: TutorTrace[]
  quiz?: TutorQuizQuestion[]
  askUser?: { question: string; turnId: string }
}

export interface TutorQuizQuestion {
  question_id?: string
  question: string
  options?: string[]
  correct_answer?: string
  explanation?: string
  question_type?: string
}

export interface TutorResearchOutline {
  researchConfig: Record<string, unknown>
  subTopics: { overview: string; title: string }[]
  topic: string
}

export interface TutorVisualArtifact {
  content?: string
  posterUrl?: string
  renderType: 'chartjs' | 'html' | 'manim_image' | 'manim_video' | 'mermaid' | 'svg'
  url?: string
}

export interface TutorSessionSummary {
  session_id?: string
  id?: string
  title?: string
  updated_at?: string
}

interface StreamEvent {
  type: string
  content?: string
  metadata?: Record<string, unknown>
  session_id?: string
  turn_id?: string
  seq?: number
}

export const $tutorMessages = atom<TutorMessage[]>([])
export const $tutorSessions = atom<TutorSessionSummary[]>([])
export const $tutorSessionId = atom<null | string>(null)
export const $tutorStreaming = atom(false)
export const $tutorConnection = atom<'connecting' | 'offline' | 'online'>('offline')
export const $tutorMode = atom<TutorMode>('chat')
export const $tutorCapabilities = atom({
  checked: false,
  learningApi: false,
  masteryMode: false
})

let socket: TutorSocket | null = null
let reconnect = 0
let activeTurn: null | string = null
let lastSeq = 0
let pendingSend: null | Record<string, unknown> = null
let intentional = false
let heartbeatTimer: null | number = null
let idleTimer: null | number = null
let lastReceivedAt = 0
let lastStreamAt = 0
const seenEvents = new Set<string>()
const HEARTBEAT_MS = 30_000
const HEARTBEAT_TIMEOUT_MS = 45_000
const IDLE_TIMEOUT_MS = 180_000

function clearTransportTimers() {
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  if (idleTimer) {
    window.clearInterval(idleTimer)
    idleTimer = null
  }
}

function startTransportTimers() {
  clearTransportTimers()
  heartbeatTimer = window.setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return
    }

    if (Date.now() - lastReceivedAt > HEARTBEAT_TIMEOUT_MS) {
      socket.close()

      return
    }

    socket.send(JSON.stringify({ type: 'ping' }))
  }, HEARTBEAT_MS)
  idleTimer = window.setInterval(() => {
    if ($tutorStreaming.get() && Date.now() - lastStreamAt > IDLE_TIMEOUT_MS) {
      intentional = true
      socket?.close()
      failStreaming('TutorX stopped responding. Your session is preserved; retry the turn.')
    }
  }, 1_000)
}

function failStreaming(message: string) {
  $tutorStreaming.set(false)
  $tutorConnection.set('offline')
  pendingSend = null
  appendAssistantEvent({
    content: message,
    metadata: { turn_terminal: true },
    type: 'error'
  })
}

function appendAssistantEvent(event: StreamEvent) {
  const messages = [...$tutorMessages.get()]
  let message = messages.at(-1)

  if (!message || message.role !== 'assistant') {
    message = { content: '', id: `assistant-${Date.now()}`, role: 'assistant', traces: [] }
    messages.push(message)
  }

  const metadata = event.metadata ?? {}

  if (event.turn_id) {
    message.turnId = event.turn_id
  }

  const callKind = metadata.call_kind

  if (
    (event.type === 'content' || event.type === 'error') &&
    (!metadata.call_id || callKind === 'llm_final_response' || callKind === 'agent_loop_round')
  ) {
    message.content += event.content ?? ''
  }

  if (
    ['thinking', 'observation', 'progress', 'stage_start', 'tool_call', 'tool_result', 'sources'].includes(event.type)
  ) {
    message.traces = [
      ...message.traces,
      { content: event.content ?? JSON.stringify(metadata), label: event.type.replaceAll('_', ' '), type: event.type }
    ]
  }

  const quizPair = metadata.qa_pair as TutorQuizQuestion | undefined

  if (quizPair) {
    message.quiz = [...(message.quiz ?? []), quizPair]
  }
  const summary = metadata.summary as { results?: { qa_pair?: TutorQuizQuestion }[] } | undefined

  if (summary?.results) {
    message.quiz = summary.results.flatMap(item => (item.qa_pair ? [item.qa_pair] : []))
  }

  if (metadata.outline_preview === true) {
    message.researchOutline = {
      researchConfig: (metadata.research_config ?? {}) as Record<string, unknown>,
      subTopics: ((metadata.sub_topics ?? []) as { overview?: string; title?: string }[]).map(topic => ({
        overview: String(topic.overview ?? ''),
        title: String(topic.title ?? '')
      })),
      topic: String(metadata.topic ?? '')
    }
  }

  const renderType = metadata.render_type

  if (['chartjs', 'html', 'manim_image', 'manim_video', 'mermaid', 'svg'].includes(String(renderType))) {
    const code = metadata.code as { content?: string } | undefined
    const manim = metadata.manim as Record<string, unknown> | undefined

    message.artifact = {
      content: String(code?.content ?? metadata.content ?? ''),
      posterUrl: String(manim?.poster_url ?? metadata.poster_url ?? '') || undefined,
      renderType: renderType as TutorVisualArtifact['renderType'],
      url: String(manim?.video_url ?? manim?.image_url ?? metadata.url ?? '') || undefined
    }
  }

  const ask = (metadata.ask_user ?? (metadata.tool_metadata as { ask_user?: unknown } | undefined)?.ask_user) as
    | { question?: string; questions?: { text?: string }[] }
    | undefined

  if (ask && event.turn_id) {
    message.askUser = {
      question: ask.question ?? ask.questions?.[0]?.text ?? 'TutorX needs your input.',
      turnId: event.turn_id
    }
  }

  $tutorMessages.set(messages)
}

async function connect() {
  if (socket && socket.readyState <= WebSocket.OPEN) {
    return
  }
  intentional = false
  $tutorConnection.set('connecting')
  socket = await createTutorSocket('/api/v1/ws')

  socket.onopen = () => {
    reconnect = 0
    $tutorConnection.set('online')
    lastReceivedAt = Date.now()
    lastStreamAt = lastReceivedAt
    startTransportTimers()

    if (activeTurn) {
      socket?.send(JSON.stringify({ seq: lastSeq, turn_id: activeTurn, type: 'resume_from' }))
    } else if ($tutorSessionId.get() && !pendingSend) {
      socket?.send(JSON.stringify({ session_id: $tutorSessionId.get(), type: 'check_active_turn' }))
    }

    if (pendingSend) {
      socket?.send(JSON.stringify(pendingSend))
      pendingSend = null
    }
  }

  socket.onmessage = raw => {
    let event: StreamEvent

    try {
      event = JSON.parse(String(raw.data)) as StreamEvent
    } catch {
      intentional = true
      socket?.close()
      failStreaming('TutorX sent an invalid streaming frame.')

      return
    }

    lastReceivedAt = Date.now()

    if (event.type === 'pong' || event.type === 'ping') {
      return
    }
    lastStreamAt = lastReceivedAt

    if (event.type === 'active_turn_info') {
      const status = (event as StreamEvent & { status?: string }).status

      if (event.turn_id && status !== 'none') {
        activeTurn = event.turn_id
        $tutorStreaming.set(true)
        socket?.send(JSON.stringify({ seq: lastSeq, turn_id: activeTurn, type: 'resume_from' }))
      } else if (!pendingSend) {
        activeTurn = null
        $tutorStreaming.set(false)
      }

      return
    }

    const eventKey = event.turn_id && event.seq != null ? `${event.turn_id}:${event.seq}` : null

    if (eventKey && seenEvents.has(eventKey)) {
      return
    }

    if (eventKey) {
      seenEvents.add(eventKey)
    }

    if (event.session_id) {
      $tutorSessionId.set(event.session_id)
    }

    if (event.turn_id) {
      activeTurn = event.turn_id
    }

    if (event.seq) {
      lastSeq = Math.max(lastSeq, event.seq)
    }
    appendAssistantEvent(event)

    if (event.type === 'done' || (event.type === 'error' && event.metadata?.turn_terminal !== false)) {
      $tutorStreaming.set(false)
      activeTurn = null
      lastSeq = 0
      void loadTutorSessions()
    }
  }

  socket.onclose = () => {
    socket = null
    clearTransportTimers()
    $tutorConnection.set('offline')

    if (!intentional && $tutorStreaming.get() && reconnect < 5) {
      window.setTimeout(() => void connect(), 200 * 2 ** reconnect++)
    } else if (!intentional && $tutorStreaming.get()) {
      failStreaming('TutorX connection closed before the turn completed.')
    }
  }

  socket.onerror = () => {
    $tutorConnection.set('offline')
  }

  if (socket.readyState === WebSocket.OPEN) {
    socket.onopen()
  }
}

export async function sendTutorMessage(
  content: string,
  options: { config?: Record<string, unknown>; inputModality?: 'text' | 'voice'; mode?: TutorMode } = {}
) {
  const text = content.trim()

  if (!text || $tutorStreaming.get()) {
    return
  }

  if (options.inputModality === 'voice') {
    assertVoiceSubmissionAllowed(text)
  }

  const voiceAttestation = options.inputModality === 'voice' ? await consumeDesktopVoiceAttestation() : undefined

  const mode = options.mode ?? $tutorMode.get()

  const defaultConfig =
    mode === 'deep_question'
      ? { mode: 'custom', num_questions: 5 }
      : mode === 'deep_research'
        ? { depth: 'standard', mode: 'report' }
        : {}

  $tutorMessages.set([
    ...$tutorMessages.get(),
    { content: text, id: `user-${Date.now()}`, role: 'user', traces: [] },
    { capability: mode, content: '', id: `assistant-${Date.now()}`, role: 'assistant', traces: [] }
  ])
  $tutorStreaming.set(true)
  pendingSend = {
    capability: mode === 'chat' ? null : mode,
    config: options.config ?? defaultConfig,
    content: text,
    knowledge_bases: [],
    language: 'en',
    input_modality: options.inputModality ?? 'text',
    voice_attestation: voiceAttestation,
    persona: '',
    session_id: $tutorSessionId.get(),
    tools: [],
    type: 'start_turn'
  }
  await connect()

  if (socket?.readyState === WebSocket.OPEN && pendingSend) {
    socket.send(JSON.stringify(pendingSend))
    pendingSend = null
  }
}

export async function detectTutorCapabilities() {
  if ($tutorCapabilities.get().checked) {
    return $tutorCapabilities.get()
  }

  try {
    await tutorFetch('/api/v1/learning/progress')
    const available = { checked: true, learningApi: true, masteryMode: true }

    $tutorCapabilities.set(available)

    return available
  } catch {
    const unavailable = { checked: true, learningApi: false, masteryMode: false }

    $tutorCapabilities.set(unavailable)

    if ($tutorMode.get() === 'mastery_path') {
      $tutorMode.set('chat')
    }

    return unavailable
  }
}

export function dismissResearchOutline(messageId: string) {
  $tutorMessages.set(
    $tutorMessages
      .get()
      .map(message => (message.id === messageId ? { ...message, researchOutline: undefined } : message))
  )
}

export function cancelTutorTurn() {
  if (activeTurn) {
    socket?.send(JSON.stringify({ turn_id: activeTurn, type: 'cancel_turn' }))
  }
}

export function regenerateTutorTurn() {
  const sessionId = $tutorSessionId.get()

  if (sessionId) {
    socket?.send(JSON.stringify({ session_id: sessionId, type: 'regenerate' }))
  }
}

export function answerTutorPrompt(turnId: string, text: string) {
  socket?.send(JSON.stringify({ text, turn_id: turnId, type: 'submit_user_reply' }))
  const messages = $tutorMessages.get().map(message => ({ ...message, askUser: undefined }))
  $tutorMessages.set(messages)
}

export async function judgeTutorQuestion(
  question: TutorQuizQuestion,
  answer: string,
  images: { base64: string; filename: string; mime_type: string }[] = []
): Promise<string> {
  return new Promise((resolve, reject) => {
    let judge: TutorSocket | null = null
    let feedback = ''

    const timeout = window.setTimeout(() => {
      judge?.close()
      reject(new Error('TutorX judging timed out'))
    }, 60_000)

    void createTutorSocket('/api/v1/question/judge')
      .then(value => {
        judge = value
        judge.onopen = () =>
          judge?.send(
            JSON.stringify({
              correct_answer: question.correct_answer ?? '',
              explanation: question.explanation ?? '',
              language: 'en',
              options: Object.fromEntries((question.options ?? []).map((option, index) => [String(index), option])),
              question: question.question,
              question_type: question.options?.length ? 'choice' : 'short_answer',
              user_answer: answer,
              user_answer_images: images
            })
          )

        judge.onmessage = raw => {
          const event = JSON.parse(String(raw.data)) as { content?: string; type?: string }

          if (event.type === 'text') {
            feedback += event.content ?? ''
          } else if (event.type === 'done') {
            window.clearTimeout(timeout)
            judge?.close()
            resolve(feedback)
          } else if (event.type === 'error') {
            window.clearTimeout(timeout)
            judge?.close()
            reject(new Error(event.content || 'TutorX could not judge this answer'))
          }
        }

        judge.onerror = () => {
          window.clearTimeout(timeout)
          reject(new Error('TutorX judging connection failed'))
        }

        if (judge.readyState === WebSocket.OPEN) {
          judge.onopen()
        }
      })
      .catch(error => {
        window.clearTimeout(timeout)
        reject(error)
      })
  })
}

export async function loadTutorSessions() {
  const result = await tutorFetch<{ sessions?: TutorSessionSummary[] }>('/api/v1/sessions?limit=50&offset=0')
  $tutorSessions.set(result.sessions ?? [])
}

export async function openTutorSession(sessionId: string) {
  intentional = true
  socket?.close()
  socket = null
  clearTransportTimers()
  activeTurn = null
  lastSeq = 0
  pendingSend = null
  seenEvents.clear()
  $tutorStreaming.set(false)

  const detail = await tutorFetch<{
    messages?: { id?: number; role: 'assistant' | 'user'; content?: string; events?: StreamEvent[] }[]
  }>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`)

  $tutorSessionId.set(sessionId)

  const activeTurnFromHistory = (detail as { active_turns?: { turn_id?: string; id?: string; last_seq?: number }[] })
    .active_turns?.[0]

  if (activeTurnFromHistory) {
    activeTurn = activeTurnFromHistory.turn_id ?? activeTurnFromHistory.id ?? null
    lastSeq = activeTurnFromHistory.last_seq ?? 0
    $tutorStreaming.set(Boolean(activeTurn))
  }

  await connect()

  $tutorMessages.set(
    (detail.messages ?? []).map(message => {
      const events = message.events ?? []
      const result = [...events].reverse().find(event => event.type === 'result')
      const metadata = result?.metadata ?? {}
      const summary = metadata.summary as { results?: { qa_pair?: TutorQuizQuestion }[] } | undefined
      const renderType = metadata.render_type

      return {
        artifact: ['chartjs', 'html', 'manim_image', 'manim_video', 'mermaid', 'svg'].includes(String(renderType))
          ? {
              content: String((metadata.code as { content?: string } | undefined)?.content ?? ''),
              renderType: renderType as TutorVisualArtifact['renderType'],
              url: String(metadata.url ?? '') || undefined
            }
          : undefined,
        content: message.content ?? '',
        id: String(message.id ?? crypto.randomUUID()),
        quiz: summary?.results?.flatMap(item => (item.qa_pair ? [item.qa_pair] : [])),
        researchOutline: metadata.outline_preview
          ? {
              researchConfig: (metadata.research_config ?? {}) as Record<string, unknown>,
              subTopics: ((metadata.sub_topics ?? []) as { overview?: string; title?: string }[]).map(topic => ({
                overview: String(topic.overview ?? ''),
                title: String(topic.title ?? '')
              })),
              topic: String(metadata.topic ?? '')
            }
          : undefined,
        role: message.role,
        traces: events
          .filter(event => event.type !== 'content')
          .map(event => ({ content: event.content ?? '', label: event.type.replaceAll('_', ' '), type: event.type }))
      }
    })
  )
}

export function newTutorSession() {
  intentional = true
  socket?.close()
  socket = null
  clearTransportTimers()
  activeTurn = null
  lastSeq = 0
  seenEvents.clear()
  $tutorSessionId.set(null)
  $tutorMessages.set([])
  $tutorStreaming.set(false)
}

export function disposeTutorChat() {
  intentional = true
  clearTransportTimers()
  socket?.close()
  socket = null
  pendingSend = null
  activeTurn = null
  lastSeq = 0
  reconnect = 0
  seenEvents.clear()
  $tutorSessionId.set(null)
  $tutorStreaming.set(false)
  $tutorConnection.set('offline')
}
