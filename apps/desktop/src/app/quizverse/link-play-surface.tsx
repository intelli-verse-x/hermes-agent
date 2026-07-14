import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

import { createSseAccumulator, productRequest, productStream } from './engines/product-client'
import {
  audiobookLibraryPath,
  audiobookPositionPayload,
  debateScorePayload
} from './engines/service-contracts'
import { openNativeSurface } from './native-surface-store'
import { ensurePlaySession, playRpc } from './play-store'

interface LinkPlaySurfaceProps {
  route: string
}

interface LapNote {
  createdAt: string
  flashcards: LapFlashcard[]
  id: string
  questions: LapQuestion[]
  status: 'error' | 'processing' | 'ready'
  text: string
  title: string
  type: string
}

interface LapQuestion {
  correctOptionId: string
  explanation?: string
  id: string
  options: { id: string; text: string }[]
  text: string
}

interface LapFlashcard {
  back: string
  front: string
  id: string
}

const noteKey = 'qv_lap_selected_note_v1'
const missionKey = 'qv_lap_missions_desktop_v1'

interface LapMission {
  claimed: boolean
  description: string
  id: string
  progress: number
  required: number
  rewardXp: number
  title: string
}

const DEFAULT_MISSIONS: LapMission[] = [
  { claimed: false, description: 'Complete one generated quiz', id: 'daily-quiz', progress: 0, required: 1, rewardXp: 30, title: 'Quiz Time' },
  { claimed: false, description: 'Study five flashcards', id: 'daily-cards', progress: 0, required: 5, rewardXp: 25, title: 'Card Shuffle' },
  { claimed: false, description: 'Win a realtime battle', id: 'weekly-battle', progress: 0, required: 1, rewardXp: 100, title: 'Battle Ready' }
]

