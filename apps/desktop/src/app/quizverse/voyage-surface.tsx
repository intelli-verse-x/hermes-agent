import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import {
  FALLBACK_VOYAGE_TIER,
  loadVoyageTier,
  type VoyageTier
} from './engines/authoritative-content'
import { seededShuffle, utcDay } from './engines/daily-content'
import { hasActiveEntitlement } from './engines/entitlements'
import {
  buildWordSearch,
  VOYAGE_THEMES,
  voyageSeed,
  voyageTheme
} from './engines/native-game-content'
import { productRequest } from './engines/product-client'
import { completeStreakDay } from './engines/streak-store'
import { reusableVoyageCheckoutAttempt, type VoyageCheckoutAttempt } from './engines/voyage-checkout'
import { openNativeSurface } from './native-surface-store'
import { ensurePlaySession, playRpc } from './play-store'

const PLANETS = ['trivia', 'memory', 'wordblock', 'picture', 'search', 'premium'] as const
type Planet = typeof PLANETS[number]

interface VoyageProgress {
  completed: Planet[]
  cooldowns: Partial<Record<Planet, number>>
  hintsUsed: number
  scores: Partial<Record<Planet, number>>
}

const EMPTY_PROGRESS: VoyageProgress = { completed: [], cooldowns: {}, hintsUsed: 0, scores: {} }
const CHECKOUT_ATTEMPT_KEY = 'qv_voyage_checkout_attempt_v2'

function progressKey() {
  return `qv_voyage_progress_v3:${utcDay()}`
}

function readProgress(): VoyageProgress {
  try {
    const value = JSON.parse(localStorage.getItem(progressKey()) ?? '') as VoyageProgress

    if (Array.isArray(value.completed) && value.cooldowns && value.scores) {return value}
  } catch {
    // Damaged progress starts a fresh UTC voyage.
  }

  return EMPTY_PROGRESS
}

function useUtcDay() {
  const [day, setDay] = useState(utcDay)

  useEffect(() => {
    const now = new Date()
    const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    const timer = window.setTimeout(() => setDay(utcDay()), Math.max(1, nextMidnight - now.getTime() + 50))

    return () => window.clearTimeout(timer)
  }, [day])

  return day
}

function usePlanetValue<T>(planet: Planet, name: string, fallback: T) {
  const key = `qv_voyage_planet_v1:${utcDay()}:${planet}:${name}`

  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)

      return stored === null ? fallback : JSON.parse(stored) as T
    } catch {
      return fallback
    }
  })

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])

  return [value, setValue] as const
}

