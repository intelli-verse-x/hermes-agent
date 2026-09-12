import { useStore } from '@nanostores/react'
import DOMPurify from 'dompurify'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { DesktopVoiceControls, useDesktopVoiceActions } from '../chat/desktop-voice-actions'

import { playRpc } from './play-store'
import { tutorFetch, tutorStream } from './tutor-api'
import {
  $tutorCapabilities,
  $tutorConnection,
  $tutorMessages,
  $tutorMode,
  $tutorSessionId,
  $tutorSessions,
  $tutorStreaming,
  answerTutorPrompt,
  cancelTutorTurn,
  detectTutorCapabilities,
  dismissResearchOutline,
  disposeTutorChat,
  judgeTutorQuestion,
  loadTutorSessions,
  newTutorSession,
  openTutorSession,
  regenerateTutorTurn,
  sendTutorMessage,
  type TutorMessage,
  type TutorMode,
  type TutorQuizQuestion,
  type TutorVisualArtifact
} from './tutor-chat-store'

const MODES: { id: TutorMode; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'deep_solve', label: 'Solve' },
  { id: 'deep_question', label: 'Quiz' },
  { id: 'deep_research', label: 'Research' },
  { id: 'visualize', label: 'Visualize' },
  { id: 'mastery_path', label: 'Mastery Path' }
]

interface KnowledgeBase {
  name: string
  rag_provider?: string
  status?: string
  statistics?: { document_count?: number }
}

function InteractiveTutorQuestion({
  onJudged,
  question,
  turnId
}: {
  onJudged: (correct: boolean) => void
  question: TutorQuizQuestion
  turnId?: string
}) {
  const sessionId = useStore($tutorSessionId)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState('')
  const [image, setImage] = useState<{ base64: string; filename: string; mime_type: string } | null>(null)
  const [judging, setJudging] = useState(false)

  return (
    <section className="mt-3 rounded border border-violet-400/20 p-3">
      <strong className="block text-xs">{question.question}</strong>
      <div className="mt-2 grid gap-1">
        {question.options?.map(option => (
          <button
            className={cn(
              'rounded border px-2 py-1 text-left text-xs',
              answer === option ? 'border-violet-400 bg-violet-500/15' : 'border-(--ui-border-primary)'
            )}
            key={option}
            onClick={() => setAnswer(option)}
            type="button"
          >
            {option}
          </button>
        ))}
        {!question.options?.length && (
          <input
            className="rounded border border-(--ui-border-primary) bg-transparent px-2 py-1 text-xs"
            onChange={event => setAnswer(event.target.value)}
            value={answer}
          />
        )}
        <label className="mt-1 cursor-pointer text-[0.65rem] text-violet-300">
          Attach answer image
          <input
            accept="image/*"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0]

              if (!file) {
                return
              }

              const reader = new FileReader()

              reader.onload = () =>
                setImage({
                  base64: String(reader.result).split(',', 2)[1] ?? '',
                  filename: file.name,
                  mime_type: file.type || 'image/png'
                })
              reader.readAsDataURL(file)
            }}
            type="file"
          />
        </label>
        {image && <span className="text-[0.65rem] text-muted-foreground">{image.filename}</span>}
      </div>
      <Button
        className="mt-2"
        disabled={!answer.trim() || judging}
        onClick={() => {
          setJudging(true)
          void judgeTutorQuestion(question, answer, image ? [image] : [])
            .then(async judgment => {
              const correct = question.correct_answer
                ? answer.trim().toLowerCase() === question.correct_answer.trim().toLowerCase()
                : /\b(correct|right|pass)\b/i.test(judgment) && !/\bincorrect|wrong\b/i.test(judgment)

              setFeedback(judgment)
              onJudged(correct)

              if (sessionId && question.question_id) {
                const entry = await tutorFetch<{ id?: number }>('/api/v1/question-notebook/entries/upsert', {
                  body: JSON.stringify({
                    correct_answer: question.correct_answer ?? '',
                    explanation: question.explanation ?? '',
                    is_correct: correct,
                    options: Object.fromEntries(
                      (question.options ?? []).map((option, index) => [String(index), option])
                    ),
                    question: question.question,
                    question_id: question.question_id,
                    question_type: question.question_type ?? (question.options?.length ? 'choice' : 'short_answer'),
                    session_id: sessionId,
                    turn_id: turnId ?? '',
                    user_answer: answer,
                    user_answer_images: image ? [image] : []
                  }),
                  method: 'POST'
                })

                if (entry.id != null) {
                  await tutorFetch(`/api/v1/question-notebook/entries/${entry.id}`, {
                    body: JSON.stringify({ ai_judgment: judgment }),
                    method: 'PATCH'
                  })
                }
              }
            })
            .catch(error => setFeedback(error instanceof Error ? error.message : String(error)))
            .finally(() => setJudging(false))
        }}
        size="xs"
      >
        {judging ? 'Judging…' : 'Check answer'}
      </Button>
      {feedback && <div className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{feedback}</div>}
    </section>
  )
}