function readMissions(): LapMission[] {
  try {
    const stored = JSON.parse(localStorage.getItem(missionKey) ?? '') as { day: string; missions: LapMission[] }

    if (stored.day === new Date().toISOString().slice(0, 10) && Array.isArray(stored.missions)) {return stored.missions}
  } catch {
    // Daily source-compatible mission state starts clean when absent or damaged.
  }

  const missions = DEFAULT_MISSIONS.map(mission => ({ ...mission }))
  localStorage.setItem(missionKey, JSON.stringify({ day: new Date().toISOString().slice(0, 10), missions }))

  return missions
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function unwrap(value: unknown): Record<string, unknown> {
  const root = object(value)

  return object(root.data ?? root.note ?? root)
}

function rows(value: unknown, key: string): Record<string, unknown>[] {
  if (Array.isArray(value)) {return value.map(object)}
  const root = object(value)
  const data = object(root.data ?? root)
  const candidates = data[key]

  return Array.isArray(candidates) ? candidates.map(object) : []
}

function mapQuestion(raw: Record<string, unknown>, index: number): LapQuestion | null {
  const text = String(raw.question ?? raw.text ?? raw.prompt ?? '')

  const answerRows = Array.isArray(raw.quiz_answers ?? raw.question_answers)
    ? (raw.quiz_answers ?? raw.question_answers) as unknown[]
    : []

  const rawOptions = answerRows.length
    ? answerRows.map(object)
    : Array.isArray(raw.options ?? raw.choices)
      ? ((raw.options ?? raw.choices) as unknown[]).map(option => typeof option === 'object' ? object(option) : { text: String(option) })
      : []

  const options = rawOptions.map((option, optionIndex) => ({
    id: String(option.id ?? option.optionId ?? `o-${index}-${optionIndex}`),
    text: String(option.content ?? option.text ?? option.label ?? option.option ?? '')
  }))

  const correct = answerRows.find(item => object(item).is_correct === true)
  const byIndex = options[Number(raw.correctIndex ?? raw.correct_index ?? -1)]?.id
  const correctOptionId = String(object(correct).id ?? raw.correctOptionId ?? raw.correct_answer ?? byIndex ?? '')

  return text && options.length >= 2
    ? { correctOptionId, explanation: raw.explanation ? String(raw.explanation) : undefined, id: String(raw.id ?? `q-${index}`), options, text }
    : null
}

function mapNote(raw: Record<string, unknown>): LapNote {
  const quiz = object(raw.quiz)

  const rawQuestions = Array.isArray(quiz.questions)
    ? quiz.questions as unknown[]
    : Array.isArray(raw.quizzes)
      ? raw.quizzes as unknown[]
      : []

  const questions = rawQuestions.map((item, index) => mapQuestion(object(item), index)).filter((item): item is LapQuestion => Boolean(item))

  const flashcards = (Array.isArray(raw.flashcards) ? raw.flashcards : []).map((item, index) => {
    const card = object(item)

    return {
      back: String(card.answer ?? card.back ?? ''),
      front: String(card.question ?? card.prompt ?? card.front ?? ''),
      id: String(card.id ?? `fc-${index}`)
    }
  }).filter(card => card.front && card.back)

  const status = String(raw.status ?? 'ready').toLowerCase()

  return {
    createdAt: String(raw.createdAt ?? raw.created_at ?? ''),
    flashcards,
    id: String(raw.id ?? raw.noteId ?? ''),
    questions,
    status: status.includes('process') || status === 'queued' || status === 'pending' ? 'processing' : status === 'error' || status === 'failed' ? 'error' : 'ready',
    text: String(raw.content ?? raw.text ?? raw.summary ?? ''),
    title: String(raw.title ?? 'Untitled'),
    type: String(raw.type ?? raw.noteType ?? 'website')
  }
}

function Card({ children, title }: { children: React.ReactNode; title: string }) {
  return <section className="qv-glass-tile rounded-xl p-4"><h3 className="text-sm font-semibold">{title}</h3>{children}</section>
}

function Notice({ error, text }: { error?: boolean; text: string }) {
  return text ? <p className={`mt-3 rounded p-2 text-xs ${error ? 'bg-red-950/50 text-red-100' : 'bg-black/20'}`} role={error ? 'alert' : 'status'}>{text}</p> : null
}

function useSelectedNote() {
  const [noteId, setNoteState] = useState(() => localStorage.getItem(noteKey) ?? '')

  const setNoteId = (next: string) => {
    localStorage.setItem(noteKey, next)
    setNoteState(next)
  }

  return [noteId, setNoteId] as const
}

async function loadNote(noteId: string): Promise<LapNote> {
  const { data } = await productRequest<unknown>({ path: `/notes/${encodeURIComponent(noteId)}` })
  const note = mapNote(unwrap(data))

  if (!note.id) {throw new Error('The note response did not contain a note ID.')}

  return note
}

function Library({ onSelect }: { onSelect: (noteId: string) => void }) {
  const [notes, setNotes] = useState<LapNote[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')

  const load = () => {
    setError('')
    void productRequest<unknown>({ path: '/notes/recent?limit=50' })
      .then(({ data }) => setNotes(rows(data, 'notes').map(mapNote)))
      .catch(() => productRequest<unknown>({ path: '/notes?limit=50' })
        .then(({ data }) => setNotes(rows(data, 'notes').map(mapNote)))
        .catch(reason => setError(String(reason))))
  }

  useEffect(load, [])
  const filtered = notes.filter(note => note.title.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="grid gap-3">
      <Card title="Learning library">
        <div className="mt-3 flex gap-2">
          <input aria-label="Search notes" className="min-w-0 flex-1 rounded border px-3 py-2 text-sm" onChange={event => setQuery(event.target.value)} placeholder="Search saved notes" value={query} />
          <Button onClick={() => openNativeSurface('link-play', 'create')}>Create</Button>
          <Button onClick={load} variant="outline">Refresh</Button>
        </div>
        <Notice error text={error} />
      </Card>
      {filtered.map(note => (
        <button className="qv-glass-tile rounded-xl p-4 text-left" key={note.id} onClick={() => { onSelect(note.id); openNativeSurface('link-play', 'note') }} type="button">
          <b>{note.title}</b><span className="mt-1 block text-xs text-muted-foreground">{note.type} · {note.status} · {note.questions.length} questions · {note.flashcards.length} cards</span>
        </button>
      ))}
      {!notes.length && !error && <p className="text-sm text-muted-foreground">No notes yet. Create one from a URL, file, audio, image, or text.</p>}
    </div>
  )
}

type SourceType = 'audio' | 'doc' | 'image' | 'pdf' | 'text' | 'website' | 'youtube'

function CreateNote({ onCreated }: { onCreated: (noteId: string) => void }) {
  const [sourceType, setSourceType] = useState<SourceType>('website')
  const [source, setSource] = useState('')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<{ data: string; filename: string; mime: string } | null>(null)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const cancelled = useRef(false)
  const activeJobId = useRef('')
  const abortController = useRef<AbortController | null>(null)

  const chooseFile = async () => {
    const paths = await window.hermesDesktop.selectPaths({ filters: [{ extensions: ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'm4a', 'wav'], name: 'Learning sources' }], title: 'Choose a learning source' })
    const path = paths[0]

    if (!path) {return}
    const data = await window.hermesDesktop.readFileDataUrl(path)
    const [metadata, encoded = ''] = data.split(',')
    setFile({ data: encoded, filename: path.split(/[\\/]/).pop() ?? 'upload', mime: metadata.match(/^data:([^;]+)/)?.[1] ?? 'application/octet-stream' })
  }

  const poll = async (jobId: string) => {
    for (let attempt = 0; attempt < 48 && !cancelled.current && !abortController.current?.signal.aborted; attempt += 1) {
      const { data } = await productRequest<Record<string, unknown>>({ path: `/notes/jobs/${encodeURIComponent(jobId)}/status` })
      const status = String(data.status ?? '')
      setProgress(Number(data.progress ?? Math.min(95, attempt * 3)))

      if (data.noteId && ['completed', 'ready', 'existing', 'duplicate'].includes(status.toLowerCase())) {
        onCreated(String(data.noteId))
        openNativeSurface('link-play', 'note')

        return
      }

      if (status === 'failed' || status === 'error') {throw new Error(String(data.error ?? 'Note processing failed.'))}
      await new Promise(resolve => window.setTimeout(resolve, Math.min(6_000, 2_000 + attempt * 250)))
    }

    if (!cancelled.current) {throw new Error('Note processing timed out. Retry from the library.')}
  }

  const create = async () => {
    cancelled.current = false
    abortController.current = new AbortController()
    setProgress(2)
    setMessage('Uploading source…')

    try {
      const fields = [
        { name: 'type', value: file ? (sourceType === 'doc' ? 'docx' : sourceType) : sourceType },
        { name: 'title', value: title },
        { name: 'language', value: 'en' },
        { name: 'autoGenerateStudyMaterials', value: 'true' },
        { name: 'skipDuplicateCheck', value: 'false' },
        ...(!file && sourceType === 'text' ? [{ name: 'text', value: source }] : []),
        ...(!file && sourceType === 'youtube' ? [{ name: 'youtubeUrl', value: source }] : []),
        ...(!file && sourceType === 'website' ? [{ name: 'url', value: source }] : []),
        ...(file ? [{ dataBase64: file.data, filename: file.filename, mime: file.mime, name: 'file' }] : [])
      ]

      const { data } = await productRequest<Record<string, unknown>>({
        form: fields,
        method: 'POST',
        path: '/api/lap/notes/create'
      })

      const result = unwrap(data)
      const noteId = String(result.noteId ?? result.note_id ?? '')
      const jobId = String(result.jobId ?? result.job_id ?? '')

      if (noteId) {
        onCreated(noteId)
        openNativeSurface('link-play', 'note')
      } else if (jobId) {
        activeJobId.current = jobId
        setMessage('Processing source…')
        await poll(jobId)
      } else {throw new Error('The create response contained neither noteId nor jobId.')}
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      setProgress(0)
    }
  }

  const requiresFile = ['audio', 'doc', 'image', 'pdf'].includes(sourceType)

  const cancel = async () => {
    cancelled.current = true
    abortController.current?.abort()

    if (activeJobId.current) {
      try {
        await productRequest({
          method: 'POST',
          path: `/notes/jobs/${encodeURIComponent(activeJobId.current)}/cancel`
        })
        setMessage('Processing job cancelled on the server.')
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error))
      }
    } else {
      setMessage('Upload cancelled.')
    }

    setProgress(0)
  }

  return (
    <Card title="Create Link & Play note">
      <div className="mt-3 flex flex-wrap gap-2">{(['website', 'youtube', 'text', 'pdf', 'doc', 'audio', 'image'] as SourceType[]).map(type => <Button key={type} onClick={() => { setSourceType(type); setFile(null); setSource('') }} size="sm" variant={sourceType === type ? 'default' : 'outline'}>{type}</Button>)}</div>
      <input aria-label="Note title" className="mt-3 w-full rounded border px-3 py-2 text-sm" onChange={event => setTitle(event.target.value)} placeholder="Title (optional)" value={title} />
      {requiresFile
        ? <Button className="mt-3" onClick={() => void chooseFile()} variant="outline">{file ? file.filename : 'Choose file'}</Button>
        : sourceType === 'text'
          ? <textarea aria-label="Source text" className="mt-3 min-h-36 w-full rounded border p-3 text-sm" onChange={event => setSource(event.target.value)} value={source} />
          : <input aria-label="Source URL" className="mt-3 w-full rounded border px-3 py-2 text-sm" onChange={event => setSource(event.target.value)} placeholder="https://…" value={source} />}
      {progress > 0 && <progress aria-label="Note processing progress" className="mt-3 w-full" max={100} value={progress} />}
      <div className="mt-3 flex gap-2"><Button disabled={requiresFile ? !file : !source.trim()} onClick={() => void create()}>Create and generate</Button><Button disabled={progress === 0} onClick={() => void cancel()} variant="outline">Cancel processing</Button></div>
      <Notice error={progress === 0 && Boolean(message)} text={message} />
    </Card>
  )
}