export function VoyageSurface({ route }: { route: string }) {
  const day = useUtcDay()
  const [progress, setProgress] = useState(readProgress)
  const [tier, setTier] = useState<VoyageTier>(FALLBACK_VOYAGE_TIER)
  const [premium, setPremium] = useState(false)
  const [entitlementStatus, setEntitlementStatus] = useState('Checking entitlement…')

  useEffect(() => {
    let active = true
    void loadVoyageTier().then(value => { if (active) {setTier(value)} })
    void playRpc('quizverse_get_entitlements', {}).then(value => {
      if (!active) {return}
      const entitled = hasActiveEntitlement(value, 'qv_voyage_pass')
      setPremium(entitled)
      setEntitlementStatus(entitled ? 'Voyage Pass active' : 'Voyage Pass not found')
    }).catch(error => {
      if (active) {setEntitlementStatus(`Entitlement unavailable: ${error instanceof Error ? error.message : String(error)}`)}
    })

    return () => { active = false }
  }, [])

  useEffect(() => {
    setProgress(readProgress())
  }, [day])

  const save = (next: VoyageProgress) => {
    localStorage.setItem(progressKey(), JSON.stringify(next))
    setProgress(next)
  }

  const reset = () => {
    const prefix = `qv_voyage_planet_v1:${day}:`

    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)

      if (key?.startsWith(prefix)) {
        localStorage.removeItem(key)
      }
    }

    localStorage.removeItem(progressKey())
    setProgress(EMPTY_PROGRESS)
  }

  const complete = (planet: Planet, score: number) => {
    if (progress.completed.includes(planet)) {return}
    const index = PLANETS.indexOf(planet)
    const nextPlanet = PLANETS[index + 1]

    const next = {
      ...progress,
      completed: [...progress.completed, planet],
      cooldowns: nextPlanet && !premium && tier.policy.cooldown_secs > 0
        ? { ...progress.cooldowns, [nextPlanet]: Date.now() + tier.policy.cooldown_secs * 1000 }
        : progress.cooldowns,
      scores: { ...progress.scores, [planet]: score }
    }

    save(next)

    if (next.completed.length === PLANETS.length) {completeStreakDay({ kind: 'voyage' })}
  }

  if (route === 'hub') {
    return <VoyageHub onReset={reset} premium={premium} progress={progress} tier={tier} />
  }

  if (route === 'pass') {
    return <VoyagePass
      onEntitlement={() => {
        setPremium(true)
        setEntitlementStatus('Voyage Pass active')
      }}
      status={entitlementStatus}
      tier={tier}
    />
  }

  const planet = PLANETS.find(item => item === route)

  if (!planet) {return <ErrorCard message="This Voyage route has no source mini-game." />}
  const index = PLANETS.indexOf(planet)

  if (index > 0 && !progress.completed.includes(PLANETS[index - 1]!)) {
    return <ErrorCard message={`Finish ${PLANETS[index - 1]} before entering this planet.`} />
  }

  const cooldown = progress.cooldowns[planet] ?? 0

  if (!premium && cooldown > Date.now()) {
    return (
      <CooldownCard
        endsAt={cooldown}
        onElapsed={() => save({ ...progress, cooldowns: { ...progress.cooldowns, [planet]: 0 } })}
      />
    )
  }

  if (progress.completed.includes(planet)) {
    return <CompletionCard planet={planet} progress={progress} />
  }

  const common = { onComplete: (score: number) => complete(planet, score) }

  if (planet === 'trivia') {return <TriviaPlanet {...common} key={day} />}

  if (planet === 'memory') {return <MemoryPlanet {...common} key={day} />}

  if (planet === 'wordblock') {return <WordBlockPlanet {...common} hints={tier.policy.free_hints_per_day - progress.hintsUsed} key={day} onHint={() => save({ ...progress, hintsUsed: progress.hintsUsed + 1 })} />}

  if (planet === 'picture') {return <PicturePlanet {...common} key={day} />}

  if (planet === 'search') {return <SearchPlanet {...common} hints={tier.policy.free_hints_per_day - progress.hintsUsed} key={day} onHint={() => save({ ...progress, hintsUsed: progress.hintsUsed + 1 })} />}

  return <TileMatchPlanet {...common} allowed={premium || tier.policy.premium_planet_ads_required === 0} key={day} />
}