function TutorQuizSet({ questions, turnId }: { questions: TutorQuizQuestion[]; turnId?: string }) {
  const [attempts, setAttempts] = useState<Record<string, boolean>>({})

  return (
    <section className="mt-3">
      <div className="mb-2 text-xs text-muted-foreground">
        Score: {Object.values(attempts).filter(Boolean).length} / {questions.length} · Answered{' '}
        {Object.keys(attempts).length}
      </div>
      {questions.map((question, index) => {
        const id = question.question_id ?? String(index)

        return (
          <InteractiveTutorQuestion
            key={id}
            onJudged={correct => setAttempts(current => ({ ...current, [id]: correct }))}
            question={question}
            turnId={turnId}
          />
        )
      })}
      {Object.keys(attempts).length === questions.length && (
        <Button
          className="mt-3"
          onClick={() => void sendTutorMessage('Review my quiz results and give me focused follow-up practice.')}
          size="xs"
          variant="secondary"
        >
          Follow-up practice
        </Button>
      )}
    </section>
  )
}

export function sanitizeTutorMarkup(source: string, kind: 'html' | 'svg'): string {
  const clean = DOMPurify.sanitize(
    source,
    kind === 'svg'
      ? {
          FORBID_ATTR: ['style'],
          FORBID_TAGS: ['foreignObject', 'iframe', 'script'],
          USE_PROFILES: { svg: true, svgFilters: false }
        }
      : {
          ALLOWED_ATTR: [
            'alt',
            'aria-label',
            'class',
            'colspan',
            'height',
            'href',
            'rel',
            'role',
            'rowspan',
            'src',
            'target',
            'title',
            'width'
          ],
          ALLOWED_TAGS: [
            'a',
            'article',
            'b',
            'blockquote',
            'br',
            'code',
            'div',
            'em',
            'figcaption',
            'figure',
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            'hr',
            'i',
            'img',
            'li',
            'ol',
            'p',
            'pre',
            'section',
            'span',
            'strong',
            'table',
            'tbody',
            'td',
            'th',
            'thead',
            'tr',
            'u',
            'ul'
          ],
          FORBID_ATTR: ['style'],
          FORBID_TAGS: ['embed', 'iframe', 'object', 'script', 'svg']
        }
  )

  const document = new DOMParser().parseFromString(
    kind === 'svg' ? clean : `<div>${clean}</div>`,
    kind === 'svg' ? 'image/svg+xml' : 'text/html'
  )

  const root = kind === 'svg' ? document.documentElement : document.body.firstElementChild

  if (!root || (kind === 'svg' && (root.nodeName.toLowerCase() !== 'svg' || root.querySelector('parsererror')))) {
    return ''
  }

  root.querySelectorAll('[href],[src]').forEach(node => {
    for (const attribute of ['href', 'src']) {
      const value = node.getAttribute(attribute)

      if (value && !/^(?:https?:|data:image\/(?:gif|jpeg|png|webp);base64,|#|\/)/i.test(value.trim())) {
        node.removeAttribute(attribute)
      }
    }
  })
  root.querySelectorAll('a[target="_blank"]').forEach(node => node.setAttribute('rel', 'noopener noreferrer'))

  return kind === 'svg' ? new XMLSerializer().serializeToString(root) : root.innerHTML
}

function ChartArtifact({ source }: { source: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current

    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    try {
      const config = JSON.parse(source.replace(/^```(?:json|js|javascript)?|```$/g, '').trim()) as {
        data?: { datasets?: { data?: number[]; label?: string }[]; labels?: string[] }
      }

      const values = config.data?.datasets?.[0]?.data ?? []
      const labels = config.data?.labels ?? values.map((_, index) => String(index + 1))
      const max = Math.max(1, ...values)
      const width = canvas.width / Math.max(1, values.length)

      context.clearRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#8b5cf6'
      context.font = '12px sans-serif'
      values.forEach((value, index) => {
        const height = (value / max) * (canvas.height - 35)

        context.fillRect(index * width + 8, canvas.height - height - 20, Math.max(8, width - 16), height)
        context.fillStyle = '#c4b5fd'
        context.fillText(labels[index] ?? '', index * width + 8, canvas.height - 4)
        context.fillStyle = '#8b5cf6'
      })
    } catch {
      context.fillStyle = '#f87171'
      context.fillText('Chart configuration is invalid.', 8, 24)
    }
  }, [source])

  return <canvas className="mt-2 w-full rounded bg-black/20" height={280} ref={ref} width={640} />
}