function NoteDetail({ noteId }: { noteId: string }) {
  const [note, setNote] = useState<LapNote | null>(null)
  const [error, setError] = useState('')

  const load = () => {
    if (noteId) {void loadNote(noteId).then(setNote).catch(reason => setError(String(reason)))}
  }

  useEffect(load, [noteId])

  if (!noteId) {return <Notice error text="Choose a note from the library first." />}

  return (
    <Card title={note?.title ?? 'Note detail'}>
      <p className="mt-2 text-xs text-muted-foreground">{note?.type ?? 'source'} · {note?.status ?? 'loading'}</p>
      {note?.text && <p className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap text-sm">{note.text}</p>}
      <div className="mt-3 flex flex-wrap gap-2">{['quiz', 'flashcards', 'chat', 'debate', 'mind-map', 'speed-read', 'audiobook', 'figurine', 'explainer'].map(route => <Button key={route} onClick={() => openNativeSurface('link-play', route)} size="sm" variant="outline">{route}</Button>)}</div>
      <Button className="mt-3" onClick={() => void productRequest({ body: { generateAudiobook: false, generateFlashcards: true, generateQuiz: true }, method: 'POST', path: `/notes/${encodeURIComponent(noteId)}/generate-all/async` }).then(() => setError('Generation job queued. Refresh shortly.')).catch(reason => setError(String(reason)))}>Regenerate study materials</Button>
      <Notice error text={error} />
    </Card>
  )
}

function Quiz({ noteId }: { noteId: string }) {
  const [questions, setQuestions] = useState<LapQuestion[]>([])
  const [answers, setAnswers] = useState<string[]>([])
  const [message, setMessage] = useState('')
  useEffect(() => { if (noteId) {void loadNote(noteId).then(note => setQuestions(note.questions)).catch(reason => setMessage(String(reason))) } }, [noteId])
  const question = questions[answers.length]
  const score = answers.reduce((sum, answer, index) => sum + (answer === questions[index]?.correctOptionId ? 1 : 0), 0)

  if (!question && questions.length) {return <Card title="Quiz result"><p className="mt-2 text-2xl font-bold">{score}/{questions.length}</p><Button className="mt-3" onClick={() => void playRpc('quizverse_lap_submit_progress', { activity: 'quiz', count: questions.length, noteId, score, xpEarned: score * 10 }).then(() => setMessage('Progress synced.')).catch(() => setMessage('Result saved locally; reward sync is unavailable.'))}>Save result</Button><Notice text={message} /></Card>}

  return <Card title="Generated quiz">{question ? <><p className="mt-2 text-xs">Question {answers.length + 1}/{questions.length}</p><p className="mt-3 font-semibold">{question.text}</p><div className="mt-3 grid gap-2">{question.options.map(option => <Button key={option.id} onClick={() => setAnswers(current => [...current, option.id])} variant="outline">{option.text}</Button>)}</div></> : <p className="mt-2 text-sm">Loading generated questions…</p>}<Notice error text={message} /></Card>
}

function Flashcards({ noteId }: { noteId: string }) {
  const [cards, setCards] = useState<LapFlashcard[]>([])
  const [index, setIndex] = useState(0)
  const [back, setBack] = useState(false)
  useEffect(() => { if (noteId) {void loadNote(noteId).then(note => setCards(note.flashcards))} }, [noteId])
  const card = cards[index]

  return <Card title="Flashcards">{card ? <><button className="mt-3 min-h-40 w-full rounded-xl border p-5 text-center" onClick={() => setBack(value => !value)} type="button"><b>{back ? card.back : card.front}</b><span className="mt-2 block text-xs">Tap to flip</span></button><div className="mt-3 flex gap-2"><Button disabled={index === 0} onClick={() => { setIndex(value => value - 1); setBack(false) }} variant="outline">Previous</Button><Button disabled={index + 1 === cards.length} onClick={() => { setIndex(value => value + 1); setBack(false) }}>Knew it</Button></div></> : <p className="mt-2 text-sm">No generated flashcards are available yet.</p>}</Card>
}

function Chat({ noteId }: { noteId: string }) {
  const [chatId, setChatId] = useState('')
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<{ content: string; role: 'assistant' | 'user' }[]>([])
  const [error, setError] = useState('')
  const [streaming, setStreaming] = useState(false)
  const activeStream = useRef<{ controller: AbortController; id: string } | null>(null)

  useEffect(() => {
    if (!noteId) {return}
    void productRequest<unknown>({ path: `/notes/${encodeURIComponent(noteId)}/with-chat` }).then(({ data }) => {
      const root = object(data)
      const chat = object(object(root.chat).chat ?? root.chat)
      const existing = String(chat.id ?? chat.chatId ?? root.chatId ?? '')

      if (existing) {setChatId(existing)}
    }).catch(() => undefined)
  }, [noteId])

  const send = async () => {
    const text = draft.trim()

    if (!text) {return}
    setDraft('')
    setMessages(current => [...current, { content: text, role: 'user' }])

    try {
      let activeChat = chatId

      if (!activeChat) {
        const { data } = await productRequest<unknown>({ body: { title: 'Desktop Study Chat' }, method: 'POST', path: `/notes/${encodeURIComponent(noteId)}/chat` })
        const root = unwrap(data)
        activeChat = String(object(root.chat).id ?? root.id ?? root.chatId ?? '')
        setChatId(activeChat)
      }

      if (!activeChat) {throw new Error('The chat service did not return a chat ID.')}
      const streamId = crypto.randomUUID()
      const controller = new AbortController()
      activeStream.current = { controller, id: streamId }
      setStreaming(true)
      setMessages(current => [...current, { content: '', role: 'assistant' }])

      const append = (value: string) => {
        if (!value || controller.signal.aborted) {return}
        setMessages(current => current.map((message, index) => index === current.length - 1 && message.role === 'assistant'
          ? { ...message, content: message.content + value }
          : message))
      }

      const accumulate = createSseAccumulator(event => append(typeof event === 'string' ? event : String(object(event).content ?? object(event).delta ?? object(event).text ?? '')))
      await productStream({
        path: `/notes/chat/${encodeURIComponent(activeChat)}/stream?message=${encodeURIComponent(text)}`,
        streamId
      }, accumulate)
      accumulate('', true)
      setMessages(current => current.map((message, index) => index === current.length - 1 && message.role === 'assistant' && !message.content
        ? { ...message, content: 'No response was returned.' }
        : message))
    } catch (reason) {setError(String(reason))}
    finally {
      activeStream.current = null
      setStreaming(false)
    }
  }

  const cancelStream = () => {
    const active = activeStream.current

    if (!active) {return}
    active.controller.abort()
    void window.hermesDesktop.quizverse?.productCancel(active.id)
    setStreaming(false)
    setError('Response cancelled.')
  }

  return <Card title="Grounded note chat"><div aria-live="polite" className="mt-3 grid max-h-72 gap-2 overflow-auto">{messages.map((message, index) => <p className={`rounded p-3 text-sm ${message.role === 'user' ? 'ml-8 bg-violet-800/40' : 'mr-8 bg-black/20'}`} key={`${message.role}:${index}`}>{message.content || (streaming ? '…' : '')}</p>)}</div><form className="mt-3 flex gap-2" onSubmit={event => { event.preventDefault(); void send() }}><input aria-label="Chat message" className="min-w-0 flex-1 rounded border px-3 py-2" onChange={event => setDraft(event.target.value)} value={draft} /><Button disabled={!draft.trim() || streaming} type="submit">Send</Button>{streaming && <Button onClick={cancelStream} type="button" variant="outline">Stop</Button>}</form><Notice error text={error} /></Card>
}

function SpeedReader({ noteId }: { noteId: string }) {
  const [text, setText] = useState('')
  const [index, setIndex] = useState(0)
  const [running, setRunning] = useState(false)
  const [wpm, setWpm] = useState(250)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!noteId) {return}
    void productRequest<unknown>({
      body: { bionic: true, startWordIndex: 0, wpm },
      method: 'POST',
      path: `/notes/${encodeURIComponent(noteId)}/speed-reading`
    }).then(({ data }) => {
      const root = unwrap(data)
      const tokens = Array.isArray(root.tokens) ? root.tokens.map(token => String(object(token).word ?? object(token).w ?? '')) : []
      setText(tokens.join(' '))
    }).catch(reason => {
      setError(String(reason))
      void loadNote(noteId).then(note => setText(note.text || note.title))
    })
  }, [noteId, wpm])
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text])
  useEffect(() => {
    if (!running || index >= words.length) {return}
    const timer = window.setTimeout(() => setIndex(value => value + 1), 60_000 / wpm)

    return () => window.clearTimeout(timer)
  }, [index, running, words.length, wpm])

  return <Card title="Speed reading"><p aria-live="polite" className="mt-6 min-h-20 text-center text-3xl font-bold">{words[index] ?? (words.length ? 'Complete' : 'Loading…')}</p><label className="mt-3 block text-xs">Speed: {wpm} WPM<input className="ml-3" max={700} min={100} onChange={event => setWpm(Number(event.target.value))} step={25} type="range" value={wpm} /></label><div className="mt-3 flex gap-2"><Button onClick={() => setRunning(value => !value)}>{running ? 'Pause' : 'Start'}</Button><Button onClick={() => { setIndex(0); setRunning(false) }} variant="outline">Reset</Button></div><Notice error text={error} /></Card>
}