function VoyageHub({ onReset, premium, progress, tier }: {
  onReset: () => void
  premium: boolean
  progress: VoyageProgress
  tier: VoyageTier
}) {
  return (
    <Card title="Today’s Voyage">
      <p className="text-xs text-muted-foreground">
        {progress.completed.length}/6 planets · T{tier.tier} policy · {tier.debug?.source ?? 'authoritative'} provenance
      </p>
      <p className="mt-2 text-xs">
        {premium ? 'Voyage Pass active: travel cooldowns removed.' : `${tier.policy.free_hints_per_day} free hints · ${tier.policy.cooldown_secs}s travel cooldown.`}
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {PLANETS.map((planet, index) => {
          const previous = PLANETS[index - 1]
          const complete = progress.completed.includes(planet)
          const locked = Boolean(previous && !progress.completed.includes(previous))
          const traveling = (progress.cooldowns[planet] ?? 0) > Date.now()

          return (
            <button
              className={cn('rounded border p-3 text-left', complete ? 'bg-emerald-900/40' : locked ? 'opacity-50' : 'bg-black/20')}
              disabled={locked || complete}
              key={planet}
              onClick={() => openNativeSurface('voyage', planet)}
              type="button"
            >
              <b>{index + 1}. {planet === 'premium' ? 'Premium Tile Match' : planet}</b>
              <span className="mt-1 block text-xs">{complete ? `Complete · ${progress.scores[planet] ?? 0} points` : traveling ? 'Ship traveling' : locked ? `Finish ${previous} first` : 'Begin or resume'}</span>
            </button>
          )
        })}
      </div>
      {progress.completed.length === 6 && <VoyageSummary progress={progress} />}
      <Button className="mt-4" onClick={onReset} variant="outline">Restart today’s Voyage</Button>
    </Card>
  )
}

function TriviaPlanet({ onComplete }: { onComplete: (score: number) => void }) {
  const theme = voyageTheme()
  const questions = useMemo(() => seededShuffle(theme.trivia, voyageSeed('trivia')).slice(0, 10), [theme])
  const [index, setIndex] = usePlanetValue('trivia', 'index', 0)
  const [score, setScore] = usePlanetValue('trivia', 'score', 0)
  const question = questions[index]
  useEffect(() => {
    if (index >= questions.length) {onComplete(Math.round(score / questions.length * 10))}
  }, [index, onComplete, questions.length, score])

  if (!question) {return <Card title="Trivia complete"><p className="mt-2 text-sm">Banking {score}/{questions.length} correct answers…</p></Card>}

  return (
    <Card title="Trivia Planet">
      <p className="text-xs">Question {index + 1}/{questions.length}</p>
      <p className="mt-3 font-semibold">{question.prompt}</p>
      <div className="mt-3 grid gap-2">
        {question.options.map((option, optionIndex) => <Button key={option} onClick={() => {
          if (optionIndex === question.correctIndex) {setScore(value => value + 1)}
          setIndex(value => value + 1)
        }} variant="outline">{option}</Button>)}
      </div>
    </Card>
  )
}

function MemoryPlanet({ onComplete }: { onComplete: (score: number) => void }) {
  const icons = voyageTheme().icons.slice(0, 8)
  const deck = useMemo(() => seededShuffle([...icons, ...icons], voyageSeed('memory')), [icons])
  const [selected, setSelected] = useState<number[]>([])
  const [matched, setMatched] = usePlanetValue<number[]>('memory', 'matched', [])
  const [mistakes, setMistakes] = usePlanetValue('memory', 'mistakes', 0)

  const choose = (index: number) => {
    if (selected.length >= 2 || selected.includes(index) || matched.includes(index)) {return}

    if (selected.length === 0) { setSelected([index]);

 return }

    const first = selected[0]!

    if (deck[first] === deck[index]) {
      const next = [...matched, first, index]
      setMatched(next)
      setSelected([])

      if (next.length === deck.length) {onComplete(mistakes <= 4 ? 20 : mistakes <= 8 ? 15 : 10)}
    } else {
      setSelected([first, index])
      setMistakes(value => value + 1)
      window.setTimeout(() => setSelected([]), 600)
    }
  }

  return (
    <Card title="Memory Match">
      <p className="text-xs">Pairs {matched.length / 2}/{icons.length} · mistakes {mistakes}</p>
      <div className="mt-3 grid max-w-md grid-cols-4 gap-2">
        {deck.map((icon, index) => (
          <button
            aria-label={matched.includes(index) || selected.includes(index) ? icon : `Hidden card ${index + 1}`}
            className="aspect-square rounded border bg-black/20 text-2xl"
            disabled={matched.includes(index)}
            key={index}
            onClick={() => choose(index)}
            type="button"
          >
            {matched.includes(index) || selected.includes(index) ? icon : '?'}
          </button>
        ))}
      </div>
    </Card>
  )
}

