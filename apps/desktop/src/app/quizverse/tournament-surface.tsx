import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

import { normalizeLeaderboard } from './engines/leaderboard'
import { productRequest } from './engines/product-client'
import {
  certificateIdFromClaim,
  loadTournamentPackArtifact,
  normalizeLearningTrack,
  normalizeTournamentBracket,
  normalizeTournamentCertificate,
  type TournamentBracket
} from './engines/service-contracts'
import { createSubmissionMachine } from './engines/submission-fsm'
import { openNativeSurface } from './native-surface-store'
import { type PlayQuestion, playRpc } from './play-store'

interface TournamentSurfaceProps {
  route: string
}

interface Tournament {
  entry_fee?: number
  entries_count?: number
  id?: string
  name?: string
  pot_bc?: number
  slug: string
  status?: string
  title?: string
}

interface TournamentPack {
  packId: string
  questions: PlayQuestion[]
}

const selectedKey = 'qv_tournament_selected_v1'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function dataRecord(value: unknown): Record<string, unknown> {
  const root = record(value)

  return record(root.data ?? root)
}

function normalizeTournaments(value: unknown): Tournament[] {
  const data = dataRecord(value)
  const rows = Array.isArray(data.tournaments) ? data.tournaments : Array.isArray(value) ? value : []

  return rows.flatMap(item => {
    const row = record(item)
    const slug = String(row.slug ?? row.tournament_slug ?? row.id ?? '')

    return slug ? [{ ...row, slug } as Tournament] : []
  })
}

function useSelectedSlug() {
  const [slug, setSlugState] = useState(() => localStorage.getItem(selectedKey) ?? '')

  const setSlug = (next: string) => {
    localStorage.setItem(selectedKey, next)
    setSlugState(next)
  }

  return [slug, setSlug] as const
}

function Card({ children, title }: { children: React.ReactNode; title: string }) {
  return <section className="qv-glass-tile rounded-xl p-4"><h3 className="text-sm font-semibold">{title}</h3>{children}</section>
}

function Notice({ error, text }: { error?: boolean; text: string }) {
  return text ? <p className={`mt-3 rounded p-2 text-xs ${error ? 'bg-red-950/50 text-red-100' : 'bg-black/20'}`} role={error ? 'alert' : 'status'}>{text}</p> : null
}

function TournamentHub({ onSelect }: { onSelect: (slug: string) => void }) {
  const [items, setItems] = useState<Tournament[]>([])
  const [error, setError] = useState('')
  const [coins, setCoins] = useState<number | null>(null)
  const [streak, setStreak] = useState<Record<string, unknown> | null>(null)
  const checkInKey = useRef(crypto.randomUUID())

  useEffect(() => {
    void playRpc('tournament_list', {}, { cache: true }).then(value => setItems(normalizeTournaments(value))).catch(reason => setError(String(reason)))
    void playRpc('brain_coins_get').then(value => setCoins(Number(dataRecord(value).balance ?? dataRecord(value).brain_coins ?? 0))).catch(() => undefined)
    void playRpc('tournament_streak_get').then(value => setStreak(dataRecord(value))).catch(() => undefined)
  }, [])

  return (
    <div className="grid gap-3">
      <Card title="Tournament season">
        <p className="mt-2 text-xs text-muted-foreground">Brain Coins: {coins ?? '—'} · streak: {String(streak?.current_streak ?? streak?.streak ?? 0)} days</p>
        <Button className="mt-3" onClick={() => void playRpc('tournament_streak_check_in', { idempotency_key: checkInKey.current }).then(value => setStreak(dataRecord(value))).catch(reason => setError(String(reason)))} size="sm" variant="outline">Daily tournament check-in</Button>
      </Card>
      {items.map(item => (
        <button className="qv-glass-tile rounded-xl p-4 text-left" key={item.slug} onClick={() => { onSelect(item.slug); openNativeSurface('tournaments', 'detail') }} type="button">
          <b>{item.title ?? item.name ?? item.slug}</b>
          <span className="mt-1 block text-xs text-muted-foreground">{item.status ?? 'scheduled'} · pot {item.pot_bc ?? 0} BC · {item.entries_count ?? 0} entries</span>
        </button>
      ))}
      {!items.length && !error && <p aria-live="polite" className="text-sm text-muted-foreground">Loading competitions…</p>}
      <Notice error text={error} />
    </div>
  )
}