function MindMap({ noteId }: { noteId: string }) {
  const [map, setMap] = useState<Record<string, unknown> | null>(null)
  const [message, setMessage] = useState('')

  const generate = () => void productRequest<unknown>({
    body: { maxNodes: 80, save: true },
    method: 'POST',
    path: `/notes/${encodeURIComponent(noteId)}/mindmap`
  }).then(({ data }) => setMap(unwrap(data))).catch(reason => setMessage(String(reason)))

  const nodes = (Array.isArray(map?.nodes) ? map.nodes : []).map(object).slice(0, 24)
  const centerX = 240
  const centerY = 160

  return <Card title="Note mind map"><Button className="mt-3" disabled={!noteId} onClick={generate}>Generate map</Button>{nodes.length > 0 && <svg aria-label="Generated mind map" className="mt-3 w-full rounded border bg-black/20" viewBox="0 0 480 320">{nodes.map((node, index) => { const angle = index / nodes.length * Math.PI * 2; const x = index === 0 ? centerX : centerX + Math.cos(angle) * 150; const y = index === 0 ? centerY : centerY + Math.sin(angle) * 110;

 return <g key={String(node.id ?? index)}>{index > 0 && <line stroke="currentColor" strokeOpacity=".35" x1={centerX} x2={x} y1={centerY} y2={y} />}<circle cx={x} cy={y} fill={index === 0 ? '#7c3aed' : '#1e293b'} r={index === 0 ? 34 : 27} /><text fill="white" fontSize="10" textAnchor="middle" x={x} y={y + 3}>{String(node.label ?? node.title ?? node.text ?? '').slice(0, 18)}</text></g> })}</svg>}<Notice error text={message} /></Card>
}