function WordBlockPlanet({ hints, onComplete, onHint }: {
  hints: number
  onComplete: (score: number) => void
  onHint: () => void
}) {
  const targets = voyageTheme().wordTargets
  const [index, setIndex] = usePlanetValue('wordblock', 'index', 0)

  const pool = useMemo(() => seededShuffle(targets.flatMap((word, wordIndex) => [...word].map((letter, letterIndex) => ({
    id: `${wordIndex}:${letterIndex}`,
    letter
  }))), voyageSeed('wordblock:shared-pool')), [targets])

  const [used, setUsed] = usePlanetValue<string[]>('wordblock', 'used', [])
  const [selected, setSelected] = useState<string[]>([])
  const [score, setScore] = usePlanetValue('wordblock', 'score', 0)
  const [message, setMessage] = useState('')
  const target = targets[index]
  useEffect(() => {
    if (index >= targets.length) {onComplete(Math.round(score / targets.length * 30))}
  }, [index, onComplete, score, targets.length])

  if (!target) {return <Card title="Word Block complete"><p className="mt-2 text-sm">Banking {score}/{targets.length} solved words…</p></Card>}
  const answer = selected.map(id => pool.find(tile => tile.id === id)?.letter ?? '').join('')

  const submit = () => {
    if (answer.toUpperCase() !== target) { setMessage('That does not form today’s target.');

 return }

    setScore(value => value + 1)
    setUsed(value => [...value, ...selected])
    setIndex(value => value + 1)
    setSelected([])
    setMessage('')
  }

  return (
    <Card title="Word Block">
      <p className="text-xs">Build target {index + 1}/{targets.length}</p>
      <p className="mt-2 text-xs text-muted-foreground">One shared tile pool powers every word. Solved tiles stay consumed.</p>
      <div aria-label="Shared Word Block tile pool" className="mt-3 flex flex-wrap gap-2">{pool.map(tile => <Button disabled={used.includes(tile.id) || selected.includes(tile.id)} key={tile.id} onClick={() => setSelected(value => [...value, tile.id])} variant="outline">{tile.letter}</Button>)}</div>
      <output aria-label="Word Block answer" className="mt-3 block min-h-10 w-full rounded border px-3 py-2 uppercase">{answer}</output>
      <div className="mt-3 flex gap-2">
        <Button disabled={!answer} onClick={submit}>Submit word</Button>
        <Button disabled={hints <= 0} onClick={() => { onHint(); setMessage(`First letter: ${target[0]}`) }} variant="outline">Hint ({Math.max(0, hints)})</Button>
        <Button onClick={() => setSelected([])} variant="outline">Clear</Button>
      </div>
      <Status message={message} />
    </Card>
  )
}

