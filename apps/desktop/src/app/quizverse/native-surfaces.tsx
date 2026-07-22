import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import {
  FALLBACK_VOYAGE_TIER,
  fallbackWordsDaily,
  loadVoyageTier,
  loadWordsDaily,
  type VoyageTier,
  type WordsDailyEnvelope,
  type WordsMode
} from './engines/authoritative-content'
import { seededShuffle } from './engines/daily-content'
import { productRequest } from './engines/product-client'
import { $nativeStreak, completeStreakDay } from './engines/streak-store'
import { LinkPlaySurface } from './link-play-surface'
import { type NativeRouteContract, nativeSurface, type NativeSurfaceId } from './native-contracts'
import { $nativeSurfaceLocation, openNativeSurface } from './native-surface-store'
import { playRpc } from './play-store'
import { TournamentSurface } from './tournament-surface'
import { VoyageSurface } from './voyage-surface'
import { WordsSurface } from './words-surface'

const WORDS = ['SOLAR', 'QUEST', 'LEARN', 'BRAIN', 'STUDY', 'LOGIC', 'WORDS', 'FOCUS'] as const

const GROUPS = [
  { label: 'Planets', words: ['MARS', 'VENUS', 'EARTH', 'SATURN'] },
  { label: 'Study actions', words: ['READ', 'RECALL', 'REVIEW', 'REPEAT'] },
  { label: 'Quiz modes', words: ['DAILY', 'SPEED', 'SOLO', 'PARTY'] },
  { label: 'Knowledge', words: ['FACT', 'IDEA', 'SKILL', 'THEORY'] }
] as const

const VOYAGE_PLANETS = ['trivia', 'memory', 'wordblock', 'picture', 'search', 'premium'] as const

const VOYAGE_CHALLENGES = {
  trivia: { answer: 'JUPITER', hint: 'The largest planet.', prompt: 'Which planet has the Great Red Spot?' },
  memory: { answer: '3142', hint: 'The sequence starts with 3.', prompt: 'Memorize and enter: 3 · 1 · 4 · 2' },
  wordblock: { answer: 'ORBIT', hint: 'A path around a planet.', prompt: 'Unscramble: T B I O R' },
  picture: { answer: 'SATURN', hint: 'Its rings are visible.', prompt: 'Name the planet: 🪐' },
  search: { answer: 'COMET', hint: 'An icy visitor with a tail.', prompt: 'Find the space word in: X C O M E T Z' },
  premium: {
    answer: '5',
    hint: 'Count the filled squares.',
    prompt: 'Solve 1-3-1 rows: ■ □ □ / ■ ■ ■ / □ □ ■. How many filled?'
  }
} as const

interface ProtocolState {
  data?: unknown
  error?: string
  loading: boolean
}

function protocolRpc(route: NativeRouteContract): null | { name: string; payload: Record<string, unknown> } {
  const name = route.protocol?.split(' ')[0]

  if (
    !name ||
    name.startsWith('/') ||
    name === 'GET' ||
    name === 'POST' ||
    name === 'GET/POST' ||
    name === 'Nakama' ||
    name.includes('/')
  ) {
    return null
  }

  const payload: Record<string, unknown> = {}

  if (name === 'tournament_get') {
    payload.slug = 'featured'
  }

  if (name === 'learning_track_get') {
    payload.track_id = 'featured'
  }

  if (name === 'get_leaderboard') {
    Object.assign(payload, { game_id: 'quizverse', limit: 10, scope: 'global' })
  }

  return { name, payload }
}

function productReadPath(route: NativeRouteContract): null | string {
  const match = route.protocol?.match(/^GET (\/api\/ai\/[^\s:*]+(?:\/[^\s:*]+)*)$/)

  return match?.[1]?.replace(/^\/api\/ai/, '') ?? null
}