function RealtimeProduct({ noteId, mode }: { mode: 'arena' | 'battle'; noteId: string }) {
  const [status, setStatus] = useState('')
  const [scope, setScope] = useState('global')
  const [leaderboard, setLeaderboard] = useState<Record<string, unknown>[]>([])
  const [battle, setBattle] = useState<{ connectionId: string; matchId: string; opponent: string; opponentScore: number; questions: LapQuestion[] } | null>(null)
  const [answers, setAnswers] = useState<string[]>([])
  const [missions, setMissions] = useState(readMissions)
  const [arenaView, setArenaView] = useState<'badges' | 'leaderboard' | 'missions'>('missions')

  useEffect(() => {
    if (mode !== 'arena') {return}
    void playRpc('quizverse_lap_get_leaderboard', { scope }).then(value => {
      const data = object(value)
      const root = object(data.data ?? data)
      setLeaderboard((Array.isArray(root.entries) ? root.entries : []).map(object))
    }).catch(reason => setStatus(String(reason)))
  }, [mode, scope])

  useEffect(() => {
    if (mode !== 'battle') {return}

    const unsubscribe = window.hermesDesktop.quizverse?.onPlayRealtimeEvent?.(event => {
      if (event.id !== battle?.connectionId || event.type !== 'match-data') {return}
      const payload = object(event.data)
      setBattle(current => current ? { ...current, opponentScore: Number(payload.opponent_score ?? payload.score ?? current.opponentScore) } : current)
    })

    return () => {
      unsubscribe?.()

      if (battle?.connectionId) {void window.hermesDesktop.quizverse?.playRealtimeClose(battle.connectionId)}
    }
  }, [battle?.connectionId, mode])

  const claimMission = (mission: LapMission) => {
    if (mission.claimed || mission.progress < mission.required) {return}
    const next = missions.map(item => item.id === mission.id ? { ...item, claimed: true } : item)
    setMissions(next)
    localStorage.setItem(missionKey, JSON.stringify({ day: new Date().toISOString().slice(0, 10), missions: next }))
    void playRpc('quizverse_lap_submit_progress', { activity: 'mission_claim', mission_id: mission.id, xpEarned: mission.rewardXp })
      .then(() => setStatus(`${mission.rewardXp} XP claimed.`))
      .catch(() => setStatus('Mission claimed locally; reward sync is unavailable.'))
  }

  const findBattle = () => void playRpc('quizverse_lap_battle_find', { note_id: noteId }).then(async value => {
    const data = object(object(value).data ?? value)
    const questions = (Array.isArray(data.questions) ? data.questions : []).map((item, index) => mapQuestion(object(item), index)).filter((item): item is LapQuestion => Boolean(item))

    if (!data.match_id || !questions.length) {throw new Error('No playable battle match is available.')}
    const connection = await window.hermesDesktop.quizverse?.playRealtimeConnect()

    if (!connection) {throw new Error('Realtime battle transport is unavailable.')}
    await window.hermesDesktop.quizverse?.playRealtimeJoinMatch(connection.id, String(data.match_id))
    setBattle({ connectionId: connection.id, matchId: String(data.match_id), opponent: String(data.opponent_name ?? 'Opponent'), opponentScore: 0, questions })
    setAnswers([])
  }).catch(reason => setStatus(String(reason)))

  if (mode === 'arena') {
    const badges = missions.filter(mission => mission.claimed)

    return <Card title="Knowledge Arena"><div className="mt-3 flex gap-2">{(['missions', 'leaderboard', 'badges'] as const).map(value => <Button key={value} onClick={() => setArenaView(value)} size="sm" variant={arenaView === value ? 'default' : 'outline'}>{value}</Button>)}</div>{arenaView === 'missions' && <div className="mt-3 grid gap-2">{missions.map(mission => <div className="rounded border p-3" key={mission.id}><b className="text-sm">{mission.title}</b><p className="text-xs">{mission.description} · {mission.progress}/{mission.required}</p><progress className="mt-2 w-full" max={mission.required} value={mission.progress} /><Button className="mt-2" disabled={mission.claimed || mission.progress < mission.required} onClick={() => claimMission(mission)} size="sm">{mission.claimed ? 'Claimed' : `Claim ${mission.rewardXp} XP`}</Button></div>)}</div>}{arenaView === 'leaderboard' && <><div className="mt-3 flex gap-2">{['global', 'friends', 'regional'].map(value => <Button key={value} onClick={() => setScope(value)} size="sm" variant={scope === value ? 'default' : 'outline'}>{value}</Button>)}</div><ol className="mt-3 grid gap-1">{leaderboard.map((entry, index) => <li className="text-xs" key={String(entry.userId ?? entry.owner_id ?? index)}>#{String(entry.rank ?? index + 1)} {String(entry.displayName ?? entry.username ?? 'Player')} · {String(entry.xp ?? entry.score ?? 0)} XP</li>)}</ol></>}{arenaView === 'badges' && <div className="mt-3 grid grid-cols-2 gap-2">{badges.length ? badges.map(mission => <div className="rounded border p-4 text-center" key={mission.id}>🏅<span className="mt-1 block text-xs">{mission.title}</span></div>) : <p className="text-sm">Complete and claim missions to unlock badges.</p>}</div>}<Notice error text={status} /></Card>
  }

  const question = battle?.questions[answers.length]
  const score = battle ? answers.reduce((sum, answer, index) => sum + (answer === battle.questions[index]?.correctOptionId ? 1 : 0), 0) : 0

  const answerQuestion = (optionId: string) => {
    if (!battle) {return}
    const next = [...answers, optionId]
    setAnswers(next)
    void window.hermesDesktop.quizverse?.playRealtimeSend(battle.connectionId, 2, { answer_id: optionId, match_id: battle.matchId, question_index: answers.length })

    if (next.length === battle.questions.length) {
      const finalScore = next.reduce((sum, answer, index) => sum + (answer === battle.questions[index]?.correctOptionId ? 1 : 0), 0)
      void window.hermesDesktop.quizverse?.playRealtimeSend(battle.connectionId, 3, { match_id: battle.matchId, score: finalScore })
      void playRpc('quizverse_lap_submit_progress', { activity: 'battle_result', match_id: battle.matchId, noteId, score: finalScore, xpEarned: finalScore * 15 })
    }
  }

  return <Card title="Note Battle">{!battle && <><p className="mt-2 text-sm">Find a native Nakama battle using this note’s generated questions.</p><Button className="mt-3" disabled={!noteId} onClick={findBattle}>Find match</Button></>}{battle && question && <><p className="mt-2 text-xs">Against {battle.opponent} ({battle.opponentScore}) · {answers.length + 1}/{battle.questions.length}</p><p className="mt-3 font-semibold">{question.text}</p><div className="mt-3 grid gap-2">{question.options.map(option => <Button key={option.id} onClick={() => answerQuestion(option.id)} variant="outline">{option.text}</Button>)}</div></>}{battle && !question && <><p className="mt-2 text-2xl font-bold">{score}/{battle.questions.length} · opponent {battle.opponentScore}</p><p className="mt-1 text-xs">Battle result submitted to the realtime match and progress service.</p><Button className="mt-3" onClick={() => { void window.hermesDesktop.quizverse?.playRealtimeClose(battle.connectionId); setBattle(null); setAnswers([]) }}>Find another battle</Button></>}<Notice error text={status} /></Card>
}

function Debate({ noteId }: { noteId: string }) {
  const [mode, setMode] = useState<'multi-round' | 'oxford' | 'rapid-fire' | 'start' | 'timed'>('start')
  const [position, setPosition] = useState('for')
  const [topic, setTopic] = useState('')
  const [session, setSession] = useState<Record<string, unknown> | null>(null)
  const [message, setMessage] = useState('')
  const [argument, setArgument] = useState('')
  const [transcript, setTranscript] = useState<{ role: 'ai' | 'user'; text: string }[]>([])
  const [score, setScore] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    if (!noteId) {return}
    void productRequest<unknown>({ path: `/notes/${encodeURIComponent(noteId)}/debate-topics` }).then(({ data }) => {
      const first = rows(data, 'topics')[0]
      setTopic(String(first?.topic ?? first?.description ?? ''))
    }).catch(() => undefined)
  }, [noteId])

  const start = () => {
    const body: Record<string, unknown> = { position, topic }

    if (mode === 'timed') {Object.assign(body, { timeLimitSeconds: 120, totalTimeLimitSeconds: 600 })}

    if (mode === 'rapid-fire') {Object.assign(body, { maxArgumentLength: 280, timeLimitSeconds: 30 })}

    if (mode === 'multi-round') {body.totalRounds = 3}

    if (mode === 'oxford') {body.includesCrossExamination = true}
    void productRequest<unknown>({
      body,
      method: 'POST',
      path: mode === 'oxford'
        ? `/notes/${encodeURIComponent(noteId)}/debate/oxford/start`
        : `/notes/${encodeURIComponent(noteId)}/debate/${mode}`
    }).then(({ data }) => {
      const next = unwrap(data)
      setSession(next)
      const welcome = String(next.welcomeMessage ?? next.openingMessage ?? '')
      setTranscript(welcome ? [{ role: 'ai', text: welcome }] : [])
    }).catch(reason => setMessage(String(reason)))
  }

  const chatId = String(session?.chatId ?? object(session?.chat).id ?? session?.id ?? '')

  const submitArgument = async () => {
    const text = argument.trim()

    if (!chatId || !text) {return}
    setArgument('')
    setTranscript(current => [...current, { role: 'user', text }, { role: 'ai', text: '' }])
    const append = (value: string) => setTranscript(current => current.map((entry, index) => index === current.length - 1 ? { ...entry, text: entry.text + value } : entry))
    const accumulate = createSseAccumulator(event => append(typeof event === 'string' ? event : String(object(event).content ?? object(event).delta ?? object(event).text ?? '')))

    try {
      await productStream({ path: `/notes/chat/${encodeURIComponent(chatId)}/stream?message=${encodeURIComponent(text)}`, streamId: crypto.randomUUID() }, accumulate)
      accumulate('', true)
    } catch (reason) {
      setMessage(String(reason))
    }
  }

  const advance = async () => {
    if (!chatId) {return}

    const path = mode === 'oxford'
      ? `/notes/debate/${encodeURIComponent(chatId)}/oxford/advance-phase`
      : `/notes/debate/${encodeURIComponent(chatId)}/next-round`

    try {
      const { data } = await productRequest<unknown>({ body: {}, method: 'POST', path })
      setSession(current => ({ ...(current ?? {}), ...unwrap(data) }))
    } catch (reason) {
      setMessage(String(reason))
    }
  }

  const scoreDebate = async () => {
    if (!chatId) {return}

    try {
      const { data } = await productRequest<unknown>({
        body: debateScorePayload(topic, position),
        method: 'POST',
        path: `/notes/debate/${encodeURIComponent(chatId)}/score`
      })

      setScore(unwrap(data))
    } catch (reason) {
      setMessage(String(reason))
    }
  }

  return (
    <Card title="Debate">
      <div className="mt-3 flex flex-wrap gap-2">{(['start', 'timed', 'rapid-fire', 'multi-round', 'oxford'] as const).map(value => <Button key={value} onClick={() => setMode(value)} size="sm" variant={mode === value ? 'default' : 'outline'}>{value}</Button>)}</div>
      <input aria-label="Debate topic" className="mt-3 w-full rounded border px-3 py-2" onChange={event => setTopic(event.target.value)} placeholder="Debate topic" value={topic} />
      <div className="mt-3 flex gap-2"><Button onClick={() => setPosition('for')} variant={position === 'for' ? 'default' : 'outline'}>Argue for</Button><Button onClick={() => setPosition('against')} variant={position === 'against' ? 'default' : 'outline'}>Argue against</Button></div>
      {!session && <Button className="mt-3" disabled={!noteId || !topic.trim()} onClick={start}>Start debate</Button>}
      {session && <><p className="mt-3 text-xs">Round {String(session.currentRound ?? 1)}/{String(session.totalRounds ?? (mode === 'oxford' ? 5 : 1))} · phase {String(session.phase ?? 'argument')}</p><div aria-live="polite" className="mt-3 grid max-h-64 gap-2 overflow-auto">{transcript.map((entry, index) => <p className={`rounded p-3 text-sm ${entry.role === 'user' ? 'ml-8 bg-violet-800/40' : 'mr-8 bg-black/20'}`} key={`${entry.role}:${index}`}>{entry.text || '…'}</p>)}</div><textarea aria-label="Debate argument" className="mt-3 min-h-24 w-full rounded border p-3" onChange={event => setArgument(event.target.value)} value={argument} /><div className="mt-3 flex gap-2"><Button disabled={!argument.trim()} onClick={() => void submitArgument()}>Submit argument</Button><Button onClick={() => void advance()} variant="outline">{mode === 'oxford' ? 'Advance Oxford phase' : 'Next round'}</Button><Button onClick={() => void scoreDebate()} variant="outline">Score debate</Button></div></>}
      {score && <div className="mt-3 rounded border p-4"><p className="text-xl font-bold">You {String(score.userScore ?? score.user_score ?? 0)} · AI {String(score.aiScore ?? score.ai_score ?? 0)}</p><p className="mt-2 text-sm">{String(score.feedback ?? '')}</p><p className="mt-2 text-xs">Logic {String(object(score.breakdown).logic ?? '—')} · Evidence {String(object(score.breakdown).evidence ?? '—')} · Persuasion {String(object(score.breakdown).persuasion ?? '—')} · Clarity {String(object(score.breakdown).clarity ?? '—')}</p></div>}
      <Notice error text={message} />
    </Card>
  )
}

function GeneratedJob({ body, path, statusPath, title }: {
  body: unknown
  path: string
  statusPath: (jobId: string) => string
  title: string
}) {
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [message, setMessage] = useState('')
  const controller = useRef<AbortController | null>(null)
  const activeJobId = useRef('')

  const start = async () => {
    try {
      controller.current = new AbortController()
      const { data } = await productRequest<unknown>({ body, method: 'POST', path })
      const job = unwrap(data)
      setResult(job)
      const jobId = String(job.jobId ?? job.job_id ?? '')
      activeJobId.current = jobId

      if (!jobId) {return}

      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (controller.current.signal.aborted) {return}
        const status = unwrap((await productRequest<unknown>({ path: statusPath(jobId) })).data)
        setResult(status)
        const phase = String(status.status ?? '').toLowerCase()

        if (['completed', 'ready', 'failed', 'error'].includes(phase)) {return}
        await new Promise(resolve => window.setTimeout(resolve, 3_000))
      }

      setMessage('Generation is still running. Reopen this route to check again.')
    } catch (reason) {setMessage(String(reason))}
  }

  const cancel = async () => {
    controller.current?.abort()

    if (!activeJobId.current) {return}

    try {
      await productRequest({ method: 'POST', path: `/notes/jobs/${encodeURIComponent(activeJobId.current)}/cancel` })
      setMessage('Generation cancelled on the server.')
    } catch (reason) {
      setMessage(String(reason))
    }
  }

  const artifactUrl = String(result?.url ?? result?.video_url ?? result?.image_url ?? result?.artifact_url ?? '')
  const isVideo = /video/i.test(title) || /\.(mp4|webm)(?:\?|$)/i.test(artifactUrl)

  return <Card title={title}><Button className="mt-3" onClick={() => void start()}>Generate and poll</Button>{Boolean(activeJobId.current) && <Button className="ml-2 mt-3" onClick={() => void cancel()} variant="outline">Cancel job</Button>}{result && <div className="mt-3 rounded border p-3"><p className="text-sm font-semibold">{String(result.title ?? result.status ?? 'Generation result')}</p>{artifactUrl && (isVideo ? <video className="mt-3 max-h-80 w-full" controls src={artifactUrl} /> : <img alt={`${title} result`} className="mt-3 max-h-80 w-full object-contain" src={artifactUrl} />)}{Boolean(result.description) && <p className="mt-2 text-xs">{String(result.description)}</p>}</div>}<Notice error text={message} /></Card>
}