function TournamentDetail({ slug }: { slug: string }) {
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [realtime, setRealtime] = useState('poll fallback')

  useEffect(() => {
    if (!slug) {return}
    let connectionId = ''
    const bridge = window.hermesDesktop.quizverse
    const refresh = () => void playRpc('tournament_get', { slug }).then(value => setDetail(dataRecord(value))).catch(reason => setError(String(reason)))

    const unsubscribe = bridge?.onPlayRealtimeEvent?.(event => {
      if (event.id !== connectionId || event.type !== 'notification') {return}
      const notification = record(event.data)

      if (Number(notification.code) !== 1001) {return}
      let content: Record<string, unknown>

      try {
        content = typeof notification.content === 'string' ? record(JSON.parse(notification.content)) : record(notification.content)
      } catch {
        return
      }

      if (String(content.slug ?? content.tournament_slug ?? '') !== slug) {return}
      setDetail(current => ({ ...(current ?? {}), entries_count: content.entries_count, pot_bc: content.pot_bc }))
      setRealtime('Nakama notification 1001')
    })

    refresh()
    const timer = window.setInterval(refresh, 10_000)

    if (bridge?.playRealtimeConnect) {
      void bridge.playRealtimeConnect().then(connection => {
        connectionId = connection.id
        setRealtime('Nakama connected')
      }).catch(() => setRealtime('poll fallback'))
    }

    return () => {
      window.clearInterval(timer)
      unsubscribe?.()

      if (connectionId) {void bridge?.playRealtimeClose(connectionId)}
    }
  }, [slug])

  if (!slug) {return <Notice error text="Choose a tournament from the hub first." />}

  return (
    <Card title={String(detail?.title ?? detail?.name ?? slug)}>
      <p className="mt-2 text-xs">{String(detail?.description ?? detail?.rules ?? 'Competition details are loading.')}</p>
      <p className="mt-2 text-sm">Live pot: {String(detail?.pot_bc ?? 0)} BC · entries {String(detail?.entries_count ?? 0)} · {realtime}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {['age-gate', 'enroll', 'play', 'picks', 'bracket', 'leaderboard'].map(route => <Button key={route} onClick={() => openNativeSurface('tournaments', route)} size="sm" variant="outline">{route}</Button>)}
      </div>
      <Notice error text={error} />
    </Card>
  )
}