function PicturePlanet({ onComplete }: { onComplete: (score: number) => void }) {
  const pictures = voyageTheme().pictures
  const allLabels = useMemo(() => VOYAGE_THEMES.flatMap(theme => theme.pictures.map(picture => picture.label)), [])
  const [index, setIndex] = usePlanetValue('picture', 'index', 0)
  const [peeled, setPeeled] = usePlanetValue('picture', 'peeled', 4)
  const [score, setScore] = usePlanetValue('picture', 'score', 0)
  const picture = pictures[index]
  useEffect(() => {
    if (index >= pictures.length) {onComplete(Math.round(score / pictures.length * 40))}
  }, [index, onComplete, pictures.length, score])

  useEffect(() => {
    if (!picture || peeled >= 16) {return}
    const timer = window.setTimeout(() => setPeeled(value => Math.min(16, value + 1)), 3_000)

    return () => window.clearTimeout(timer)
  }, [index, peeled, picture, setPeeled])

  if (!picture) {return <Card title="Picture complete"><p className="mt-2 text-sm">Banking {score}/{pictures.length} correct pictures…</p></Card>}
  const distractors = seededShuffle(allLabels.filter(label => label !== picture.label), voyageSeed(`picture-options:${index}`)).slice(0, 3)
  const options = seededShuffle([picture.label, ...distractors], voyageSeed(`picture:${index}`))

  return (
    <Card title="Guess the Picture">
      <p className="text-xs">Picture {index + 1}/{pictures.length} · {peeled}/16 tiles peeled</p>
      <div className="relative mt-3 grid size-48 place-items-center overflow-hidden rounded border text-7xl">
        {picture.emoji}
        <div className="absolute inset-0 grid grid-cols-4">
          {Array.from({ length: 16 }, (_, tile) => <span className={tile < peeled ? 'bg-transparent' : 'border border-black/10 bg-slate-700'} key={tile} />)}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {options.map(option => <Button key={option} onClick={() => {
          if (option === picture.label) {setScore(value => value + 1)}
          setIndex(value => value + 1)
          setPeeled(4)
        }} variant="outline">{option}</Button>)}
      </div>
      <Button className="mt-2" onClick={() => setPeeled(value => Math.min(16, value + 4))} variant="outline">Peel four tiles</Button>
    </Card>
  )
}

function SearchPlanet({ hints, onComplete, onHint }: {
  hints: number
  onComplete: (score: number) => void
  onHint: () => void
}) {
  const words = voyageTheme().words
  const puzzle = useMemo(() => buildWordSearch(words, voyageSeed('search')), [words])
  const [start, setStart] = useState<null | [number, number]>(null)
  const [found, setFound] = usePlanetValue<string[]>('search', 'found', [])
  const [hintCell, setHintCell] = useState('')

  const choose = (row: number, column: number) => {
    if (!start) { setStart([row, column]);

 return }

    const [sr, sc] = start
    const dr = Math.sign(row - sr)
    const dc = Math.sign(column - sc)
    const steps = Math.max(Math.abs(row - sr), Math.abs(column - sc))

    if ((row !== sr && column !== sc && Math.abs(row - sr) !== Math.abs(column - sc)) || steps < 2) {
      setStart(null)

      return
    }

    const selected = Array.from({ length: steps + 1 }, (_, index) => puzzle.grid[sr + dr * index]?.[sc + dc * index] ?? '').join('')
    const reversed = [...selected].reverse().join('')
    const match = words.find(word => !found.includes(word) && (word === selected || word === reversed))
    setStart(null)

    if (!match) {return}
    const next = [...found, match]
    setFound(next)

    if (next.length === words.length) {onComplete(50)}
  }

  const remaining = puzzle.placements.find(item => !found.includes(item.word))

  return (
    <Card title="Word Search">
      <p className="text-xs">Select the first and last cell of each hidden word.</p>
      <div aria-label="Word Search grid" className="mt-3 grid max-w-md grid-cols-10 gap-px" role="grid">
        {puzzle.grid.flatMap((row, r) => row.map((letter, c) => {
          const key = `${r},${c}`
          const inFound = puzzle.placements.some(item => found.includes(item.word) && item.cells.some(([rr, cc]) => rr === r && cc === c))

          return <button aria-label={`Row ${r + 1} column ${c + 1}, ${letter}`} className={cn('aspect-square min-w-0 rounded-sm text-[0.65rem] font-bold', inFound ? 'bg-emerald-700' : start?.[0] === r && start[1] === c ? 'bg-violet-700' : hintCell === key ? 'bg-amber-600' : 'bg-black/20')} key={key} onClick={() => choose(r, c)} type="button">{letter}</button>
        }))}
      </div>
      <div className="mt-3 flex flex-wrap gap-1">{words.map(word => <span className={cn('rounded px-2 py-1 text-xs', found.includes(word) ? 'bg-emerald-800 line-through' : 'bg-black/20')} key={word}>{word}</span>)}</div>
      <Button className="mt-3" disabled={hints <= 0 || !remaining} onClick={() => {
        onHint()
        const [row, column] = remaining!.cells[0]!
        setHintCell(`${row},${column}`)
      }} variant="outline">Reveal first letter ({Math.max(0, hints)})</Button>
    </Card>
  )
}