function VisualArtifact({ artifact }: { artifact: TutorVisualArtifact }) {
  if (artifact.renderType === 'svg') {
    const svg = sanitizeTutorMarkup(artifact.content ?? '', 'svg')

    return svg ? (
      <div className="mt-3 overflow-auto rounded bg-white p-3" dangerouslySetInnerHTML={{ __html: svg }} />
    ) : (
      <p className="mt-2 text-xs text-red-400">Unsafe or invalid SVG was blocked.</p>
    )
  }

  if (artifact.renderType === 'html') {
    const html = sanitizeTutorMarkup(artifact.content ?? '', 'html')

    return (
      <div
        aria-label="TutorX HTML visualization"
        className="qv-native-visualization mt-3 max-h-96 w-full overflow-auto rounded border border-(--ui-border-primary) bg-white p-4 text-slate-950"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  if (artifact.renderType === 'chartjs') {
    return <ChartArtifact source={artifact.content ?? ''} />
  }

  if (artifact.renderType === 'mermaid') {
    const lines = (artifact.content ?? '')
      .split('\n')
      .filter(line => line.includes('-->'))
      .slice(0, 20)

    return (
      <svg
        className="mt-3 w-full rounded bg-black/20 p-3"
        role="img"
        viewBox={`0 0 600 ${Math.max(80, lines.length * 32)}`}
      >
        {lines.map((line, index) => (
          <text fill="#ddd6fe" fontSize="13" key={`${line}-${index}`} x="12" y={28 + index * 30}>
            {line.replaceAll(/[<>{}]/g, '')}
          </text>
        ))}
      </svg>
    )
  }

  if (artifact.url) {
    return artifact.renderType === 'manim_video' ? (
      <video className="mt-3 max-h-96 w-full rounded" controls poster={artifact.posterUrl} src={artifact.url} />
    ) : (
      <img
        alt="TutorX generated visualization"
        className="mt-3 max-h-96 w-full rounded object-contain"
        src={artifact.url}
      />
    )
  }

  return <p className="mt-2 text-xs text-red-400">The animation service returned no artifact URL.</p>
}

function ResearchOutline({
  messageId,
  outline
}: {
  messageId: string
  outline: NonNullable<TutorMessage['researchOutline']>
}) {
  const [subTopics, setSubTopics] = useState(outline.subTopics)

  return (
    <section className="mt-3 rounded border border-violet-400/30 p-3">
      <strong className="text-xs">Research outline: {outline.topic}</strong>
      {subTopics.map((topic, index) => (
        <div className="mt-2 grid gap-1" key={index}>
          <input
            className="rounded border border-(--ui-border-primary) bg-transparent px-2 py-1 text-xs"
            onChange={event =>
              setSubTopics(items =>
                items.map((item, itemIndex) => (itemIndex === index ? { ...item, title: event.target.value } : item))
              )
            }
            value={topic.title}
          />
          <textarea
            className="rounded border border-(--ui-border-primary) bg-transparent px-2 py-1 text-xs"
            onChange={event =>
              setSubTopics(items =>
                items.map((item, itemIndex) => (itemIndex === index ? { ...item, overview: event.target.value } : item))
              )
            }
            value={topic.overview}
          />
        </div>
      ))}
      <div className="mt-3 flex gap-2">
        <Button
          onClick={() =>
            void sendTutorMessage(outline.topic, {
              config: { ...outline.researchConfig, confirmed_outline: subTopics },
              mode: 'deep_research'
            })
          }
          size="xs"
        >
          Confirm and research
        </Button>
        <Button onClick={() => dismissResearchOutline(messageId)} size="xs" variant="ghost">
          Cancel
        </Button>
      </div>
    </section>
  )
}

function QuestionBank({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<Record<string, unknown>[]>([])

  useEffect(() => {
    void tutorFetch<{ items?: Record<string, unknown>[] }>('/api/v1/question-notebook/entries?limit=100&offset=0').then(
      result => setEntries(result.items ?? [])
    )
  }, [])

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Question Bank</h2>
        <Button onClick={onClose} size="xs" variant="ghost">
          Back to chat
        </Button>
      </div>
      <div className="mt-3 grid gap-2">
        {entries.map((entry, index) => (
          <article className="qv-glass-tile rounded-lg p-3 text-xs" key={String(entry.id ?? index)}>
            <strong>{String(entry.question ?? 'Question')}</strong>
            <p className="mt-1 text-muted-foreground">{String(entry.user_answer ?? 'Not answered')}</p>
            <p className={entry.is_correct ? 'text-emerald-400' : 'text-red-400'}>
              {entry.is_correct ? 'Correct' : 'Needs review'}
            </p>
            {Boolean(entry.ai_judgment) && <p className="mt-1">{String(entry.ai_judgment)}</p>}
          </article>
        ))}
        {entries.length === 0 && <p className="text-xs text-muted-foreground">No judged questions yet.</p>}
      </div>
    </div>
  )
}

function TutorChat() {
  const messages = useStore($tutorMessages)
  const sessions = useStore($tutorSessions)
  const mode = useStore($tutorMode)
  const streaming = useStore($tutorStreaming)
  const connection = useStore($tutorConnection)
  const capabilities = useStore($tutorCapabilities)
  const [draft, setDraft] = useState('')
  const [reply, setReply] = useState('')
  const [researchDepth, setResearchDepth] = useState('standard')
  const [researchMode, setResearchMode] = useState('report')
  const [showBank, setShowBank] = useState(false)
  const lastSpokenRef = useRef<string | null>(null)

  const availableModes =
    capabilities.checked && !capabilities.masteryMode ? MODES.filter(item => item.id !== 'mastery_path') : MODES

  useEffect(() => {
    void loadTutorSessions().catch(() => {})
    void detectTutorCapabilities()

    return disposeTutorChat
  }, [])

  const pendingTutorInput = messages.some(message => Boolean(message.askUser))

  const voice = useDesktopVoiceActions({
    blocked: pendingTutorInput,
    busy: streaming,
    consumePendingResponse: () => {
      lastSpokenRef.current = messages.findLast(message => message.role === 'assistant' && message.content)?.id ?? null
    },
    onSubmit: (text, metadata) =>
      sendTutorMessage(
        text,
        mode === 'deep_research'
          ? { config: { depth: researchDepth, mode: researchMode }, inputModality: metadata.input_modality, mode }
          : { inputModality: metadata.input_modality, mode }
      ),
    pendingResponse: () => {
      const last = messages.findLast(message => message.role === 'assistant' && message.content)

      return last && last.id !== lastSpokenRef.current ? { id: last.id, pending: streaming, text: last.content } : null
    }
  })

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-52 shrink-0 overflow-y-auto border-r border-(--ui-border-primary) p-2">
        <Button className="mb-2 w-full" onClick={newTutorSession} size="sm" variant="secondary">
          <Codicon name="add" /> New session
        </Button>
        <Button className="mb-2 w-full" onClick={() => setShowBank(true)} size="sm" variant="ghost">
          Question Bank
        </Button>
        {sessions.map(session => {
          const id = session.session_id ?? session.id ?? ''

          return (
            <button
              className="block w-full truncate rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
              key={id}
              onClick={() => void openTutorSession(id)}
              type="button"
            >
              {session.title || 'Untitled session'}
            </button>
          )
        })}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {showBank ? (
          <QuestionBank onClose={() => setShowBank(false)} />
        ) : (
          <>
            <div className="flex flex-wrap gap-1 border-b border-(--ui-border-primary) p-2">
              {availableModes.map(item => (
                <Button
                  key={item.id}
                  onClick={() => $tutorMode.set(item.id)}
                  size="xs"
                  variant={mode === item.id ? 'secondary' : 'ghost'}
                >
                  {item.label}
                </Button>
              ))}
              <span className="ml-auto self-center text-[0.65rem] text-muted-foreground">{connection}</span>
            </div>
            {mode === 'deep_research' && (
              <div className="flex flex-wrap items-center gap-2 border-b border-(--ui-border-primary) bg-black/10 px-3 py-2 text-xs">
                <label className="flex items-center gap-2">
                  Output
                  <select onChange={event => setResearchMode(event.target.value)} value={researchMode}>
                    <option value="report">Report</option>
                    <option value="notes">Study notes</option>
                    <option value="comparison">Comparison</option>
                    <option value="learning_path">Learning path</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  Depth
                  <select onChange={event => setResearchDepth(event.target.value)} value={researchDepth}>
                    <option value="quick">Quick</option>
                    <option value="standard">Standard</option>
                    <option value="deep">Deep</option>
                  </select>
                </label>
                <span className="text-muted-foreground">
                  TutorX will generate an editable outline before research starts.
                </span>
              </div>
            )}
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 && (
                <div className="mx-auto mt-20 max-w-md text-center">
                  <img
                    alt=""
                    className="mx-auto size-20"
                    src={`${import.meta.env.BASE_URL}quizverse/quizy-front.png`}
                  />
                  <h2 className="mt-3 text-base font-semibold">What do you want to master?</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Choose a TutorX mode and start a native learning session.
                  </p>
                </div>
              )}
              {messages.map(message => (
                <article
                  className={cn(
                    'max-w-3xl rounded-xl border px-4 py-3 text-sm',
                    message.role === 'user'
                      ? 'ml-auto bg-violet-500/15'
                      : 'mr-auto border-(--ui-border-primary) bg-black/15'
                  )}
                  key={message.id}
                >
                  <div className="whitespace-pre-wrap leading-relaxed">{message.content || (streaming ? '…' : '')}</div>
                  {message.traces.length > 0 && (
                    <details className="mt-2 text-xs text-muted-foreground">
                      <summary>Tool trace ({message.traces.length})</summary>
                      {message.traces.map((trace, index) => (
                        <div className="mt-1 border-l border-violet-400/30 pl-2" key={`${trace.type}-${index}`}>
                          <strong>{trace.label}</strong> {trace.content}
                        </div>
                      ))}
                    </details>
                  )}
                  {message.quiz && message.quiz.length > 0 && (
                    <TutorQuizSet questions={message.quiz} turnId={message.turnId} />
                  )}
                  {message.researchOutline && (
                    <ResearchOutline messageId={message.id} outline={message.researchOutline} />
                  )}
                  {message.artifact && <VisualArtifact artifact={message.artifact} />}
                  {message.askUser && (
                    <form
                      className="mt-3 flex gap-2"
                      onSubmit={event => {
                        event.preventDefault()
                        answerTutorPrompt(message.askUser!.turnId, reply)
                        setReply('')
                      }}
                    >
                      <input
                        className="min-w-0 flex-1 rounded border border-(--ui-border-primary) bg-transparent px-2 py-1 text-xs"
                        onChange={event => setReply(event.target.value)}
                        placeholder={message.askUser.question}
                        value={reply}
                      />
                      <Button size="xs" type="submit">
                        Reply
                      </Button>
                    </form>
                  )}
                </article>
              ))}
            </div>
            <form
              className="grid gap-2 border-t border-(--ui-border-primary) p-3"
              onSubmit={event => {
                event.preventDefault()
                void sendTutorMessage(
                  draft,
                  mode === 'deep_research' ? { config: { depth: researchDepth, mode: researchMode }, mode } : undefined
                )
                setDraft('')
              }}
            >
              <div className="flex gap-2">
                <textarea
                  className="min-h-10 flex-1 resize-none rounded-lg border border-(--ui-border-primary) bg-black/10 px-3 py-2 text-sm outline-none focus:border-violet-400/50"
                  disabled={streaming}
                  onChange={event => setDraft(event.target.value)}
                  placeholder={`Ask TutorX in ${MODES.find(item => item.id === mode)?.label} mode…`}
                  value={draft}
                />
                {streaming ? (
                  <Button onClick={cancelTutorTurn} type="button" variant="secondary">
                    Cancel
                  </Button>
                ) : (
                  <Button disabled={!draft.trim()} type="submit">
                    Send
                  </Button>
                )}
                <Button onClick={regenerateTutorTurn} type="button" variant="ghost">
                  <Codicon name="refresh" />
                </Button>
              </div>
              <DesktopVoiceControls controller={voice} />
            </form>
          </>
        )}
      </div>
    </div>
  )
}