function ProtocolPanel({ route }: { route: NativeRouteContract }) {
  const [state, setState] = useState<ProtocolState>({ loading: false })
  const rpc = protocolRpc(route)
  const apiPath = productReadPath(route)

  const runRead = async () => {
    if ((!rpc && !apiPath) || route.write) {
      return
    }

    setState({ loading: true })

    try {
      const data = rpc
        ? await playRpc(rpc.name, rpc.payload)
        : (await productRequest<unknown>({ method: 'GET', path: apiPath! })).data

      setState({ data, loading: false })
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : String(error), loading: false })
    }
  }

  return (
    <section aria-label="Native client protocol" className="qv-glass-tile rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Native client protocol</h3>
        {route.protocol && <code className="rounded bg-black/25 px-2 py-1 text-[0.65rem]">{route.protocol}</code>}
        {route.write && (
          <span className="rounded bg-amber-500/20 px-2 py-1 text-[0.65rem] text-amber-100">Confirmation required</span>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {route.write
          ? 'Production mutation is disabled in this preview. The client contract is present and keeps retries idempotent.'
          : route.protocol
            ? 'This read uses the main-process authenticated proxy; credentials never enter renderer storage.'
            : 'This route runs locally and remains available offline.'}
      </p>
      {(rpc || apiPath) && !route.write && (
        <Button className="mt-3" disabled={state.loading} onClick={() => void runRead()} size="sm" variant="secondary">
          {state.loading ? 'Loading…' : 'Load safe read'}
        </Button>
      )}
      {state.error && (
        <p className="mt-3 rounded bg-red-950/50 p-2 text-xs text-red-100" role="alert">
          {state.error}
        </p>
      )}
      {state.data !== undefined && (
        <pre className="mt-3 max-h-40 overflow-auto rounded bg-black/25 p-2 text-[0.65rem]">
          {JSON.stringify(state.data, null, 2)}
        </pre>
      )}
    </section>
  )
}

function DailyWord({ content }: { content: WordsDailyEnvelope }) {
  const selected = WORDS[content.seed % WORDS.length]!
  const [guess, setGuess] = useState('')
  const [guesses, setGuesses] = useState<string[]>([])
  const complete = guesses.includes(selected)

  const submit = () => {
    const normalized = guess.trim().toUpperCase()

    if (normalized.length !== selected.length || guesses.length >= 6 || complete) {
      return
    }

    setGuesses(current => [...current, normalized])
    setGuess('')

    if (normalized === selected) {
      completeStreakDay({ kind: 'words', mode: 'daily', skin: 'general' })
    }
  }

  return (
    <section className="qv-glass-tile rounded-xl p-4">
      <h3 className="text-sm font-semibold">UTC daily word · {content.utc_day}</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {content.server_decided ? 'Server-authoritative seed' : `Offline seed · ${content.degraded ?? 'local'}`}
      </p>
      <div aria-label="Daily word attempts" className="mt-3 grid max-w-64 gap-1">
        {Array.from({ length: 6 }, (_, row) => (
          <div className="grid grid-cols-5 gap-1" key={row}>
            {Array.from({ length: 5 }, (__, column) => {
              const letter = guesses[row]?.[column] ?? ''
              const exact = letter && letter === selected[column]
              const present = letter && selected.includes(letter)

              return (
                <span
                  aria-label={letter ? `${letter}, ${exact ? 'correct' : present ? 'present' : 'absent'}` : 'empty'}
                  className={cn(
                    'grid aspect-square place-items-center rounded border text-sm font-bold',
                    exact ? 'bg-emerald-700' : present ? 'bg-amber-700' : 'bg-black/20'
                  )}
                  key={column}
                >
                  {letter}
                </span>
              )
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex max-w-sm gap-2">
        <input
          aria-label="Five-letter guess"
          className="min-w-0 flex-1 rounded border px-3 py-2 text-sm uppercase"
          disabled={complete || guesses.length >= 6}
          maxLength={5}
          onChange={event => setGuess(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              submit()
            }
          }}
          value={guess}
        />
        <Button disabled={guess.trim().length !== 5 || complete} onClick={submit} size="sm">
          Guess
        </Button>
      </div>
      {complete && (
        <p className="mt-3 text-sm text-emerald-200" role="status">
          Solved in {guesses.length} attempts. Streak saved locally.
        </p>
      )}
    </section>
  )
}

function GroupsGame({ content }: { content: WordsDailyEnvelope }) {
  const puzzle = GROUPS

  const shuffled = useMemo(
    () =>
      seededShuffle(
        puzzle.flatMap(group => group.words),
        content.seed
      ),
    [content.seed, puzzle]
  )

  const [selected, setSelected] = useState<string[]>([])
  const [solved, setSolved] = useState<string[]>([])
  const [message, setMessage] = useState('')

  const check = () => {
    const match = puzzle.find(group => group.words.every(word => selected.includes(word)))

    if (!match) {
      setMessage('Those words do not form a complete group.')

      return
    }

    setSolved(current => [...current, match.label])
    setSelected([])
    setMessage(`${match.label} solved.`)

    if (solved.length === puzzle.length - 1) {
      completeStreakDay({ kind: 'words', mode: 'groups', skin: 'general' })
    }
  }

  return (
    <section className="qv-glass-tile rounded-xl p-4">
      <h3 className="text-sm font-semibold">Find four connected words</h3>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {shuffled.map(word => {
          const group = puzzle.find(item => item.words.includes(word as never))!
          const done = solved.includes(group.label)

          return (
            <button
              aria-pressed={selected.includes(word)}
              className={cn(
                'rounded border p-2 text-xs font-semibold',
                done ? 'bg-emerald-900/60' : selected.includes(word) ? 'bg-violet-700' : 'bg-black/20'
              )}
              disabled={done}
              key={word}
              onClick={() =>
                setSelected(current =>
                  current.includes(word)
                    ? current.filter(item => item !== word)
                    : current.length < 4
                      ? [...current, word]
                      : current
                )
              }
              type="button"
            >
              {word}
            </button>
          )
        })}
      </div>
      <Button className="mt-3" disabled={selected.length !== 4} onClick={check} size="sm">
        Check group
      </Button>
      {message && (
        <p className="mt-2 text-xs" role="status">
          {message}
        </p>
      )}
    </section>
  )
}

function AuthoritativeWordsRoute({ mode }: { mode: Extract<WordsMode, 'daily' | 'groups'> }) {
  const [content, setContent] = useState(() => fallbackWordsDaily(mode, 'general'))

  useEffect(() => {
    let active = true
    void loadWordsDaily(mode, 'general').then(next => {
      if (active) {
        setContent(next)
      }
    })

    return () => {
      active = false
    }
  }, [mode])

  return mode === 'daily' ? <DailyWord content={content} /> : <GroupsGame content={content} />
}

function VoyageRoute({ route }: { route: string }) {
  const today = new Date().toISOString().slice(0, 10)
  const storageKey = `quizverse_voyage_progress_v2:${today}`

  const [progress, setProgress] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    } catch {
      return []
    }
  })

  const planet = VOYAGE_PLANETS.find(item => item === route) ?? null
  const [answer, setAnswer] = useState('')
  const [message, setMessage] = useState('')
  const [tier, setTier] = useState<VoyageTier>(FALLBACK_VOYAGE_TIER)
  const [hintUsed, setHintUsed] = useState(false)

  useEffect(() => {
    let active = true
    void loadVoyageTier()
      .then(next => {
        if (active) {
          setTier(next)
        }
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [])

  const submit = () => {
    if (!planet || progress.includes(planet)) {
      return
    }

    const challenge = VOYAGE_CHALLENGES[planet]

    if (answer.trim().toUpperCase() !== challenge.answer) {
      setMessage('Not quite. Try again or use a hint.')

      return
    }

    const next = [...progress, planet]
    localStorage.setItem(storageKey, JSON.stringify(next))
    setProgress(next)
    setAnswer('')
    setMessage('Planet complete.')
    completeStreakDay({ kind: 'voyage' })
  }

  return (
    <section className="qv-glass-tile rounded-xl p-4">
      <h3 className="text-sm font-semibold">
        {planet ? `${planet[0]!.toUpperCase()}${planet.slice(1)} planet` : 'Today’s six-planet voyage'}
      </h3>
      <p className="mt-2 text-xs text-muted-foreground">
        {progress.length}/6 planets complete · T{tier.tier} policy
        {tier.policy.cooldown_secs ? ` · ${tier.policy.cooldown_secs}s cooldown` : ''}.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {VOYAGE_PLANETS.map(item => (
          <Button
            key={item}
            onClick={() => openNativeSurface('voyage', item)}
            size="sm"
            variant={progress.includes(item) ? 'secondary' : 'outline'}
          >
            {progress.includes(item) ? '✓ ' : ''}
            {item}
          </Button>
        ))}
      </div>
      {planet && (
        <div className="mt-4 max-w-lg rounded border border-(--qv-border) p-3">
          {planet === 'premium' && tier.policy.premium_planet_ads_required > 0 ? (
            <p className="text-sm" role="status">
              Nonogram is a Voyage Pass planet. Configure or restore a premium entitlement to play.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium">{VOYAGE_CHALLENGES[planet].prompt}</p>
              {hintUsed && <p className="mt-2 text-xs text-amber-200">{VOYAGE_CHALLENGES[planet].hint}</p>}
              <div className="mt-3 flex gap-2">
                <input
                  aria-label={`${planet} answer`}
                  className="min-w-0 flex-1 rounded border px-3 py-2 text-sm"
                  disabled={progress.includes(planet)}
                  onChange={event => setAnswer(event.target.value)}
                  value={answer}
                />
                <Button disabled={progress.includes(planet) || !answer.trim()} onClick={submit} size="sm">
                  Check
                </Button>
                <Button
                  disabled={hintUsed || tier.policy.free_hints_per_day < 1}
                  onClick={() => setHintUsed(true)}
                  size="sm"
                  variant="outline"
                >
                  Hint
                </Button>
              </div>
              {message && (
                <p className="mt-2 text-xs" role="status">
                  {message}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function OnboardingRoute({ route }: { route: string }) {
  const stages = ['intent', 'pathway', 'quiz', 'brain-code', 'account', 'plan', 'complete']
  const index = Math.max(0, stages.indexOf(route))
  const [choice, setChoice] = useState('')

  return (
    <section className="qv-glass-tile rounded-xl p-4">
      <p className="text-xs text-muted-foreground">
        Step {index + 1} of {stages.length}
      </p>
      <h3 className="mt-1 text-sm font-semibold">{route.replace('-', ' ')}</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {['Learn faster', 'Prepare for an exam', 'Explore daily'].map(item => (
          <Button
            key={item}
            onClick={() => setChoice(item)}
            size="sm"
            variant={choice === item ? 'default' : 'outline'}
          >
            {item}
          </Button>
        ))}
      </div>
      <Button
        className="mt-4"
        disabled={!choice}
        onClick={() => {
          const next = stages[index + 1]

          if (next) {
            openNativeSurface('onboarding', next)
          } else {
            localStorage.setItem('quizverse_onboarding_complete_v1', 'true')
          }
        }}
        size="sm"
      >
        {index === stages.length - 1 ? 'Complete setup' : 'Continue'}
      </Button>
    </section>
  )
}

function VoiceRoute({ route }: { route: string }) {
  const [permission, setPermission] = useState<'denied' | 'granted' | 'idle'>('idle')

  if (route !== 'audio') {
    return null
  }

  return (
    <section className="qv-glass-tile rounded-xl p-4">
      <h3 className="text-sm font-semibold">Microphone and LiveKit adapter</h3>
      <p className="mt-2 text-xs text-muted-foreground">
        Audio capture is native. Starting a remote room requires AI Voice and LiveKit infrastructure.
      </p>
      <Button
        className="mt-3"
        onClick={() =>
          void window.hermesDesktop.requestMicrophoneAccess().then(ok => setPermission(ok ? 'granted' : 'denied'))
        }
        size="sm"
      >
        Check microphone permission
      </Button>
      {permission !== 'idle' && (
        <p className="mt-2 text-xs" role="status">
          Microphone permission: {permission}
        </p>
      )}
    </section>
  )
}

function RouteExperience({ route, surface }: { route: NativeRouteContract; surface: NativeSurfaceId }) {
  if (surface === 'words') {
    return <WordsSurface route={route.id} />
  }

  if (surface === 'voyage') {
    return <VoyageSurface route={route.id} />
  }

  if (surface === 'tournaments') {
    return <TournamentSurface route={route.id} />
  }

  if (surface === 'link-play') {
    return <LinkPlaySurface route={route.id} />
  }

  if (surface === 'onboarding') {
    return <OnboardingRoute route={route.id} />
  }

  if (surface === 'voice') {
    return <VoiceRoute route={route.id} />
  }

  return <UnavailableRoute route={route} />
}

function UnavailableRoute({ route }: { route: NativeRouteContract }) {
  return (
    <section className="qv-glass-tile rounded-xl p-4">
      <h3 className="text-sm font-semibold">{route.id.replaceAll('-', ' ')}</h3>
      <p className="mt-2 text-xs text-muted-foreground">{route.description}</p>
      <p className="mt-3 rounded border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-100" role="status">
        This source flow is not implemented in the signed-off Words/Voyage milestone. No generic interaction or hosted
        fallback is available.
      </p>
    </section>
  )
}

export function NativeSurfaceRouter({ onBack }: { onBack: () => void }) {
  const location = useStore($nativeSurfaceLocation)
  const surface = nativeSurface(location.surface)
  const route = surface.routes.find(item => item.id === location.route) ?? surface.routes[0]!
  const streak = useStore($nativeStreak)

  return (
    <div className="bg-quizverse-mesh flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-(--ui-border-primary) px-3 py-2">
        <Button onClick={onBack} size="xs" variant="ghost">
          <Codicon name="arrow-left" size="0.75rem" />
          Arcade
        </Button>
        <img alt="" className="size-6 rounded" src={`${import.meta.env.BASE_URL}${surface.icon}`} />
        <h2 className="text-sm font-semibold">{surface.label}</h2>
        <span className="ml-auto text-xs text-muted-foreground">🔥 {streak.current} day streak</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          aria-label={`${surface.label} routes`}
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-(--ui-border-primary) p-2 md:w-48 md:flex-col md:border-b-0 md:border-r"
        >
          {surface.routes.map(item => (
            <button
              aria-current={item.id === route.id ? 'page' : undefined}
              className={cn(
                'shrink-0 rounded px-3 py-2 text-left text-xs',
                item.id === route.id ? 'bg-violet-700 text-white' : 'hover:bg-white/10'
              )}
              key={item.id}
              onClick={() => openNativeSurface(surface.id, item.id)}
              type="button"
            >
              {item.id.replaceAll('-', ' ')}
            </button>
          ))}
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto grid max-w-4xl gap-4">
            <div>
              <p className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{surface.auth} access</p>
              <h2 className="text-lg font-semibold">{route.id.replaceAll('-', ' ')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{route.description}</p>
            </div>
            <RouteExperience route={route} surface={surface.id} />
            <ProtocolPanel route={route} />
          </div>
        </main>
      </div>
    </div>
  )
}