function TileMatchPlanet({ allowed, onComplete }: { allowed: boolean; onComplete: (score: number) => void }) {
  const icons = voyageTheme().icons.slice(0, 6)
  const deck = useMemo(() => seededShuffle([...icons, ...icons, ...icons], voyageSeed('premium')), [icons])
  const [tray, setTray] = useState<number[]>([])
  const [removed, setRemoved] = usePlanetValue<number[]>('premium', 'removed', [])

  if (!allowed) {return <ErrorCard message="Premium Tile Match requires a Voyage Pass or an authoritative zero-ad tier policy." />}

  const choose = (index: number) => {
    if (tray.includes(index) || removed.includes(index)) {return}
    const nextTray = [...tray, index]
    const matching = nextTray.filter(tileIndex => deck[tileIndex] === deck[index])
    const completeSet = matching.length === 3
    const next = completeSet ? [...removed, ...matching] : removed
    setRemoved(next)
    setTray(completeSet ? nextTray.filter(tileIndex => !matching.includes(tileIndex)) : nextTray)

    if (next.length === deck.length) {onComplete(400)}
  }

  return (
    <Card title="Premium Tile Match">
      <p className="text-xs">Zen mode · collect three identical source tiles in the tray · no timer.</p>
      <div className="mt-3 grid max-w-lg grid-cols-6 gap-1">
        {deck.map((tile, index) => removed.includes(index)
          ? <span aria-hidden className="aspect-square" key={index} />
          : <button aria-label={`Tile ${index + 1}, ${tile}`} className={cn('aspect-square rounded border text-xl', tray.includes(index) && 'bg-violet-700')} disabled={tray.includes(index)} key={index} onClick={() => choose(index)} type="button">{tile}</button>)}
      </div>
      <p className="mt-2 text-xs">Tray: {tray.map(index => deck[index]).join(' ') || 'empty'}</p>
    </Card>
  )
}