function Figurine({ noteId }: { noteId: string }) {
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [style, setStyle] = useState('cartoon')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  const loadPreview = () => void productRequest<unknown>({ path: `/notes/${encodeURIComponent(noteId)}/figurine-prompt` })
    .then(({ data }) => {
      const value = unwrap(data)
      setPreview(value)
      setSubject(String(value.subject ?? ''))
    })
    .catch(reason => setMessage(String(reason)))

  return <div className="grid gap-3"><Card title="Figurine preview"><Button disabled={!noteId} onClick={loadPreview} variant="outline">Preview styles and prompt</Button>{preview && <div className="mt-3 rounded border p-4"><p className="font-semibold">{String(preview.title ?? preview.subject ?? 'Figurine concept')}</p><p className="mt-2 text-xs">{String(preview.prompt ?? preview.description ?? '')}</p></div>}<div className="mt-3 flex flex-wrap gap-2">{['cartoon', 'realistic', 'chibi', 'collectible'].map(value => <Button key={value} onClick={() => setStyle(value)} size="sm" variant={style === value ? 'default' : 'outline'}>{value}</Button>)}</div><input aria-label="Figurine subject" className="mt-3 w-full rounded border px-3 py-2 text-sm" onChange={event => setSubject(event.target.value)} placeholder="Subject override" value={subject} /><Notice error text={message} /></Card>{preview && <GeneratedJob body={{ style, ...(subject.trim() ? { subject: subject.trim() } : {}) }} path={`/notes/${encodeURIComponent(noteId)}/generate-figurine`} statusPath={jobId => `/figurine/job/${encodeURIComponent(jobId)}/status`} title="Generate figurine" />}</div>
}