function KnowledgeCenter() {
  const [bases, setBases] = useState<KnowledgeBase[]>([])
  const [createFiles, setCreateFiles] = useState<File[]>([])
  const [defaultBase, setDefaultBase] = useState('')
  const [error, setError] = useState<null | string>(null)
  const [files, setFiles] = useState<Record<string, unknown>[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [name, setName] = useState('')
  const [policy, setPolicy] = useState<{ accept?: string; max_file_size_bytes?: number }>({})
  const [preview, setPreview] = useState('')
  const [provider, setProvider] = useState('default')
  const [providers, setProviders] = useState<{ id?: string; name?: string }[]>([])
  const [selectedBase, setSelectedBase] = useState('')

  const load = () =>
    tutorFetch<KnowledgeBase[] | { knowledge_bases?: KnowledgeBase[] }>('/api/v1/knowledge/list')
      .then(result => setBases(Array.isArray(result) ? result : (result.knowledge_bases ?? [])))
      .catch(reason => setError(String(reason)))

  useEffect(() => {
    load()
    void Promise.all([
      tutorFetch<{ providers?: { id?: string; name?: string }[] }>('/api/v1/knowledge/rag-providers'),
      tutorFetch<{ default_kb?: string }>('/api/v1/knowledge/default'),
      tutorFetch<typeof policy>('/api/v1/knowledge/supported-file-types')
    ])
      .then(([providerResult, defaultResult, policyResult]) => {
        setProviders(providerResult.providers ?? [])
        setDefaultBase(defaultResult.default_kb ?? '')
        setPolicy(policyResult)
      })
      .catch(reason => setError(String(reason)))
  }, [])

  const watchTask = (taskId: string) => {
    setLogs([])
    void tutorStream(`/api/v1/knowledge/tasks/${encodeURIComponent(taskId)}/stream`, event => {
      setLogs(current => [...current.slice(-99), String(event.message ?? event.content ?? event.type ?? 'Progress')])
    })
      .then(load)
      .catch(reason => setError(String(reason)))
  }

  const loadFiles = (baseName: string) => {
    setSelectedBase(baseName)
    setPreview('')
    void tutorFetch<{ files?: Record<string, unknown>[] }>(`/api/v1/knowledge/${encodeURIComponent(baseName)}/files`)
      .then(result => setFiles(result.files ?? []))
      .catch(reason => setError(String(reason)))
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-lg font-semibold">Knowledge Center</h2>
        <p className="text-xs text-muted-foreground">Create, upload, index, and browse TutorX knowledge bases.</p>
        <form
          className="mt-4 flex gap-2"
          onSubmit={event => {
            event.preventDefault()
            const body = new FormData()
            body.set('name', name)
            body.set('rag_provider', provider)
            createFiles.forEach(file => body.append('files', file))
            void tutorFetch<{ task_id?: string }>('/api/v1/knowledge/create', { body, method: 'POST' })
              .then(result => {
                setName('')
                setCreateFiles([])

                if (result.task_id) {
                  watchTask(result.task_id)
                } else {
                  load()
                }
              })
              .catch(reason => setError(String(reason)))
          }}
        >
          <input
            className="rounded border border-(--ui-border-primary) bg-transparent px-3 text-sm"
            onChange={e => setName(e.target.value)}
            placeholder="New knowledge base"
            value={name}
          />
          <select
            className="rounded border border-(--ui-border-primary) bg-transparent px-2 text-xs"
            onChange={event => setProvider(event.target.value)}
            value={provider}
          >
            <option value="default">Default provider</option>
            {providers.map(item => (
              <option key={item.id} value={item.id}>
                {item.name ?? item.id}
              </option>
            ))}
          </select>
          <input
            accept={policy.accept}
            className="max-w-48 text-xs"
            multiple
            onChange={event => setCreateFiles([...(event.target.files ?? [])])}
            type="file"
          />
          <Button disabled={!name.trim() || createFiles.length === 0} size="sm" type="submit">
            Create
          </Button>
        </form>
        <p className="mt-2 text-[0.65rem] text-muted-foreground">
          {policy.accept || 'Supported documents and archives'} · up to{' '}
          {policy.max_file_size_bytes ? Math.round(policy.max_file_size_bytes / 1024 / 1024) : 'server'} MB each
        </p>
        {logs.length > 0 && (
          <div className="mt-3 max-h-28 overflow-auto rounded bg-black/20 p-2 text-[0.65rem]">
            {logs.map((line, index) => (
              <div key={`${line}-${index}`}>{line}</div>
            ))}
          </div>
        )}
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {bases.map(base => (
            <article className="qv-glass-tile rounded-xl p-4" key={base.name}>
              <h3 className="font-medium">{base.name}</h3>
              <p className="text-xs text-muted-foreground">
                {base.status ?? 'ready'} · {base.statistics?.document_count ?? 0} documents ·{' '}
                {base.rag_provider ?? 'default'}
                {defaultBase === base.name ? ' · default' : ''}
              </p>
              <div className="mt-3 flex gap-2">
                <label className="cursor-pointer text-xs text-violet-300">
                  Upload
                  <input
                    className="hidden"
                    multiple
                    onChange={event => {
                      const body = new FormData()
                      Array.from(event.target.files ?? []).forEach(file => {
                        body.append('files', file)
                        body.append('rel_paths', file.name)
                      })
                      void tutorFetch<{ task_id?: string }>(
                        `/api/v1/knowledge/${encodeURIComponent(base.name)}/upload`,
                        { body, method: 'POST' }
                      )
                        .then(result => (result.task_id ? watchTask(result.task_id) : load()))
                        .catch(reason => setError(String(reason)))
                    }}
                    type="file"
                  />
                </label>
                <button
                  className="text-xs text-violet-300"
                  onClick={() =>
                    void tutorFetch<{ task_id?: string }>(
                      `/api/v1/knowledge/${encodeURIComponent(base.name)}/reindex`,
                      { method: 'POST' }
                    ).then(result => (result.task_id ? watchTask(result.task_id) : load()))
                  }
                  type="button"
                >
                  Reindex
                </button>
                <button
                  className="text-xs text-violet-300"
                  onClick={() =>
                    void tutorFetch<{ task_id?: string }>(`/api/v1/knowledge/${encodeURIComponent(base.name)}/retry`, {
                      method: 'POST'
                    }).then(result => (result.task_id ? watchTask(result.task_id) : load()))
                  }
                  type="button"
                >
                  Retry
                </button>
                <button className="text-xs text-violet-300" onClick={() => loadFiles(base.name)} type="button">
                  Files
                </button>
                <button
                  className="text-xs text-violet-300"
                  onClick={() =>
                    void tutorFetch(`/api/v1/knowledge/default/${encodeURIComponent(base.name)}`, {
                      method: 'PUT'
                    }).then(() => setDefaultBase(base.name))
                  }
                  type="button"
                >
                  Set default
                </button>
                <button
                  className="text-xs text-red-300"
                  onClick={() => {
                    if (window.confirm(`Delete knowledge base “${base.name}”?`)) {
                      void tutorFetch(`/api/v1/knowledge/${encodeURIComponent(base.name)}`, { method: 'DELETE' }).then(
                        load
                      )
                    }
                  }}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
        {selectedBase && (
          <section className="mt-5 rounded-xl border border-(--ui-border-primary) p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{selectedBase} files</h3>
              <Button
                onClick={() => {
                  const folder = window.prompt('New folder name')

                  if (folder) {
                    void tutorFetch(`/api/v1/knowledge/${encodeURIComponent(selectedBase)}/folders`, {
                      body: JSON.stringify({ path: folder }),
                      method: 'POST'
                    }).then(() => loadFiles(selectedBase))
                  }
                }}
                size="xs"
                variant="secondary"
              >
                New folder
              </Button>
            </div>
            <div className="mt-2 grid gap-1">
              {files.map((file, index) => {
                const filename = String(file.name ?? file.path ?? index)

                return (
                  <div className="flex items-center gap-2 rounded bg-black/10 px-2 py-1 text-xs" key={filename}>
                    <span className="min-w-0 flex-1 truncate">{filename}</span>
                    {file.type !== 'folder' && (
                      <button
                        className="text-violet-300"
                        onClick={() =>
                          void tutorFetch<{ text?: string; content?: string }>(
                            `/api/v1/knowledge/${encodeURIComponent(selectedBase)}/file-preview-text/${filename.split('/').map(encodeURIComponent).join('/')}`
                          ).then(result => setPreview(result.text ?? result.content ?? JSON.stringify(result)))
                        }
                        type="button"
                      >
                        Preview
                      </button>
                    )}
                    <button
                      className="text-violet-300"
                      onClick={() => {
                        const destination = window.prompt('Move to folder', '')

                        if (destination != null) {
                          void tutorFetch(`/api/v1/knowledge/${encodeURIComponent(selectedBase)}/files/move`, {
                            body: JSON.stringify({ destination, source: filename }),
                            method: 'POST'
                          }).then(() => loadFiles(selectedBase))
                        }
                      }}
                      type="button"
                    >
                      Move
                    </button>
                  </div>
                )
              })}
            </div>
            {preview && (
              <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-3 text-xs">
                {preview}
              </pre>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function StructuredRecords({ data }: { data: unknown }) {
  if (!data) {
    return <div className="mt-4 text-xs text-muted-foreground">Loading…</div>
  }

  const root = data as Record<string, unknown>

  const records = Array.isArray(data) ? data : (Object.values(root).find(value => Array.isArray(value)) ?? [root])

  if (!Array.isArray(records) || records.length === 0) {
    return <div className="qv-glass-tile mt-4 rounded-xl p-4 text-xs text-muted-foreground">No records yet.</div>
  }

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {records.map((record, index) => {
        const fields =
          record && typeof record === 'object' ? Object.entries(record as Record<string, unknown>) : [['value', record]]

        return (
          <article
            className="qv-glass-tile rounded-xl p-4 text-xs"
            key={String((record as Record<string, unknown>)?.id ?? index)}
          >
            {fields.map(([key, value]) => (
              <div className="mb-2" key={key}>
                <div className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
                  {key.replaceAll('_', ' ')}
                </div>
                <div className="mt-0.5 break-words">
                  {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}
                </div>
              </div>
            ))}
          </article>
        )
      })}
    </div>
  )
}

function LearningSpace() {
  const [bookId, setBookId] = useState('')
  const [progress, setProgress] = useState<Record<string, unknown>[]>([])
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const [map, setMap] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [source, setSource] = useState<'loading' | 'nakama' | 'tutor'>('loading')

  const load = async () => {
    setError('')
    const capabilities = await detectTutorCapabilities()

    if (capabilities.learningApi) {
      const result = await tutorFetch<Record<string, unknown>[] | { items?: Record<string, unknown>[] }>(
        '/api/v1/learning/progress'
      )

      setProgress(Array.isArray(result) ? result : (result.items ?? []))
      setSource('tutor')

      return
    }

    try {
      const result = await playRpc<Record<string, unknown>>('progression_get_state')
      const data = (result.data ?? result) as Record<string, unknown>

      setProgress([data])
      setSelected(data)
      setSource('nakama')
    } catch (reason) {
      setSource('nakama')
      setError(
        `Native QuizVerse progression is temporarily unavailable: ${
          reason instanceof Error ? reason.message : String(reason)
        }`
      )
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const open = async (id: string) => {
    setBookId(id)

    const [detail, mapDetail] = await Promise.all([
      tutorFetch<Record<string, unknown>>(`/api/v1/learning/progress/${encodeURIComponent(id)}`),
      tutorFetch<Record<string, unknown>>(`/api/v1/learning/progress/${encodeURIComponent(id)}/map`)
    ])

    setSelected(detail)
    setMap(mapDetail)
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-lg font-semibold">Learning Space</h2>
        <p className="text-xs text-muted-foreground">
          {source === 'tutor'
            ? 'Build, inspect, and restart TutorX mastery paths.'
            : 'Track native QuizVerse mastery, level, and learning progress.'}
        </p>
        {source === 'tutor' && (
          <div className="mt-3 flex gap-2">
            <input
              className="rounded border border-(--ui-border-primary) bg-transparent px-2 text-xs"
              onChange={event => setBookId(event.target.value)}
              placeholder="Book or path ID"
              value={bookId}
            />
            <Button disabled={!bookId.trim()} onClick={() => void open(bookId)} size="xs">
              Open path
            </Button>
            <Button
              disabled={!bookId.trim()}
              onClick={() =>
                void tutorFetch(`/api/v1/learning/progress/${encodeURIComponent(bookId)}/init-modules`, {
                  body: JSON.stringify({
                    modules: [
                      {
                        id: `${bookId}-module-1`,
                        knowledge_points: [
                          {
                            id: `${bookId}-kp-1`,
                            module_id: `${bookId}-module-1`,
                            name: 'Core concepts',
                            type: 'concept'
                          }
                        ],
                        name: 'Getting started',
                        order: 0,
                        pass_threshold: 0.7
                      }
                    ]
                  }),
                  method: 'POST'
                }).then(() => open(bookId))
              }
              size="xs"
              variant="secondary"
            >
              Initialize
            </Button>
          </div>
        )}
        {source === 'nakama' && (
          <div className="mt-3 flex gap-2">
            <Button onClick={() => void load()} size="xs" variant="secondary">
              Refresh progress
            </Button>
            <Button
              onClick={() => {
                $tutorMode.set('chat')
                void sendTutorMessage('Review my QuizVerse learning progress and give me a focused practice plan.', {
                  mode: 'chat'
                })
              }}
              size="xs"
            >
              Practice with TutorX
            </Button>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        {source === 'loading' && <p className="mt-4 text-xs text-muted-foreground">Checking learning capabilities…</p>}
        <div className="mt-4 grid gap-3 md:grid-cols-[16rem_1fr]">
          <aside className="space-y-2">
            {progress.map((item, index) => {
              const id = String(item.book_id ?? item.id ?? index)

              return (
                <button
                  className="qv-glass-tile block w-full rounded-lg p-3 text-left text-xs"
                  key={id}
                  onClick={source === 'tutor' ? () => void open(id) : () => setSelected(item)}
                  type="button"
                >
                  <strong>{String(item.title ?? item.name ?? id)}</strong>
                  <div className="text-muted-foreground">{String(item.current_stage ?? item.status ?? 'new')}</div>
                </button>
              )
            })}
          </aside>
          <section>
            {selected ? (
              <>
                {source === 'tutor' && (
                  <div className="flex gap-2">
                    <Button
                      onClick={() =>
                        void tutorFetch(`/api/v1/learning/progress/${encodeURIComponent(bookId)}/redo`, {
                          method: 'POST'
                        }).then(() => open(bookId))
                      }
                      size="xs"
                      variant="secondary"
                    >
                      Redo path
                    </Button>
                    <Button
                      onClick={() =>
                        void sendTutorMessage(`Continue my mastery path ${bookId}.`, { mode: 'mastery_path' })
                      }
                      size="xs"
                    >
                      Continue with TutorX
                    </Button>
                  </div>
                )}
                {source === 'tutor' && (
                  <>
                    <h3 className="mt-4 text-sm font-semibold">Mastery map</h3>
                    <StructuredRecords data={(map?.map as unknown) ?? map} />
                  </>
                )}
                <h3 className="mt-4 text-sm font-semibold">Progress detail</h3>
                <StructuredRecords data={selected} />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No learning progress has been recorded yet.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function MemorySpace() {
  const [overview, setOverview] = useState<unknown>(null)
  const [message, setMessage] = useState('')

  const load = () =>
    tutorFetch('/api/v1/memory/overview')
      .then(setOverview)
      .catch(reason => setMessage(reason instanceof Error ? reason.message : String(reason)))

  useEffect(() => void load(), [])

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-lg font-semibold">Memory</h2>
        <p className="text-xs text-muted-foreground">Inspect and refresh the learner context TutorX uses.</p>
        <div className="mt-3 flex gap-2">
          <Button
            onClick={() => void tutorFetch('/api/v1/memory/refresh', { body: '{}', method: 'POST' }).then(load)}
            size="xs"
          >
            Refresh memory
          </Button>
          <Button
            onClick={() => {
              if (window.confirm('Clear TutorX learner memory? This cannot be undone.')) {
                void tutorFetch('/api/v1/memory/clear', { body: '{}', method: 'POST' }).then(load)
              }
            }}
            size="xs"
            variant="secondary"
          >
            Clear memory
          </Button>
        </div>
        {message && <p className="mt-2 text-xs text-red-400">{message}</p>}
        <StructuredRecords data={overview} />
      </div>
    </div>
  )
}

export function NativeTutorSurface({ surface }: { surface: 'knowledge' | 'learning' | 'memory' | 'tutor' }) {
  if (surface === 'tutor') {
    return <TutorChat />
  }

  if (surface === 'knowledge') {
    return <KnowledgeCenter />
  }

  if (surface === 'memory') {
    return <MemorySpace />
  }

  return <LearningSpace />
}