function VoyagePass({ onEntitlement, status, tier }: { onEntitlement: () => void; status: string; tier: VoyageTier }) {
  const [acknowledged, setAcknowledged] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly')

  const refreshEntitlement = async () => {
    setBusy(true)

    try {
      const entitlements = await playRpc('quizverse_get_entitlements', {})

      if (!hasActiveEntitlement(entitlements, 'qv_voyage_pass')) {
        throw new Error('Voyage Pass is not active yet. Complete checkout, then try again.')
      }

      localStorage.removeItem(CHECKOUT_ATTEMPT_KEY)
      onEntitlement()
      setMessage('Voyage Pass restored from the authoritative entitlement service.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const checkout = async () => {
    setBusy(true)
    setMessage('')

    try {
      const session = await ensurePlaySession()
      let saved: VoyageCheckoutAttempt | null = null

      try {
        saved = JSON.parse(localStorage.getItem(CHECKOUT_ATTEMPT_KEY) ?? 'null') as VoyageCheckoutAttempt | null
      } catch {
        saved = null
      }

      const reusable = reusableVoyageCheckoutAttempt(saved, period, session.userId)

      const attempt: VoyageCheckoutAttempt = reusable ?? {
        checkoutAttemptId: crypto.randomUUID(),
        createdAt: Date.now(),
        period,
        userId: session.userId
      }

      localStorage.setItem(CHECKOUT_ATTEMPT_KEY, JSON.stringify(attempt))

      const { data } = await productRequest<Record<string, unknown>>({
        body: {
          checkoutAttemptId: attempt.checkoutAttemptId,
          plan: period,
          surface: 'voyage',
          userId: session.userId
        },
        method: 'POST',
        path: '/api/stripe/voyage/checkout'
      })

      const checkoutUrl = String(data.checkout_url ?? data.url ?? '')
      const parsed = new URL(checkoutUrl)

      if (parsed.protocol !== 'https:' || parsed.hostname !== 'checkout.stripe.com') {
        throw new Error('Checkout service returned a non-Stripe URL.')
      }

      await window.hermesDesktop.openExternal(checkoutUrl)
      setMessage('Stripe Checkout opened in your system browser. After payment, return here and refresh your pass.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Voyage Pass">
      <p className="text-sm">{status}</p>
      <p className="mt-2 text-xs">{tier.policy.voyage_pass_monthly_display}/month · {tier.policy.voyage_pass_yearly_display}/year · removes cooldowns and restores entitlement across devices.</p>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => setPeriod('monthly')} size="sm" variant={period === 'monthly' ? 'default' : 'outline'}>Monthly</Button>
        <Button onClick={() => setPeriod('yearly')} size="sm" variant={period === 'yearly' ? 'default' : 'outline'}>Yearly</Button>
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs">
        <input checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} type="checkbox" />
        I understand checkout is a production purchase.
      </label>
      <Button
        className="mt-3"
        disabled={!acknowledged || busy}
        onClick={() => void checkout()}
      >
        {busy ? 'Checking…' : 'Continue to Stripe Checkout'}
      </Button>
      <Button className="ml-2 mt-3" disabled={busy} onClick={() => void refreshEntitlement()} variant="outline">
        Refresh pass
      </Button>
      <p className="mt-2 text-xs text-amber-200">Checkout uses the system browser. A signed server session and matching one-time state are required before entitlements refresh.</p>
      <Status message={message} />
    </Card>
  )
}

function VoyageSummary({ progress }: { progress: VoyageProgress }) {
  const total = Object.values(progress.scores).reduce((sum, score) => sum + (score ?? 0), 0)

  return <p className="mt-4 rounded bg-emerald-900/40 p-3 text-sm" role="status">Voyage complete · {total} coins · streak saved · resets at UTC midnight.</p>
}

function CompletionCard({ planet, progress }: { planet: Planet; progress: VoyageProgress }) {
  return <Card title={`${planet} complete`}><p className="text-sm">Score: {progress.scores[planet] ?? 0}. This planet resets at UTC midnight.</p><Button className="mt-3" onClick={() => openNativeSurface('voyage', 'hub')}>Return to map</Button></Card>
}

function CooldownCard({ endsAt, onElapsed }: { endsAt: number; onElapsed: () => void }) {
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)))

  useEffect(() => {
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))

      setSeconds(remaining)

      if (remaining === 0) {
        window.clearInterval(timer)
        onElapsed()
      }
    }, 250)

    return () => window.clearInterval(timer)
  }, [endsAt, onElapsed])

  return (
    <Card title="Ship traveling">
      <p className="text-sm">Next planet arrives in about {seconds} seconds.</p>
      <p className="mt-2 text-xs text-amber-200">
        Rewarded-ad cooldown skips are unavailable on Desktop; no ad is simulated and the authoritative cooldown remains enforced.
      </p>
    </Card>
  )
}

function ErrorCard({ message }: { message: string }) {
  return <Card title="Unavailable"><p className="text-sm text-amber-200" role="alert">{message}</p><Button className="mt-3" onClick={() => openNativeSurface('voyage', 'hub')}>Return to map</Button></Card>
}

function Card({ children, title }: { children: React.ReactNode; title: string }) {
  return <section className="qv-glass-tile rounded-xl p-4"><h3 className="text-sm font-semibold">{title}</h3>{children}</section>
}

function Status({ message }: { message: string }) {
  return message ? <p className="mt-3 rounded bg-black/20 p-2 text-xs" role="status">{message}</p> : null
}
