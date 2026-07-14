// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./tutor-api', () => ({
  createTutorSocket: vi.fn(async (path: string) => new WebSocket(`ws://tutor.test${path}`)),
  tutorFetch: vi.fn(async () => ({ sessions: [] })),
  tutorWsUrl: vi.fn(async (path: string) => `ws://tutor.test${path}`)
}))

import { tutorFetch } from './tutor-api'
import {
  $tutorCapabilities,
  $tutorConnection,
  $tutorMessages,
  $tutorSessionId,
  $tutorStreaming,
  detectTutorCapabilities,
  disposeTutorChat,
  newTutorSession,
  openTutorSession,
  sendTutorMessage
} from './tutor-chat-store'

class MockWebSocket {
  static CLOSED = 3
  static CLOSING = 2
  static CONNECTING = 0
  static OPEN = 1
  static instances: MockWebSocket[] = []

  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  readyState = MockWebSocket.CONNECTING
  sent: Record<string, unknown>[] = []

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  emit(value: unknown) {
    this.onmessage?.({ data: typeof value === 'string' ? value : JSON.stringify(value) })
  }

  open() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  send(value: string) {
    this.sent.push(JSON.parse(value) as Record<string, unknown>)
  }
}

describe('TutorX transport lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.mocked(tutorFetch).mockResolvedValue({ sessions: [] })
    $tutorCapabilities.set({ checked: false, learningApi: false, masteryMode: false })
    newTutorSession()
  })

  afterEach(() => {
    disposeTutorChat()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('supports sequential turns on one healthy socket', async () => {
    const first = sendTutorMessage('first')

    await vi.advanceTimersByTimeAsync(0)
    const socket = MockWebSocket.instances[0]

    socket.open()
    await first
    socket.emit({ seq: 1, session_id: 'session-1', turn_id: 'turn-1', type: 'content', content: 'one' })
    socket.emit({ seq: 2, turn_id: 'turn-1', type: 'done' })
    await sendTutorMessage('second')

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(socket.sent.filter(message => message.type === 'start_turn')).toHaveLength(2)
    expect($tutorStreaming.get()).toBe(true)
  })

  it('sends hosted-compatible Research defaults', async () => {
    const started = sendTutorMessage('compare the approaches', { mode: 'deep_research' })

    await vi.advanceTimersByTimeAsync(0)
    const socket = MockWebSocket.instances[0]

    socket.open()
    await started
    expect(socket.sent.find(message => message.type === 'start_turn')).toEqual(expect.objectContaining({
      capability: 'deep_research',
      config: { depth: 'standard', mode: 'report' }
    }))
  })

  it('detects unsupported Learning without exposing mastery mode', async () => {
    vi.mocked(tutorFetch).mockRejectedValueOnce(new Error('TutorX request failed (404)'))

    await expect(detectTutorCapabilities()).resolves.toEqual({
      checked: true,
      learningApi: false,
      masteryMode: false
    })
  })

  it('deduplicates replayed sequence events and resets on terminal errors', async () => {
    const started = sendTutorMessage('dedupe')

    await vi.advanceTimersByTimeAsync(0)
    const socket = MockWebSocket.instances[0]

    socket.open()
    await started
    const content = { content: 'only once', seq: 4, turn_id: 'turn-d', type: 'content' }

    socket.emit(content)
    socket.emit(content)
    socket.emit({ content: 'failed', metadata: { turn_terminal: true }, seq: 5, turn_id: 'turn-d', type: 'error' })
    expect($tutorMessages.get().at(-1)?.content).toBe('only oncefailed')
    expect($tutorStreaming.get()).toBe(false)
  })

  it('fails closed on malformed frames', async () => {
    const started = sendTutorMessage('malformed')

    await vi.advanceTimersByTimeAsync(0)
    const socket = MockWebSocket.instances[0]

    socket.open()
    await started
    socket.emit('{no-json')
    expect($tutorStreaming.get()).toBe(false)
    expect($tutorConnection.get()).toBe('offline')
    expect($tutorMessages.get().at(-1)?.content).toContain('invalid streaming frame')
  })

  it('recovers active turns and resumes from the last sequence', async () => {
    vi.mocked(tutorFetch).mockResolvedValueOnce({
      active_turns: [{ last_seq: 8, turn_id: 'active-1' }],
      messages: [],
      sessions: []
    })
    const opening = openTutorSession('session-active')

    await vi.advanceTimersByTimeAsync(0)
    const socket = MockWebSocket.instances[0]

    socket.open()
    await opening
    expect(socket.sent).toContainEqual({ seq: 8, turn_id: 'active-1', type: 'resume_from' })
    socket.emit({ status: 'running', turn_id: 'active-1', type: 'active_turn_info' })
    expect(socket.sent.filter(message => message.type === 'resume_from')).toHaveLength(2)
  })

  it('reconnects an interrupted turn and fully disposes state', async () => {
    const started = sendTutorMessage('reconnect')

    await vi.advanceTimersByTimeAsync(0)
    const first = MockWebSocket.instances[0]

    first.open()
    await started
    first.emit({ content: 'part', seq: 3, session_id: 'session-r', turn_id: 'turn-r', type: 'content' })
    first.close()
    await vi.advanceTimersByTimeAsync(200)
    const second = MockWebSocket.instances[1]

    second.open()
    expect(second.sent).toContainEqual({ seq: 3, turn_id: 'turn-r', type: 'resume_from' })
    disposeTutorChat()
    expect($tutorSessionId.get()).toBeNull()
    expect($tutorStreaming.get()).toBe(false)
    expect($tutorConnection.get()).toBe('offline')
  })

  it('terminates turns that exceed the idle watchdog', async () => {
    const started = sendTutorMessage('idle')

    await vi.advanceTimersByTimeAsync(0)
    const socket = MockWebSocket.instances[0]

    socket.open()
    await started

    for (let index = 0; index < 6; index += 1) {
      await vi.advanceTimersByTimeAsync(30_000)
      socket.emit({ type: 'pong' })
    }

    await vi.advanceTimersByTimeAsync(1_001)
    expect($tutorStreaming.get()).toBe(false)
    expect($tutorMessages.get().at(-1)?.content).toContain('stopped responding')
  })
})
