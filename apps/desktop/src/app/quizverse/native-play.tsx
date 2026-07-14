import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { openNativeSurface } from './native-surface-store'
import { NativeSurfaceRouter } from './native-surfaces'
import {
  createSyncBeatTimeline,
  decodeLiveProtocolFrame,
  firstSupportedPartyRpc,
  LIVE_MATCH_QUERY,
  liveAnswerPayload,
  OP_TURN_INPUT_SUBMIT,
  PARTY_CREATE_RPCS,
  PARTY_JOIN_RPCS,
  scoreSyncBeat
} from './play-protocols'
import {
  $playAuthState,
  $playResult,
  $playSession,
  $playSubmission,
  ensurePlaySession,
  fetchPlayQuestions,
  PLAY_MODES,
  type PlayMode,
  type PlayQuestion,
  playRpc,
  submitPlayResult
} from './play-store'
import { createTutorSocket, type TutorSocket } from './tutor-api'

function ModeGrid({ onSelect }: { onSelect: (mode: PlayMode) => void }) {
  const [filter, setFilter] = useState('all')
  const categories = ['all', ...new Set(PLAY_MODES.map(mode => mode.category))]

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex flex-wrap gap-1">
          {categories.map(category => (
            <Button key={category} onClick={() => setFilter(category)} size="xs" variant={filter === category ? 'secondary' : 'ghost'}>
              {category}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLAY_MODES.filter(mode => filter === 'all' || mode.category === filter).map(mode => (
            <button
              className={cn('qv-glass-tile min-h-32 rounded-xl p-4 text-left', !mode.available && 'qv-disabled-tile')}
              key={mode.id}
              onClick={() => onSelect(mode)}
              type="button"
            >
              <span className="text-2xl">{mode.icon}</span>
              <h3 className="mt-2 text-sm font-semibold">{mode.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {mode.available
                  ? mode.source === 'external'
                    ? 'Native media quiz'
                    : mode.source === 'weekly'
                      ? 'Native weekly challenge'
                      : mode.source === 'ai'
                        ? 'Native AI-generated quiz'
                        : 'Native question-pack play'
                  : mode.reason}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function QuizGame({
  initialQuestions,
  mode,
  onBack,
  onProtocolResult
}: {
  initialQuestions?: PlayQuestion[]
  mode: PlayMode
  onBack: () => void
  onProtocolResult?: (result: { correct: number; score: number; total: number }) => Promise<unknown>
}) {
  const [questions, setQuestions] = useState<PlayQuestion[]>([])
  const [packId, setPackId] = useState<string>()
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<(number | null)[]>([])
  const [latencies, setLatencies] = useState<number[]>([])
  const [selected, setSelected] = useState<null | number>(null)
  const [topic, setTopic] = useState('')
  const [error, setError] = useState<null | string>(null)
  const [provenance, setProvenance] = useState('')
  const result = useStore($playResult)
  const submission = useStore($playSubmission)
  const gameStartedAt = useRef(0)
  const questionStartedAt = useRef(0)

  const start = useCallback(() => {
    setError(null)
    $playResult.set(null)
    void (initialQuestions
      ? Promise.resolve({
          fallbackReason: undefined,
          packId: undefined,
          provenance: mode.protocol ?? 'protocol',
          questions: initialQuestions
        })
      : fetchPlayQuestions(mode, topic))
      .then(data => {
        setQuestions(data.questions)
        setPackId(data.packId)
        setProvenance(data.fallbackReason ? `${data.provenance} fallback: ${data.fallbackReason}` : data.provenance)
        setIndex(0)
        setAnswers([])
        setLatencies([])
        setSelected(null)
        gameStartedAt.current = performance.now()
        questionStartedAt.current = performance.now()
      })
      .catch(reason => setError(String(reason)))
  }, [initialQuestions, mode, topic])

  useEffect(() => {
    if (mode.source !== 'ai') {
      start()
    }
  }, [mode.source, start])

  if (!mode.available) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="text-4xl">{mode.icon}</div><h2>{mode.name}</h2><p className="max-w-md text-xs text-muted-foreground">{mode.reason}</p>
        <Button onClick={onBack} size="sm">Back to modes</Button>
      </div>
    )
  }

  if (mode.source === 'ai' && questions.length === 0 && !error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <h2 className="text-lg font-semibold">{mode.name}</h2>
        <input className="w-80 rounded border border-(--ui-border-primary) bg-transparent px-3 py-2 text-sm" onChange={event => setTopic(event.target.value)} placeholder="What should the quiz be about?" value={topic} />
        <div className="flex gap-2"><Button onClick={onBack} variant="ghost">Back</Button><Button disabled={!topic.trim()} onClick={start}>Generate quiz</Button></div>
      </div>
    )
  }

  if (error) {
    return <div className="flex h-full flex-col items-center justify-center gap-3"><p className="max-w-lg text-sm text-red-400">{error}</p><Button onClick={start}>Retry</Button><Button onClick={onBack} variant="ghost">Back</Button></div>
  }

  if (result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <img alt="" className="size-24" src={`${import.meta.env.BASE_URL}quizverse/quizy-front.png`} />
        <h2 className="text-xl font-semibold">Quiz complete!</h2>
        <div className="text-4xl font-bold text-violet-300">{result.score}</div>
        <p className="text-sm text-muted-foreground">{result.correct} of {result.total} correct</p>
        {!result.ranked && (
          <div className="max-w-md rounded-lg border border-amber-300/45 bg-amber-950/35 px-4 py-3 text-sm text-amber-100">
            <strong>Unranked result.</strong> {result.reason}
          </div>
        )}
        {result.ranked && result.rank != null && (
          <p className="text-sm text-muted-foreground">Leaderboard rank #{result.rank}</p>
        )}
        <div className="flex gap-2"><Button onClick={start}>Play again</Button><Button onClick={onBack} variant="secondary">Modes</Button></div>
      </div>
    )
  }

  const question = questions[index]

  if (!question) {return <div className="flex h-full items-center justify-center"><Codicon name="loading~spin" /></div>}

  const finish = (nextAnswers: (number | null)[]) =>
    void submitPlayResult(
      mode,
      questions,
      nextAnswers,
      packId,
      Math.round(performance.now() - gameStartedAt.current),
      latencies
    )
      .then(result => onProtocolResult?.(result))
      .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
          <Button onClick={onBack} size="xs" variant="ghost"><Codicon name="arrow-left" /> Modes</Button>
          <span>{index + 1} / {questions.length} · {provenance}</span>
        </div>
        {question.mediaUrl && <img alt="" className="mb-4 max-h-64 w-full rounded-xl object-contain" src={question.mediaUrl} />}
        <h2 className="text-lg font-semibold">{question.prompt}</h2>
        <div className="mt-5 grid gap-2">
          {question.options.map((option, optionIndex) => (
            <button
              className={cn(
                'rounded-xl border border-(--ui-border-primary) p-3 text-left text-sm hover:border-violet-400/50',
                selected === optionIndex && 'border-violet-400 bg-violet-500/15'
              )}
              disabled={selected !== null}
              key={option}
              onClick={() => {
                setSelected(optionIndex)
                setAnswers([...answers, optionIndex])
                setLatencies([...latencies, Math.round(performance.now() - questionStartedAt.current)])
              }}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
        {selected !== null && (
          <div className="mt-4 rounded-xl bg-black/15 p-3 text-xs">
            <p className={selected === question.correctIndex ? 'text-emerald-400' : 'text-red-400'}>
              {selected === question.correctIndex ? 'Correct!' : `Answer: ${question.options[question.correctIndex]}`}
            </p>
            {question.explanation && <p className="mt-1 text-muted-foreground">{question.explanation}</p>}
            <Button
              className="mt-3"
              onClick={() => {
                if (index + 1 >= questions.length) {finish(answers)}
                else {
                  setIndex(index + 1)
                  setSelected(null)
                  questionStartedAt.current = performance.now()
                }
              }}
              size="sm"
            >
              {index + 1 >= questions.length
                ? submission.phase === 'submitting'
                  ? 'Submitting…'
                  : 'Results'
                : 'Next'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function PhantomLobby({ mode, onBack }: { mode: PlayMode; onBack: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [session, setSession] = useState<{ challengeId: string; questions: PlayQuestion[]; shareCode: string } | null>(null)
  const [topic, setTopic] = useState('General Knowledge')

  const adopt = (result: Record<string, unknown>, fallbackCode = '') => {
    const questions = (result.questions ? result.questions : result) as unknown

    const normalized = Array.isArray(questions)
      ? questions.flatMap((item, index) => {
          const raw = item as Record<string, unknown>
          const options = Array.isArray(raw.options) ? raw.options.map(String) : []
          const correctIndex = Number(raw.correctIndex ?? raw.correct_index ?? raw.correct_answer)

          return options.length >= 2 && Number.isInteger(correctIndex)
            ? [{
                correctIndex,
                id: String(raw.id ?? raw.question_id ?? index),
                options,
                prompt: String(raw.prompt ?? raw.question ?? '')
              }]
            : []
        })
      : []

    if (!normalized.length) {
      throw new Error('The challenge server returned no playable questions.')
    }

    setSession({
      challengeId: String(result.sessionId ?? result.session_id ?? result.challenge_id ?? result.id ?? ''),
      questions: normalized,
      shareCode: String(result.shareCode ?? result.share_code ?? result.code ?? fallbackCode)
    })
  }

  if (session) {
    return (
      <QuizGame
        initialQuestions={session.questions}
        mode={mode}
        onBack={onBack}
        onProtocolResult={result =>
          playRpc('async_challenge_submit', {
            challenge_id: session.challengeId,
            correct: result.correct,
            idempotency_key: crypto.randomUUID(),
            score: result.score,
            session_id: session.challengeId,
            total: result.total
          })
        }
      />
    )
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-3 p-5">
      <Button onClick={onBack} size="xs" variant="ghost">Back to modes</Button>
      <h2 className="text-lg font-semibold">Phantom Challenge</h2>
      <input className="rounded border border-(--ui-border-primary) bg-transparent px-3 py-2 text-sm" onChange={event => setTopic(event.target.value)} value={topic} />
      <Button
        onClick={() =>
          void playRpc<Record<string, unknown>>('async_challenge_create', {
            count: mode.count,
            idempotency_key: crypto.randomUUID(),
            topic
          }).then(adopt).catch(reason => setError(String(reason)))
        }
      >
        Create challenge
      </Button>
      <div className="flex gap-2">
        <input className="min-w-0 flex-1 rounded border border-(--ui-border-primary) bg-transparent px-3 py-2 text-sm uppercase" onChange={event => setCode(event.target.value.toUpperCase())} placeholder="Invite code" value={code} />
        <Button
          disabled={code.trim().length < 4}
          onClick={() =>
            void playRpc<Record<string, unknown>>('async_challenge_join', {
              code: code.trim(),
              share_code: code.trim()
            }).then(result => adopt(result, code)).catch(reason => setError(String(reason)))
          }
          variant="secondary"
        >
          Join
        </Button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

function TournamentLobby({ onBack }: { onBack: () => void }) {
  const [error, setError] = useState('')
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [status, setStatus] = useState('')

  useEffect(() => {
    void playRpc<{ tournaments?: Record<string, unknown>[] }>('tournament_list')
      .then(result => setItems(result.tournaments ?? []))
      .catch(reason => setError(String(reason)))
  }, [])

  return (
    <div className="h-full overflow-y-auto p-5">
      <Button onClick={onBack} size="xs" variant="ghost">Back to modes</Button>
      <h2 className="mt-3 text-lg font-semibold">Tournaments</h2>
      <p className="text-xs text-muted-foreground">Enrollment uses the server entitlement and entry-fee protocol.</p>
      <div className="mt-4 grid gap-2">
        {items.map((item, index) => {
          const slug = String(item.slug ?? item.id ?? index)

          return (
            <article className="qv-glass-tile rounded-lg p-3 text-sm" key={slug}>
              <strong>{String(item.title ?? item.name ?? slug)}</strong>
              <Button
                className="ml-3"
                onClick={() =>
                  void playRpc('tournament_enter', { idempotency_key: crypto.randomUUID(), slug })
                    .then(() => setStatus(`Enrolled in ${slug}`))
                    .catch(reason => setError(String(reason)))
                }
                size="xs"
              >
                Enroll
              </Button>
            </article>
          )
        })}
      </div>
      {status && <p className="mt-3 text-xs text-emerald-400">{status}</p>}
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </div>
  )
}

function PartyLobby({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [party, setParty] = useState<Record<string, unknown> | null>(null)
  const [status, setStatus] = useState('')

  const adopt = (action: 'created' | 'joined') => ({ name, result }: { name: string; result: Record<string, unknown> }) => {
    const data = (result.data ?? result) as Record<string, unknown>

    setParty(data)
    setStatus(`Party ${action} through ${name}. Waiting for the host to start the match.`)
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-3 p-5">
      <Button onClick={onBack} size="xs" variant="ghost">Back to modes</Button>
      <h2 className="text-lg font-semibold">Party & Trivia</h2>
      <p className="text-xs text-muted-foreground">
        Native party matchmaking uses the deployed matchmaking RPC, with the legacy party protocol as compatibility fallback.
      </p>
      <Button
        onClick={() => void firstSupportedPartyRpc(PARTY_CREATE_RPCS, {
          idempotency_key: crypto.randomUUID(),
          game_id: 'quizverse',
          max_players: 12,
          mode: 'PartyAndTrivia'
        }, playRpc).then(adopt('created')).catch(reason => setError(String(reason)))}
      >
        Host party
      </Button>
      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded border border-(--ui-border-primary) bg-transparent px-3 py-2 text-sm uppercase"
          onChange={event => setCode(event.target.value.toUpperCase())}
          placeholder="Party code"
          value={code}
        />
        <Button
          disabled={code.trim().length < 4}
          onClick={() => void firstSupportedPartyRpc(PARTY_JOIN_RPCS, {
            code: code.trim(),
            game_id: 'quizverse',
            party_code: code.trim()
          }, playRpc).then(adopt('joined')).catch(reason => setError(String(reason)))}
          variant="secondary"
        >
          Join
        </Button>
      </div>
      {party && <pre className="max-h-32 overflow-auto rounded bg-black/15 p-2 text-[0.65rem]">{JSON.stringify(party, null, 2)}</pre>}
      {status && <p className="text-xs text-emerald-400">{status}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

interface LiveQuestionState {
  id: string
  options: string[]
  openedAt: number
  prompt: string
}

function LiveArena({ onBack }: { onBack: () => void }) {
  const [connectionId, setConnectionId] = useState('')
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<'connecting' | 'ended' | 'error' | 'question' | 'waiting'>('connecting')
  const [question, setQuestion] = useState<LiveQuestionState | null>(null)
  const [reveal, setReveal] = useState('')
  const [scores, setScores] = useState<Record<string, unknown>>({})
  const bridge = window.hermesDesktop?.quizverse

  useEffect(() => {
    let disposed = false
    let activeId = ''

    const unsubscribe = bridge?.onPlayRealtimeEvent(event => {
      if (event.id !== activeId || event.type !== 'match-data') {
        if (event.id === activeId && (event.type === 'disconnect' || event.type === 'error')) {
          setPhase('error')
          setError(String(event.data ?? 'The realtime server disconnected.'))
        }

        return
      }

      const frame = event.data as { data?: unknown; opCode?: unknown }
      const decoded = decodeLiveProtocolFrame(frame)

      if (decoded.type === 'turn') {
        const turn = (decoded.payload.turn_payload ?? {}) as Record<string, unknown>

        setQuestion({
          id: String(turn.question_id ?? ''),
          openedAt: performance.now(),
          options: Array.isArray(turn.options) ? turn.options.map(String) : [],
          prompt: String(turn.text ?? '')
        })
        setReveal('')
        setPhase('question')
      } else if (decoded.type === 'turn-resolved') {
        const result = (decoded.payload.result_payload ?? {}) as Record<string, unknown>

        setReveal(`Correct option: ${Number(result.correct_option ?? -1) + 1}${result.explanation ? ` — ${String(result.explanation)}` : ''}`)
        setPhase('waiting')
      } else if (decoded.type === 'score') {
        setScores((decoded.payload.totals ?? {}) as Record<string, unknown>)
      } else if (decoded.type === 'ended') {
        setPhase('ended')
      }
    })

    void (async () => {
      if (!bridge?.playRealtimeConnect) {
        throw new Error('This desktop runtime does not include the secure Nakama realtime bridge.')
      }

      const connection = await bridge.playRealtimeConnect()

      if (disposed) {
        await bridge.playRealtimeClose(connection.id)

        return
      }

      activeId = connection.id
      setConnectionId(connection.id)
      const matches = await bridge.playRealtimeListMatches(connection.id, LIVE_MATCH_QUERY)
      const open = matches.find(match => match.match_id)?.match_id

      if (open) {
        await bridge.playRealtimeJoinMatch(connection.id, open)
      } else {
        await bridge.playRealtimeCreateMatch(connection.id, {
          mode: 'quizverse:classic',
          per_question_ms: 15_000,
          questions_total: 10
        })
      }

      setPhase('waiting')
    })().catch(reason => {
      setError(reason instanceof Error ? reason.message : String(reason))
      setPhase('error')
    })

    return () => {
      disposed = true
      unsubscribe?.()

      if (activeId) {
        void bridge?.playRealtimeClose(activeId)
      }
    }
  }, [bridge])

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-4 p-5 text-center">
      <Button className="self-start" onClick={onBack} size="xs" variant="ghost">Back to modes</Button>
      <h2 className="text-xl font-semibold">Live Arena</h2>
      {phase === 'connecting' && <p className="text-sm text-muted-foreground">Connecting to sync-turn-v1…</p>}
      {phase === 'waiting' && <p className="text-sm text-muted-foreground">{reveal || 'Match joined. Waiting for the next server turn…'}</p>}
      {phase === 'question' && question && (
        <section className="qv-glass-tile rounded-xl p-4 text-left">
          <h3 className="text-lg font-semibold">{question.prompt}</h3>
          <div className="mt-3 grid gap-2">
            {question.options.map((option, index) => (
              <Button
                key={`${option}-${index}`}
                onClick={() => {
                  if (connectionId) {
                    void bridge?.playRealtimeSend(
                      connectionId,
                      OP_TURN_INPUT_SUBMIT,
                      liveAnswerPayload(question.id, index, performance.now() - question.openedAt)
                    )
                    setPhase('waiting')
                  }
                }}
                variant="secondary"
              >
                {option}
              </Button>
            ))}
          </div>
        </section>
      )}
      {phase === 'ended' && <p className="text-sm">Match complete.</p>}
      {Object.keys(scores).length > 0 && <p className="text-xs text-muted-foreground">Scores: {JSON.stringify(scores)}</p>}
      {phase === 'error' && (
        <div className="rounded-lg border border-red-400/40 bg-red-950/25 p-3 text-sm text-red-200">
          Live Arena is unavailable: {error}
        </div>
      )}
    </div>
  )
}

function AiChatGame({ onBack }: { onBack: () => void }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [messages, setMessages] = useState<{ content: string; role: 'assistant' | 'user' }[]>([])
  const [streaming, setStreaming] = useState(false)
  const socketRef = useRef<TutorSocket | null>(null)

  useEffect(() => () => socketRef.current?.close(), [])

  const send = async () => {
    const text = draft.trim()

    if (!text || streaming) {
      return
    }

    setDraft('')
    setError('')
    setMessages(current => [...current, { content: text, role: 'user' }, { content: '', role: 'assistant' }])
    setStreaming(true)

    try {
      const socket = socketRef.current ?? await createTutorSocket('/api/v1/ws')

      socketRef.current = socket

      socket.onmessage = event => {
        try {
          const frame = JSON.parse(event.data) as { content?: string; type?: string }

          if (frame.type === 'content' && frame.content) {
            setMessages(current => current.map((message, index) =>
              index === current.length - 1 ? { ...message, content: message.content + frame.content } : message
            ))
          } else if (frame.type === 'done') {
            setStreaming(false)
          } else if (frame.type === 'error') {
            setStreaming(false)
            setError(frame.content ?? 'TutorX AI Chat failed.')
          }
        } catch {
          setStreaming(false)
          setError('TutorX AI Chat returned a malformed frame.')
        }
      }

      socket.onerror = () => {
        setStreaming(false)
        setError('TutorX AI Chat is not reachable. Configure a hosted or local TutorX service in Setup.')
      }

      const start = () => socket.send(JSON.stringify({
        capability: null,
        config: {},
        content: text,
        knowledge_bases: [],
        language: 'en',
        persona: '',
        session_id: null,
        tools: [],
        type: 'start_turn'
      }))

      if (socket.readyState === WebSocket.OPEN) {
        start()
      } else {
        socket.onopen = start
      }
    } catch (reason) {
      setStreaming(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-(--ui-border-primary) p-2">
        <Button onClick={onBack} size="xs" variant="ghost">Back to modes</Button>
        <strong className="text-sm">AI Chat</strong>
        <span className="text-xs text-muted-foreground">Native TutorX conversation protocol</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.map((message, index) => (
          <div
            className={cn('max-w-2xl rounded-lg p-3 text-sm', message.role === 'user' ? 'ml-auto bg-violet-500/20' : 'bg-black/15')}
            key={`${message.role}-${index}`}
          >
            {message.content || '…'}
          </div>
        ))}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
      <form className="flex gap-2 border-t border-(--ui-border-primary) p-3" onSubmit={event => { event.preventDefault(); void send() }}>
        <input className="min-w-0 flex-1 rounded border border-(--ui-border-primary) bg-transparent px-3 py-2 text-sm" onChange={event => setDraft(event.target.value)} placeholder="Ask the QuizVerse AI coach…" value={draft} />
        <Button disabled={!draft.trim() || streaming} type="submit">Send</Button>
      </form>
    </div>
  )
}

function SyncBeatGame({ onBack }: { onBack: () => void }) {
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ReturnType<typeof scoreSyncBeat> | null>(null)
  const [taps, setTaps] = useState<number[]>([])
  const startAt = useRef(0)
  const timeline = useRef(createSyncBeatTimeline(20260712))

  useEffect(() => {
    if (!running) {
      return
    }

    const timer = window.setInterval(() => {
      const next = performance.now() - startAt.current

      setElapsed(next)

      if (next > (timeline.current.at(-1)?.atMs ?? 0) + 800) {
        window.clearInterval(timer)
        setRunning(false)
        setResult(scoreSyncBeat(timeline.current, taps))
      }
    }, 40)

    return () => window.clearInterval(timer)
  }, [running, taps])

  const start = () => {
    setTaps([])
    setResult(null)
    setElapsed(0)
    startAt.current = performance.now()
    setRunning(true)
  }

  const nextBeat = timeline.current.find(beat => beat.atMs >= elapsed)

  return (
    <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-4 p-5 text-center">
      <Button className="self-start" onClick={onBack} size="xs" variant="ghost">Back to modes</Button>
      <h2 className="text-xl font-semibold">Sync with Beat</h2>
      <p className="text-xs text-muted-foreground">A native deterministic rhythm timeline. Tap as the pulse reaches zero.</p>
      <div className="text-5xl font-bold text-violet-300">
        {running && nextBeat ? Math.max(0, Math.round(nextBeat.atMs - elapsed)) : result ? `${Math.round(result.accuracy * 100)}%` : 'Ready'}
      </div>
      <Button
        className="h-24 w-56 text-lg"
        disabled={!running}
        onClick={() => setTaps(current => [...current, performance.now() - startAt.current])}
      >
        TAP
      </Button>
      {!running && <Button onClick={start}>{result ? 'Play again' : 'Start rhythm'}</Button>}
      {result && <p className="text-sm text-muted-foreground">{result.hits}/{result.total} beats · average offset {Math.round(result.averageOffsetMs)}ms</p>}
    </div>
  )
}

function PlayerHeader() {
  const session = useStore($playSession)
  const state = useStore($playAuthState)
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null)
  useEffect(() => {
    void ensurePlaySession()
      .then(() => playRpc<Record<string, unknown>>('player_get_full_profile'))
      .then(setProfile)
      .catch(() => {})
  }, [])

  return (
    <div className="flex h-10 shrink-0 items-center border-b border-(--ui-border-primary) px-3 text-xs">
      <span className="font-medium">{session?.username || (state === 'error' ? 'Guest auth unavailable' : 'Connecting guest…')}</span>
      <span className="ml-auto text-muted-foreground">{profile ? 'Profile synced' : state}</span>
    </div>
  )
}

export function NativePlay() {
  const [mode, setMode] = useState<null | PlayMode>(null)

  if (mode?.protocol === 'native-surface') {
    return <NativeSurfaceRouter onBack={() => setMode(null)} />
  }

  return (
    <div className="bg-quizverse-mesh flex h-full min-h-0 flex-col rounded-lg">
      <PlayerHeader />
      <div className="min-h-0 flex-1">
        {mode?.protocol === 'live'
          ? <LiveArena onBack={() => setMode(null)} />
          : mode?.protocol === 'party'
            ? <PartyLobby onBack={() => setMode(null)} />
            : mode?.protocol === 'ai-chat'
              ? <AiChatGame onBack={() => setMode(null)} />
              : mode?.protocol === 'sync-beat'
                ? <SyncBeatGame onBack={() => setMode(null)} />
                : mode?.protocol === 'phantom'
          ? <PhantomLobby mode={mode} onBack={() => setMode(null)} />
          : mode?.protocol === 'tournament'
            ? <TournamentLobby onBack={() => setMode(null)} />
            : mode
              ? <QuizGame mode={mode} onBack={() => setMode(null)} />
              : <ModeGrid onSelect={selected => {
                if (selected.protocol === 'native-surface') {
                  openNativeSurface('link-play', 'library')
                }

                setMode(selected)
              }} />}
      </div>
    </div>
  )
}