function AgeGate({ slug }: { slug: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [auth, setAuth] = useState<{ authenticated: boolean; configured: boolean } | null>(null)
  const [error, setError] = useState('')
  const [method, setMethod] = useState<'driving_license' | 'kyc_aml'>('kyc_aml')

  const refresh = useCallback(() => {
    if (slug) {void playRpc('tournament_caller_status', { slug }).then(value => setStatus(dataRecord(value))).catch(reason => setError(String(reason)))}
  }, [slug])

  useEffect(() => {
    void window.hermesDesktop.quizverse?.authStatus().then(setAuth).catch(reason => setError(String(reason)))
    refresh()
  }, [refresh])

  const startKyc = async () => {
    try {
      const returnUrl = `quizverse://tournaments/kyc?slug=${encodeURIComponent(slug)}`

      const { data } = await productRequest<Record<string, unknown>>({
        body: { method, return_url: returnUrl },
        method: 'POST',
        path: '/api/kyc/age/start'
      })

      const root = dataRecord(data)
      const redirect = new URL(String(root.redirect_url ?? ''))

      if (redirect.protocol !== 'https:' || !/(^|\.)((didit\.me)|(veriff\.me)|(veriff\.com))$/i.test(redirect.hostname)) {
        throw new Error('KYC provider returned an untrusted verification URL.')
      }

      await window.hermesDesktop.openExternal(redirect.toString())
      setError('Secure verification opened in your system browser. Return here and refresh status.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <Card title="Age eligibility and KYC">
      <p className="mt-2 text-sm">{auth?.authenticated ? 'Cognito account linked.' : auth?.configured ? 'Sign in to verify eligibility.' : 'Cognito is not configured. Add issuer, domain, and client ID in Setup.'}</p>
      <p className="mt-2 text-xs">KYC status: {String(status?.kyc_status ?? status?.age_status ?? status?.status ?? 'unavailable')} · eligible: {String(status?.tournament_eligible ?? false)}</p>
      {!auth?.authenticated && <Button className="mt-3" disabled={!auth?.configured} onClick={() => void window.hermesDesktop.quizverse?.authStart()} size="sm">Link QuizVerse account</Button>}
      {auth?.authenticated && <><div className="mt-3 flex gap-2"><Button onClick={() => setMethod('kyc_aml')} size="sm" variant={method === 'kyc_aml' ? 'default' : 'outline'}>ID + face</Button><Button onClick={() => setMethod('driving_license')} size="sm" variant={method === 'driving_license' ? 'default' : 'outline'}>Driving licence</Button></div><div className="mt-3 flex gap-2"><Button onClick={() => void startKyc()}>Start secure verification</Button><Button onClick={refresh} variant="outline">Refresh status</Button></div></>}
      <Notice error text={error} />
    </Card>
  )
}

function Enroll({ slug }: { slug: string }) {
  const [method, setMethod] = useState<'amoe' | 'balance'>('amoe')
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const keys = useRef({ enter: crypto.randomUUID(), preEnroll: crypto.randomUUID() })

  const submit = async (preEnroll: boolean) => {
    setBusy(true)
    setMessage('')

    try {
      await playRpc(preEnroll ? 'tournament_pre_enroll' : 'tournament_enter', {
        idempotency_key: preEnroll ? keys.current.preEnroll : keys.current.enter,
        paid_via: method,
        slug
      })
      setMessage(preEnroll ? 'Pre-enrollment recorded.' : `Entry confirmed through ${method}.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Tournament entry">
      <div className="mt-3 flex gap-2">{(['amoe', 'balance'] as const).map(value => <Button key={value} onClick={() => setMethod(value)} variant={method === value ? 'default' : 'outline'}>{value === 'amoe' ? 'Free AMOE' : 'Brain Coin balance'}</Button>)}</div>
      <label className="mt-3 flex gap-2 text-xs"><input checked={confirmed} onChange={event => setConfirmed(event.target.checked)} type="checkbox" />I understand this creates an idempotent tournament entry.</label>
      <div className="mt-3 flex gap-2"><Button disabled={!slug || !confirmed || busy} onClick={() => void submit(true)} variant="outline">Pre-enroll</Button><Button disabled={!slug || !confirmed || busy} onClick={() => void submit(false)}>Enter tournament</Button></div>
      <Notice text={message} />
    </Card>
  )
}

function TournamentPlay({ slug }: { slug: string }) {
  const [pack, setPack] = useState<TournamentPack | null>(null)
  const [answers, setAnswers] = useState<number[]>([])
  const [startedAt, setStartedAt] = useState(0)
  const [message, setMessage] = useState('')
  const machine = useMemo(() => createSubmissionMachine((input: Record<string, unknown>, idempotencyKey) => playRpc('tournament_submit_pack_result', { ...input, idempotency_key: idempotencyKey }) as Promise<Record<string, unknown>>), [])

  useEffect(() => {
    if (!slug) {return}
    void playRpc('tournament_content_get_pack', { language: 'en', slug }).then(value => loadTournamentPackArtifact(value, slug)).then(normalized => {

      if (normalized.status === 'generating') {throw new Error('The tournament question pack is still being prepared.')}
      setPack(normalized)
      setStartedAt(Date.now())
    }).catch(reason => setMessage(String(reason)))
  }, [slug])

  const question = pack?.questions[answers.length]
  const correct = pack ? answers.reduce((sum, answer, index) => sum + (answer === pack.questions[index]?.correctIndex ? 1 : 0), 0) : 0

  if (!question && pack && answers.length === pack.questions.length) {
    return <Card title="Issued pack complete"><p className="mt-2 text-sm">{correct}/{pack.questions.length} correct.</p><Button className="mt-3" onClick={() => void machine.submit({ correct, duration_ms: Date.now() - startedAt, honeypot_correct: 0, honeypot_total: 0, latency_ms: 0, pack_id: pack.packId || slug, slug, total: pack.questions.length }).then(() => setMessage('Tournament result submitted once.')).catch(reason => setMessage(String(reason)))}>Confirm ranked result</Button><Notice text={message} /></Card>
  }

  return <Card title="Server-issued tournament pack">{question ? <><p className="mt-2 text-xs">Question {answers.length + 1}/{pack!.questions.length}</p><p className="mt-3 font-semibold">{question.prompt}</p><div className="mt-3 grid gap-2">{question.options.map((option, index) => <Button key={`${option}:${index}`} onClick={() => setAnswers(current => [...current, index])} variant="outline">{option}</Button>)}</div></> : <p className="mt-2 text-sm">Loading issued pack…</p>}<Notice error={Boolean(message)} text={message} /></Card>
}

function Picks({ slug }: { slug: string }) {
  const [rows, setRows] = useState<{ id: string; options: string[]; prompt: string }[]>([])
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState('')
  const idempotencyKey = useRef(crypto.randomUUID())

  useEffect(() => {
    if (!slug) {return}
    void playRpc('tournament_content_get_pack', { language: 'en', slug }).then(value => loadTournamentPackArtifact(value, slug)).then(pack => {
      if (pack.status === 'generating') {throw new Error('The tournament pick slate is still being prepared.')}
      setRows(pack.questions.map(question => ({ id: question.id, options: question.options, prompt: question.prompt })))
    }).catch(reason => setMessage(String(reason)))
  }, [slug])

  return <Card title="Pick’em slip">{rows.map(row => <fieldset className="mt-3" key={row.id}><legend className="text-sm font-medium">{row.prompt}</legend><div className="mt-2 flex flex-wrap gap-2">{row.options.map(option => <Button key={option} onClick={() => setPicks(current => ({ ...current, [row.id]: option }))} size="sm" variant={picks[row.id] === option ? 'default' : 'outline'}>{option}</Button>)}</div></fieldset>)}<label className="mt-4 flex gap-2 text-xs"><input checked={confirmed} onChange={event => setConfirmed(event.target.checked)} type="checkbox" />Lock these picks until settlement.</label><Button className="mt-3" disabled={!rows.length || Object.keys(picks).length !== rows.length || !confirmed} onClick={() => void playRpc('tournament_submit_picks', { idempotency_key: idempotencyKey.current, picks: Object.entries(picks).map(([question_id, answer_id]) => ({ answer_id, question_id })), slug }).then(() => setMessage('Pick’em slip submitted.')).catch(reason => setMessage(String(reason)))}>Submit picks</Button><Notice text={message} /></Card>
}

function SafeRpcView({ name, payload, title }: { name: string; payload: Record<string, unknown>; title: string }) {
  const [value, setValue] = useState<unknown>()
  const [error, setError] = useState('')
  const serializedPayload = JSON.stringify(payload)
  useEffect(() => { void playRpc(name, JSON.parse(serializedPayload) as Record<string, unknown>).then(setValue).catch(reason => setError(String(reason))) }, [name, serializedPayload])

  const leaderboard = name.startsWith('tournament_leaderboard') ? normalizeLeaderboard(dataRecord(value)) : []

  return <Card title={title}>{leaderboard.length ? <ol className="mt-3 grid gap-1">{leaderboard.map(row => <li className="text-xs" key={`${row.ownerId}:${row.rank}`}>#{row.rank} {row.username} · {row.score}</li>)}</ol> : value ? <pre className="mt-3 max-h-80 overflow-auto rounded bg-black/20 p-3 text-xs">{JSON.stringify(value, null, 2)}</pre> : <p className="mt-2 text-sm">Loading…</p>}<Notice error text={error} /></Card>
}

function Bracket({ slug }: { slug: string }) {
  const [bracket, setBracket] = useState<TournamentBracket | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    void playRpc('tournament_bracket_state', { slug }).then(value => {
      setBracket(normalizeTournamentBracket(value))
    }).catch(reason => setError(String(reason)))
  }, [slug])

  return <Card title="Tournament bracket">{bracket?.exists ? <><p className="mt-2 text-sm">Round {bracket.round} of {bracket.totalRounds} · bracket {bracket.bracketId}</p>{bracket.publicDashboardUrl && <Button className="mt-3" onClick={() => void window.hermesDesktop.openExternal(bracket.publicDashboardUrl)} variant="outline">Open live bracket</Button>}</> : <p className="mt-2 text-sm">Bracket is not seeded yet.</p>}<Notice error text={error} /></Card>
}

function Certificate({ slug }: { slug: string }) {
  const [certificate, setCertificate] = useState<Record<string, unknown> | null>(null)
  const [message, setMessage] = useState('')
  const storageKey = `qv_tournament_certificate_v1:${slug}`

  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? 'null') as { id?: string; idempotencyKey?: string } | null
    } catch {
      return null
    }
  }, [storageKey])

  const key = useRef(saved?.idempotencyKey ?? crypto.randomUUID())

  const load = useCallback((id: string) => {
    if (!id) {return}
    void playRpc('certificate_get', { id }).then(value => setCertificate(normalizeTournamentCertificate(value))).catch(reason => setMessage(String(reason)))
  }, [])

  useEffect(() => load(saved?.id ?? ''), [load, saved?.id])

  const claim = async () => {
    try {
      const result = await playRpc('tournament_claim_certificate', { idempotency_key: key.current, slug })
      const id = certificateIdFromClaim(result)

      if (!id) {throw new Error('Certificate claim returned no certificate id')}
      localStorage.setItem(storageKey, JSON.stringify({ id, idempotencyKey: key.current }))
      load(id)
    } catch (reason) {
      setMessage(String(reason))
    }
  }

  const shareText = certificate ? `QuizVerse Tournament Certificate\n${String(certificate.tournament_name ?? slug)}\n${String(certificate.player_username ?? '')}\n${String(certificate.id ?? '')}` : ''

  return <Card title="Tournament certificate">{certificate ? <div className="mt-3 rounded-xl border-4 border-amber-400/60 bg-gradient-to-br from-violet-950 to-slate-950 p-8 text-center"><p className="text-xs uppercase tracking-[0.3em]">Certificate of Achievement</p><h4 className="mt-3 text-2xl font-bold">{String(certificate.tournament_name ?? slug)}</h4><p className="mt-3">{String(certificate.player_username ?? 'QuizVerse competitor')}</p><p className="mt-3 text-xs">Certificate {String(certificate.id)}</p></div> : <p className="mt-2 text-sm">No certificate has been loaded yet.</p>}<div className="mt-3 flex gap-2"><Button onClick={() => void claim()}>Claim certificate</Button><Button disabled={!certificate} onClick={() => void navigator.clipboard.writeText(shareText).then(() => setMessage('Certificate share text copied.'))} variant="outline">Share</Button></div><Notice text={message} /></Card>
}

function Referral() {
  const [value, setValue] = useState<Record<string, unknown> | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => { void playRpc('referral_my_code').then(result => setValue(dataRecord(result))).catch(reason => setMessage(String(reason))) }, [])
  const code = String(value?.code ?? value?.referral_code ?? '')
  const url = String(value?.url ?? value?.referral_url ?? '')

  return <Card title="Invite friends"><p className="mt-3 text-2xl font-bold tracking-widest">{code || 'Loading…'}</p>{url && <p className="mt-2 break-all text-xs">{url}</p>}<Button className="mt-3" disabled={!code && !url} onClick={() => void navigator.clipboard.writeText(url || code).then(() => setMessage('Referral copied.'))}>Copy referral</Button><Notice text={message} /></Card>
}

function LearningTrack({ slug }: { slug: string }) {
  const [track, setTrack] = useState<Record<string, unknown> | null>(null)
  const [videos, setVideos] = useState<Record<string, unknown>[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    void playRpc('learning_track_get', { track_id: slug }).then(value => {
      const normalized = normalizeLearningTrack(value)
      setTrack(normalized.track)
      setVideos(normalized.videos)
    }).catch(reason => setError(String(reason)))
  }, [slug])

  return <Card title={String(track?.topic_label ?? track?.title ?? 'Learning track')}><p className="mt-2 text-xs">{String(track?.description ?? 'Tournament preparation path')}</p><ol className="mt-3 grid gap-2">{videos.map((video, index) => <li className="rounded border p-3 text-sm" key={String(video.id ?? index)}><span aria-hidden>{index + 1}. </span>{String(video.title ?? `Video ${index + 1}`)}<span className="block text-xs text-muted-foreground">{String(video.duration_sec ?? 0)} seconds · {String(video.check_question_count ?? (Array.isArray(video.check_questions) ? video.check_questions.length : 0))} checks</span></li>)}</ol>{!videos.length && !error && <p className="mt-3 text-sm">No learning videos are published for this tournament.</p>}<Notice error text={error} /></Card>
}

function IntentQuiz() {
  const [quiz, setQuiz] = useState<Record<string, unknown> | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const idempotencyKey = useRef(crypto.randomUUID())
  useEffect(() => { void playRpc('tournament_intent_quiz_get').then(value => setQuiz(dataRecord(value))).catch(reason => setMessage(String(reason))) }, [])
  const questions = Array.isArray(quiz?.questions) ? quiz.questions as unknown[] : []

  return <Card title="Tournament intent quiz">{questions.map((item, index) => { const row = record(item); const id = String(row.id ?? index);

 return <fieldset className="mt-3" key={id}><legend className="text-sm">{String(row.question ?? row.prompt)}</legend><div className="mt-2 flex gap-2">{((row.options as unknown[]) ?? []).map(option => <Button key={String(option)} onClick={() => setAnswers(current => ({ ...current, [id]: String(option) }))} size="sm" variant={answers[id] === String(option) ? 'default' : 'outline'}>{String(option)}</Button>)}</div></fieldset> })}<Button className="mt-3" disabled={!questions.length || Object.keys(answers).length !== questions.length} onClick={() => void playRpc('tournament_intent_quiz_submit', { answers, idempotency_key: idempotencyKey.current }).then(value => setMessage(JSON.stringify(dataRecord(value)))).catch(reason => setMessage(String(reason)))}>Get recommendation</Button><Notice text={message} /></Card>
}

export function TournamentSurface({ route }: TournamentSurfaceProps) {
  const [slug, setSlug] = useSelectedSlug()

  if (route === 'hub') {return <TournamentHub onSelect={setSlug} />}

  if (route === 'detail') {return <TournamentDetail slug={slug} />}

  if (route === 'age-gate') {return <AgeGate slug={slug} />}

  if (route === 'enroll') {return <Enroll slug={slug} />}

  if (route === 'play') {return <TournamentPlay slug={slug} />}

  if (route === 'picks') {return <Picks slug={slug} />}

  if (route === 'bracket') {return <Bracket slug={slug} />}

  if (route === 'leaderboard') {return <SafeRpcView name="tournament_leaderboard_top" payload={{ limit: 50, slug }} title="Tournament leaderboard" />}

  if (route === 'certificate') {return <Certificate slug={slug} />}

  if (route === 'referral') {return <Referral />}

  if (route === 'learning') {return <LearningTrack slug={slug} />}

  if (route === 'intent') {return <IntentQuiz />}

  return <Notice error text="Unknown tournament route." />
}