function Audiobook({ noteId }: { noteId: string }) {
  const [books, setBooks] = useState<Record<string, unknown>[]>([])
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const [speed, setSpeed] = useState(1)
  const [message, setMessage] = useState('')
  const [userId, setUserId] = useState('')
  const audio = useRef<HTMLAudioElement | null>(null)
  const lastSavedSecond = useRef(-1)

  const load = useCallback(async () => {
    if (!noteId) {return}
    const session = await ensurePlaySession()
    setUserId(session.userId)
    await productRequest<unknown>({ path: audiobookLibraryPath(session.userId) }).then(({ data }) => {
      const list = rows(data, 'audiobooks')
      setBooks(list)
      setSelected(current => current ?? list[0] ?? null)
    }).catch(reason => setMessage(String(reason)))
  }, [noteId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (audio.current) {audio.current.playbackRate = speed}
  }, [speed, selected])

  const bookId = String(selected?.id ?? selected?.audiobook_id ?? '')
  const streamUrl = String(selected?.stream_url ?? selected?.audio_url ?? selected?.url ?? '')
  const chapters = (Array.isArray(selected?.chapters) ? selected.chapters : []).map(object)

  const savePosition = (seconds: number) => {
    const whole = Math.floor(seconds)

    if (!bookId || whole === lastSavedSecond.current || whole % 10 !== 0) {return}
    lastSavedSecond.current = whole
    void productRequest({ body: audiobookPositionPayload(seconds), method: 'POST', path: `/audiobook/${encodeURIComponent(bookId)}/position` }).catch(() => undefined)
  }

  return <div className="grid gap-3"><Card title="Audiobook library"><Button onClick={() => void load()} variant="outline">Refresh library</Button><div className="mt-3 grid gap-2">{books.map(book => <button className="rounded border p-3 text-left" key={String(book.id ?? book.audiobook_id)} onClick={() => setSelected(book)} type="button"><b>{String(book.title ?? 'Study audiobook')}</b><span className="block text-xs">{String(book.status ?? 'ready')} · {String(book.duration_seconds ?? '—')} seconds</span></button>)}</div>{selected && <div className="mt-4"><audio className="w-full" controls onTimeUpdate={event => savePosition(event.currentTarget.currentTime)} ref={audio} src={streamUrl} /><label className="mt-3 block text-xs">Playback speed<select className="ml-2 rounded border px-2 py-1" onChange={event => setSpeed(Number(event.target.value))} value={speed}>{[0.75, 1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label><ol className="mt-3 grid gap-1">{chapters.map((chapter, index) => <li key={String(chapter.id ?? index)}><button className="w-full rounded p-2 text-left text-xs hover:bg-black/10" onClick={() => { if (audio.current) {audio.current.currentTime = Number(chapter.start_seconds ?? chapter.start ?? 0); void audio.current.play()} }} type="button">{index + 1}. {String(chapter.title ?? `Chapter ${index + 1}`)} · {String(chapter.start_seconds ?? chapter.start ?? 0)}s</button></li>)}</ol></div>}<Notice error text={message} /></Card>{userId ? <GeneratedJob body={{ audiobookType: 'StudyAudio', includeChapters: true, language: 'en', narrationStyle: 'Educational', noteId, sourceType: 'ExistingNote', userId }} path="/audiobook/create" statusPath={jobId => `/audiobook/status/${encodeURIComponent(jobId)}`} title="Generate audiobook" /> : <Card title="Generate audiobook"><p className="mt-2 text-sm">Connecting your QuizVerse identity…</p></Card>}</div>
}

function SrsReview() {
  const [cards, setCards] = useState<Record<string, unknown>[]>([])
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [message, setMessage] = useState('')

  const load = () => void productRequest<unknown>({ path: '/flashcards/srs/queue' }).then(({ data }) => {
    const root = unwrap(data)
    setCards((Array.isArray(root.items) ? root.items : Array.isArray(root.cards) ? root.cards : []).map(object))
    setIndex(0)
    setRevealed(false)
  }).catch(reason => setMessage(String(reason)))

  useEffect(load, [])
  const card = cards[index]
  const cardId = String(card?.id ?? card?.cardId ?? '')

  const rate = (rating: number) => void productRequest({
    body: { rating },
    method: 'POST',
    path: `/flashcards/${encodeURIComponent(cardId)}/review`
  }).then(() => {
    setIndex(value => value + 1)
    setRevealed(false)
  }).catch(reason => setMessage(String(reason)))

  return <Card title="Spaced repetition queue">{card ? <><p className="mt-3 text-lg font-semibold">{String(card.front ?? card.question ?? '')}</p>{revealed && <p className="mt-3 rounded bg-black/10 p-3">{String(card.back ?? card.answer ?? '')}</p>}{!revealed ? <Button className="mt-3" onClick={() => setRevealed(true)}>Reveal answer</Button> : <div className="mt-3 flex flex-wrap gap-2">{['Again', 'Hard', 'Good', 'Easy'].map((label, rating) => <Button key={label} onClick={() => rate(rating + 1)} size="sm" variant="outline">{label}</Button>)}</div>}</> : <><p className="mt-3 text-sm">No more cards are due.</p><Button className="mt-3" onClick={load} variant="outline">Refresh queue</Button></>}<Notice error text={message} /></Card>
}

export function LinkPlaySurface({ route }: LinkPlaySurfaceProps) {
  const [noteId, setNoteId] = useSelectedNote()

  if (route === 'library') {return <Library onSelect={setNoteId} />}

  if (route === 'create') {return <CreateNote onCreated={setNoteId} />}

  if (route === 'note') {return <NoteDetail noteId={noteId} />}

  if (route === 'quiz') {return <Quiz noteId={noteId} />}

  if (route === 'flashcards') {return <Flashcards noteId={noteId} />}

  if (route === 'chat') {return <Chat noteId={noteId} />}

  if (route === 'arena' || route === 'battle') {return <RealtimeProduct mode={route} noteId={noteId} />}

  if (route === 'speed-read') {return <SpeedReader noteId={noteId} />}

  if (route === 'srs') {return <SrsReview />}

  if (route === 'debate') {return <Debate noteId={noteId} />}

  if (route === 'mind-map') {return <MindMap noteId={noteId} />}

  if (route === 'audiobook') {return <Audiobook noteId={noteId} />}

  if (route === 'figurine') {return <Figurine noteId={noteId} />}

  if (route === 'explainer') {return <GeneratedJob body={{ duration_seconds: 20, topic: 'Explain the key ideas' }} path={`/notes/${encodeURIComponent(noteId)}/generate-explainer-video`} statusPath={jobId => `/notes/${encodeURIComponent(noteId)}/explainer-status/${encodeURIComponent(jobId)}`} title="Explainer video" />}

  return <Notice error text="Unknown Link & Play route." />
}
