import { type ReactNode, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import {
  loadWordsDaily,
  type WordsDailyEnvelope,
  type WordsMode,
  type WordsSkin
} from './engines/authoritative-content'
import { seededShuffle, utcDay } from './engines/daily-content'
import { normalizeLeaderboard } from './engines/leaderboard'
import {
  CROSSWORD_PUZZLES,
  crosswordCleanSolveEligible,
  type CrosswordPuzzle,
  DAILY_WORDS,
  IMPOSTER_PUZZLES,
  imposterIndices,
  type ImposterPuzzle,
  imposterResult,
  isPangram,
  scoreWord,
  SPELL_PUZZLES,
  type SpellPuzzle,
  spellScore,
  validateSpellWord,
  WORD_GROUP_PUZZLES,
  type WordGroup,
  wordShareGrid
} from './engines/native-game-content'
import { completeStreakDay } from './engines/streak-store'
import { createSubmissionMachine } from './engines/submission-fsm'
import { loadWordsDictionary } from './engines/words-dictionary'
import { playRpc } from './play-store'

interface WordsRouteProps {
  route: string
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

function WordsContentLoader({
  children,
  mode,
  skin
}: {
  children: (content: WordsDailyEnvelope) => ReactNode
  mode: WordsMode
  skin: WordsSkin
}) {
  const day = useUtcDay()
  const [content, setContent] = useState<null | WordsDailyEnvelope>(null)

  useEffect(() => {
    let active = true
    setContent(null)
    void loadWordsDaily(mode, skin).then(result => {
      if (active && result.utc_day === day) {setContent(result)}
    })

    return () => { active = false }
  }, [day, mode, skin])

  return content
    ? <div key={`${content.utc_day}:${content.seed}`}>{children(content)}</div>
    : <p aria-live="polite" className="text-sm text-muted-foreground">Loading today’s verified puzzle…</p>
}

function gameStorage<T>(key: string, fallback: T): [T, (next: T) => void] {
  let initial = fallback

  try {
    initial = JSON.parse(localStorage.getItem(key) ?? '') as T
  } catch {
    // Start with source-derived content when storage is empty or damaged.
  }

  return [initial, next => localStorage.setItem(key, JSON.stringify(next))]
}

function Provenance({ content }: { content: WordsDailyEnvelope }) {
  return (
    <div className="text-xs text-muted-foreground">
      <p>
        {content.server_decided ? 'Server-authoritative daily seed' : `Deterministic offline seed · ${content.degraded ?? 'local'}`}
        {' · '}UTC {content.utc_day}
      </p>
      <p>
        Content: {content.content_source ?? 'offline-fallback'}
        {content.content_version ? ` · ${content.content_version}` : ''}
      </p>
      {content.content_provenance && <p>Source: {content.content_provenance} · License: {content.content_license}</p>}
      {content.content_error && (
        <p className="mt-2 rounded border border-amber-500/40 bg-amber-950/30 p-2 text-amber-100" role="status">
          Full Words banks are not configured or failed integrity validation: {content.content_error}. Using approved minimal original General fallback content{content.skin === 'gre-easy' ? '; this is not the full GRE bank' : ''}.
        </p>
      )}
    </div>
  )
}

function bankItems(value: unknown): unknown[] {
  if (Array.isArray(value)) {return value}

  if (value && typeof value === 'object') {
    const root = value as Record<string, unknown>
    const candidate = root.items ?? root.words ?? root.puzzles

    if (Array.isArray(candidate)) {return candidate}
  }

  return []
}

function DailyWord({ content }: { content: WordsDailyEnvelope }) {
  const distributed = bankItems(content.puzzle_bank).map(String).map(word => word.toUpperCase()).filter(word => /^[A-Z]{5}$/.test(word))
  const solutions = distributed.length ? distributed : DAILY_WORDS
  const target = solutions[content.seed % solutions.length]!.toUpperCase()
  const key = `qv_words_daily:${content.utc_day}:${content.seed}`
  const [saved, persist] = gameStorage(key, { guesses: [] as string[], phase: 'playing' as 'lost' | 'playing' | 'won' })
  const [guesses, setGuesses] = useState(saved.guesses)
  const [phase, setPhase] = useState(saved.phase)
  const [guess, setGuess] = useState('')
  const [message, setMessage] = useState('')

  const submit = async () => {
    const normalized = guess.replace(/[^a-z]/gi, '').toUpperCase()

    if (normalized.length !== 5 || phase !== 'playing') {
      setMessage('Enter exactly five letters.')

      return
    }

    // The currently selected authoritative bank is also the safe fallback
    // acceptance set. This keeps every published General/GRE answer playable
    // when the separate dictionary request is unavailable.
    const dictionary = await loadWordsDictionary('guess-5', solutions)

    if (!dictionary.has(normalized)) {
      setMessage('That word is not in the verified dictionary.')

      return
    }

    const nextGuesses = [...guesses, normalized]
    const nextPhase = normalized === target ? 'won' : nextGuesses.length === 6 ? 'lost' : 'playing'
    setGuesses(nextGuesses)
    setPhase(nextPhase)
    setGuess('')
    persist({ guesses: nextGuesses, phase: nextPhase })

    if (nextPhase === 'won') {
      completeStreakDay({ kind: 'words', mode: 'daily', skin: content.skin })
      setMessage(`Solved in ${nextGuesses.length}/6.`)
    } else if (nextPhase === 'lost') {setMessage(`Out of guesses. The word was ${target}.`)}
    else {setMessage(`Guess ${nextGuesses.length} submitted.`)}
  }

  const share = `QuizVerse Daily Word ${content.day_index} ${phase === 'won' ? `${guesses.length}/6` : 'X/6'}\n\n${wordShareGrid(target, guesses)}`

  return (
    <GameCard title="Daily Word">
      <Provenance content={content} />
      <div aria-label="Daily word attempts" className="mt-3 grid max-w-72 gap-1" role="grid">
        {Array.from({ length: 6 }, (_, row) => {
          const word = guesses[row] ?? (row === guesses.length ? guess.toUpperCase() : '')
          const scores = guesses[row] ? scoreWord(target, guesses[row]!) : []

          return (
            <div className="grid grid-cols-5 gap-1" key={row} role="row">
              {Array.from({ length: 5 }, (__, column) => (
                <span
                  aria-label={`${word[column] ?? 'empty'}${scores[column] ? ` ${scores[column]}` : ''}`}
                  className={cn(
                    'grid aspect-square place-items-center rounded border text-sm font-bold',
                    scores[column] === 'correct' && 'bg-emerald-700 text-white',
                    scores[column] === 'present' && 'bg-amber-700 text-white',
                    scores[column] === 'absent' && 'bg-slate-700 text-white'
                  )}
                  key={column}
                  role="gridcell"
                >
                  {word[column] ?? ''}
                </span>
              ))}
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex max-w-md gap-2">
        <input
          aria-label="Five-letter guess"
          autoCapitalize="characters"
          className="min-w-0 flex-1 rounded border px-3 py-2 text-sm uppercase"
          disabled={phase !== 'playing'}
          maxLength={5}
          onChange={event => setGuess(event.target.value.replace(/[^a-z]/gi, ''))}
          onKeyDown={event => { if (event.key === 'Enter') {void submit()} }}
          value={guess}
        />
        <Button disabled={guess.length !== 5 || phase !== 'playing'} onClick={() => void submit()} size="sm">Guess</Button>
      </div>
      <Status message={message} />
      {phase !== 'playing' && <div className="flex gap-2"><CopyResult text={share} /><Button className="mt-3" onClick={() => { setGuesses([]); setPhase('playing'); setGuess(''); setMessage(''); persist({ guesses: [], phase: 'playing' }) }} size="sm" variant="outline">Reset practice state</Button></div>}
    </GameCard>
  )
}

function GroupsGame({ content }: { content: WordsDailyEnvelope }) {
  const distributed = bankItems(content.puzzle_bank).filter((candidate): candidate is readonly WordGroup[] =>
    Array.isArray(candidate) &&
    candidate.length === 4 &&
    candidate.every(group => group && typeof group === 'object' && Array.isArray((group as WordGroup).words) && (group as WordGroup).words.length === 4)
  )

  const bank = distributed.length ? distributed : WORD_GROUP_PUZZLES
  const puzzle = bank[content.seed % bank.length]!
  const words = useMemo(() => seededShuffle(puzzle.flatMap(group => group.words), content.seed), [content.seed, puzzle])
  const key = `qv_words_groups:${content.utc_day}:${content.seed}`
  const [saved, persist] = gameStorage(key, { attempts: [] as boolean[], mistakes: 0, solved: [] as string[] })
  const [selected, setSelected] = useState<string[]>([])
  const [solved, setSolved] = useState(saved.solved)
  const [mistakes, setMistakes] = useState(saved.mistakes)
  const [attempts, setAttempts] = useState(saved.attempts)
  const [message, setMessage] = useState('')
  const ended = solved.length === 4 || mistakes >= 4

  const check = () => {
    const match = puzzle.find(group =>
      group.words.length === selected.length && group.words.every(word => selected.includes(word)))

    const nextAttempts = [...attempts, Boolean(match)]

    if (match) {
      const nextSolved = [...solved, match.title]
      setSolved(nextSolved)
      setSelected([])
      setAttempts(nextAttempts)
      persist({ attempts: nextAttempts, mistakes, solved: nextSolved })
      setMessage(`${match.title}: ${match.words.join(', ')}`)

      if (nextSolved.length === 4) {completeStreakDay({ kind: 'words', mode: 'groups', skin: content.skin })}

      return
    }

    const nextMistakes = mistakes + 1
    setMistakes(nextMistakes)
    setAttempts(nextAttempts)
    setMessage(nextMistakes >= 4 ? 'Out of mistakes. All groups are revealed below.' : 'Not a group. Try another set.')
    persist({ attempts: nextAttempts, mistakes: nextMistakes, solved })
  }

  return (
    <GameCard title="Groups">
      <Provenance content={content} />
      <p className="mt-2 text-xs">Mistakes remaining: {Math.max(0, 4 - mistakes)}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {words.map(word => {
          const group = puzzle.find(item => item.words.includes(word))!
          const done = solved.includes(group.title)

          return (
            <button
              aria-pressed={selected.includes(word)}
              className={cn('rounded border p-2 text-xs font-semibold', done ? 'bg-emerald-800' : selected.includes(word) ? 'bg-violet-700' : 'bg-black/20')}
              disabled={done || ended}
              key={word}
              onClick={() => setSelected(current => current.includes(word)
                ? current.filter(item => item !== word)
                : current.length < 4 ? [...current, word] : current)}
              type="button"
            >
              {word}
            </button>
          )
        })}
      </div>
      <Button className="mt-3" disabled={selected.length !== 4 || ended} onClick={check} size="sm">Submit group</Button>
      <Status message={message} />
      {(ended || solved.length > 0) && (
        <div className="mt-3 grid gap-2">
          {puzzle.filter(group => ended || solved.includes(group.title)).map(group => (
            <p className="rounded bg-emerald-900/40 p-2 text-xs" key={group.title}>
              <b>{group.title}</b> · {group.words.join(', ')}
            </p>
          ))}
        </div>
      )}
      {ended && <CopyResult text={`QuizVerse Groups ${content.day_index}\n${attempts.map(ok => ok ? '🟩🟩🟩🟩' : '🟥🟥🟥🟥').join('\n')}`} />}
      <Button className="mt-3" onClick={() => { setAttempts([]); setMistakes(0); setSelected([]); setSolved([]); setMessage(''); persist({ attempts: [], mistakes: 0, solved: [] }) }} size="sm" variant="outline">Reset puzzle</Button>
    </GameCard>
  )
}

function SpellGame({ content }: { content: WordsDailyEnvelope }) {
  const distributed = bankItems(content.puzzle_bank).filter((candidate): candidate is SpellPuzzle => {
    if (!candidate || typeof candidate !== 'object') {return false}
    const puzzle = candidate as SpellPuzzle

    return typeof puzzle.center === 'string' && Array.isArray(puzzle.letters) && puzzle.letters.length === 7 && Array.isArray(puzzle.words) && typeof puzzle.pangram === 'string'
  })

  const bank = distributed.length ? distributed : SPELL_PUZZLES
  const puzzle = bank[content.seed % bank.length]!
  const key = `qv_words_spell:${content.utc_day}:${content.seed}`
  const [saved, persist] = gameStorage(key, { found: [] as string[] })
  const [found, setFound] = useState(saved.found)
  const [typed, setTyped] = useState('')
  const [message, setMessage] = useState('')
  const won = found.includes(puzzle.pangram) && found.length >= 7

  const submit = async () => {
    const word = typed.toUpperCase()
    const error = validateSpellWord(word, puzzle)

    if (error && !error.includes('source list')) { setMessage(error);

 return }

    const dictionary = await loadWordsDictionary('spell', [...puzzle.words, puzzle.pangram])

    if (!dictionary.has(word)) {
      setMessage('That word is not in the verified dictionary.')

      return
    }

    if (found.includes(word)) { setMessage('Already found.'); setTyped('');

 return }

    const next = [...found, word]
    setFound(next)
    setTyped('')
    persist({ found: next })
    setMessage(isPangram(word, puzzle) ? `Pangram! +${word.length + 7}` : `${word} accepted.`)

    if (next.includes(puzzle.pangram) && next.length >= 7) {
      completeStreakDay({ kind: 'words', mode: 'spell', skin: content.skin })
    }
  }

  return (
    <GameCard title="Spell">
      <Provenance content={content} />
      <p className="mt-2 text-xs">Find source-list words of 4+ letters. Every word must contain the center letter.</p>
      <div aria-label="Spell letters" className="mt-3 flex flex-wrap justify-center gap-2" role="group">
        {seededShuffle(puzzle.letters, content.seed).map(letter => (
          <Button
            aria-label={`${letter}${letter === puzzle.center ? ', required center letter' : ''}`}
            className={letter === puzzle.center ? 'ring-2 ring-amber-400' : ''}
            key={letter}
            onClick={() => setTyped(current => current + letter)}
            variant={letter === puzzle.center ? 'default' : 'outline'}
          >
            {letter}
          </Button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          aria-label="Spell word"
          className="min-w-0 flex-1 rounded border px-3 py-2 uppercase"
          onChange={event => setTyped(event.target.value.replace(/[^a-z]/gi, '').toUpperCase())}
          onKeyDown={event => { if (event.key === 'Enter') {void submit()} }}
          value={typed}
        />
        <Button onClick={() => setTyped(value => value.slice(0, -1))} variant="outline">Delete</Button>
        <Button disabled={!typed} onClick={() => void submit()}>Enter</Button>
      </div>
      <p className="mt-3 text-sm font-semibold">{found.length} found · {spellScore(found, puzzle)} points</p>
      <div className="mt-2 flex flex-wrap gap-1">{found.map(word => <span className="rounded bg-violet-900/50 px-2 py-1 text-xs" key={word}>{word}</span>)}</div>
      <Status message={won ? 'Queen Bee complete. Streak saved.' : message} />
      {won && <CopyResult text={`QuizVerse Spell ${content.day_index}\n${found.length} words · ${spellScore(found, puzzle)} points\n🐝 ${puzzle.pangram}`} />}
      <Button className="mt-3" onClick={() => { setFound([]); setTyped(''); setMessage(''); persist({ found: [] }) }} size="sm" variant="outline">Reset found words</Button>
    </GameCard>
  )
}

function CrosswordGame({ content }: { content: WordsDailyEnvelope }) {
  const distributed = bankItems(content.puzzle_bank).filter((candidate): candidate is CrosswordPuzzle => {
    if (!candidate || typeof candidate !== 'object') {return false}
    const puzzle = candidate as CrosswordPuzzle

    return Array.isArray(puzzle.grid) && puzzle.grid.length === 5 && puzzle.grid.every(row => Array.isArray(row) && row.length === 5) && Boolean(puzzle.clues?.across && puzzle.clues?.down)
  })

  const bank = distributed.length ? distributed : CROSSWORD_PUZZLES
  const puzzle = bank[content.seed % bank.length]!
  const key = `qv_words_crossword:${content.utc_day}:${content.seed}`
  const empty: string[][] = puzzle.grid.map(row => row.map(letter => letter === '.' ? '.' : ''))
  const [saved, persist] = gameStorage(key, { entries: empty, revealed: false, solved: false })
  const [entries, setEntries] = useState(saved.entries)
  const [revealed, setRevealed] = useState(saved.revealed)
  const [checked, setChecked] = useState(false)
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>(null)
  const [revealConfirmed, setRevealConfirmed] = useState(false)
  const solved = puzzle.grid.every((row, r) => row.every((letter, c) => letter === '.' || entries[r]?.[c] === letter))
  useEffect(() => {
    if (!saved.solved && crosswordCleanSolveEligible(solved, revealed)) {
      completeStreakDay({ kind: 'words', mode: 'crossword', skin: content.skin })
    }
  }, [content.skin, revealed, saved.solved, solved])

  const update = (row: number, column: number, value: string) => {
    const next = entries.map(line => [...line])
    next[row]![column] = value.replace(/[^a-z]/gi, '').slice(-1).toUpperCase()
    setEntries(next)
    persist({ entries: next, revealed, solved: puzzle.grid.every((line, r) => line.every((letter, c) => letter === '.' || next[r]?.[c] === letter)) })
  }

  return (
    <GameCard title={`Crossword · ${puzzle.theme}`}>
      <Provenance content={content} />
      <div aria-label="Crossword grid" className="mt-3 grid w-72 grid-cols-5 gap-1" role="grid">
        {puzzle.grid.flatMap((row, r) => row.map((letter, c) => letter === '.'
          ? <span aria-hidden className="aspect-square rounded bg-black/70" key={`${r}:${c}`} />
          : (
            <input
              aria-label={`Crossword row ${r + 1} column ${c + 1}`}
              className={cn('aspect-square min-w-0 rounded border text-center font-bold uppercase', checked && entries[r]?.[c] && entries[r]?.[c] !== letter && 'border-red-500 bg-red-950')}
              key={`${r}:${c}`}
              maxLength={1}
              onChange={event => update(r, c, event.target.value)}
              onFocus={() => setSelectedCell([r, c])}
              value={entries[r]?.[c] ?? ''}
            />
          )))}
      </div>
      <div className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
        <div><b>Across</b>{puzzle.clues.across.map(clue => <p key={clue.n}>{clue.n}. {clue.clue}</p>)}</div>
        <div><b>Down</b>{puzzle.clues.down.map(clue => <p key={clue.n}>{clue.n}. {clue.clue}</p>)}</div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => setChecked(value => !value)} size="sm" variant="outline">{checked ? 'Hide check' : 'Check'}</Button>
        <Button onClick={() => { setEntries(empty); persist({ entries: empty, revealed, solved: false }) }} size="sm" variant="outline">Clear</Button>
        <Button disabled={!selectedCell || !revealConfirmed} onClick={() => {
          if (!selectedCell) {return}
          const [row, column] = selectedCell
          const next = entries.map(line => [...line])
          next[row]![column] = puzzle.grid[row]?.[column] ?? ''
          setEntries(next)
          setRevealed(true)
          persist({ entries: next, revealed: true, solved: puzzle.grid.every((line, r) => line.every((letter, c) => letter === '.' || next[r]?.[c] === letter)) })
          setRevealConfirmed(false)
        }} size="sm" variant="outline">Reveal selected cell</Button>
      </div>
      <label className="mt-2 flex gap-2 text-xs"><input checked={revealConfirmed} onChange={event => setRevealConfirmed(event.target.checked)} type="checkbox" />Reveal costs this puzzle’s clean solve.</label>
      <Status message={solved ? revealed ? 'Crossword solved with a reveal. Clean-solve streak and reward were not granted.' : 'Crossword solved. Streak saved.' : checked ? 'Incorrect cells are marked in red.' : ''} />
      {solved && <CopyResult text={`QuizVerse Crossword ${content.day_index}\n${puzzle.grid.map(row => row.map(cell => cell === '.' ? '⬛' : '⬜').join('')).join('\n')}`} />}
    </GameCard>
  )
}

type ImposterPhase = 'discuss' | 'result' | 'reveal' | 'setup' | 'vote'

function ImposterGame({ content }: { content: WordsDailyEnvelope }) {
  const distributed = bankItems(content.puzzle_bank).filter((candidate): candidate is ImposterPuzzle => {
    if (!candidate || typeof candidate !== 'object') {return false}
    const puzzle = candidate as ImposterPuzzle

    return Boolean(puzzle.a && puzzle.b && puzzle.category)
  })

  const bank = distributed.length ? distributed : IMPOSTER_PUZZLES
  const puzzle = bank[content.seed % bank.length]!
  const key = `qv_words_imposter:${content.utc_day}:${content.seed}:${content.skin}`

  const [saved, persist] = gameStorage(key, {
    cursor: 0,
    decoy: true,
    imposterCount: 1,
    phase: 'setup' as ImposterPhase,
    players: 4,
    shown: false,
    votes: {} as Record<number, number>
  })

  const [players, setPlayers] = useState(saved.players)
  const [imposterCount, setImposterCount] = useState(saved.imposterCount)
  const [decoy, setDecoy] = useState(saved.decoy)
  const [phase, setPhase] = useState<ImposterPhase>(saved.phase)
  const [cursor, setCursor] = useState(saved.cursor)
  const [shown, setShown] = useState(saved.shown)
  const [votes, setVotes] = useState<Record<number, number>>(saved.votes)
  const imposters = useMemo(() => imposterIndices(players, imposterCount, content.seed), [content.seed, imposterCount, players])
  const result = phase === 'result' ? imposterResult(votes, imposters) : null
  useEffect(() => {
    persist({ cursor, decoy, imposterCount, phase, players, shown, votes })

    if (phase === 'result') {completeStreakDay({ kind: 'words', mode: 'imposter', skin: content.skin })}
  }, [content.skin, cursor, decoy, imposterCount, persist, phase, players, shown, votes])

  if (phase === 'setup') {return (
    <GameCard title="Imposter">
      <Provenance content={content} />
      <p className="mt-2 text-xs">Pass-and-play. Every player privately reveals a word; the imposter receives a close decoy.</p>
      <label className="mt-3 block text-xs">Players: {players}
        <input aria-label="Player count" className="ml-2" max={10} min={3} onChange={event => { const count = Number(event.target.value); setPlayers(count); setImposterCount(current => Math.min(current, Math.max(1, count - 2))) }} type="range" value={players} />
      </label>
      <label className="mt-3 block text-xs">Imposters: {imposterCount}
        <input aria-label="Imposter count" className="ml-2" max={Math.max(1, players - 2)} min={1} onChange={event => setImposterCount(Number(event.target.value))} type="range" value={imposterCount} />
      </label>
      <label className="mt-3 flex gap-2 text-xs"><input checked={decoy} onChange={event => setDecoy(event.target.checked)} type="checkbox" />Give imposters a close decoy word</label>
      <Button className="mt-3" onClick={() => setPhase('reveal')}>Start round</Button>
    </GameCard>
  )}

  if (phase === 'reveal') {
    const isImposter = imposters.includes(cursor)

    return (
      <GameCard title={`Pass to Player ${cursor + 1}`}>
        {!shown
          ? <Button onClick={() => setShown(true)}>Reveal secret</Button>
          : <>
              <p className="mt-3 text-xs">Category: {puzzle.category}</p>
              <p className="mt-2 text-2xl font-bold">{isImposter ? decoy ? puzzle.b : 'IMPOSTER' : puzzle.a}</p>
              <Button className="mt-3" onClick={() => {
                setShown(false)

                if (cursor + 1 === players) { setCursor(0); setPhase('discuss') } else {setCursor(cursor + 1)}
              }}>{cursor + 1 === players ? 'Begin discussion' : `Hide and pass to Player ${cursor + 2}`}</Button>
            </>}
      </GameCard>
    )
  }

  if (phase === 'discuss') {return (
    <GameCard title="Discuss">
      <p className="text-sm">Give one clue each without saying the word. Category: <b>{puzzle.category}</b></p>
      <Button className="mt-3" onClick={() => setPhase('vote')}>Start private vote</Button>
    </GameCard>
  )}

  if (phase === 'vote') {return (
    <GameCard title={`Player ${cursor + 1} votes`}>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: players }, (_, index) => index).filter(index => index !== cursor).map(index => (
          <Button key={index} onClick={() => setVotes(current => ({ ...current, [cursor]: index }))} variant={votes[cursor] === index ? 'default' : 'outline'}>
            Player {index + 1}
          </Button>
        ))}
      </div>
      <Button className="mt-3" disabled={votes[cursor] === undefined} onClick={() => {
        if (cursor + 1 === players) {setPhase('result')}
        else {setCursor(cursor + 1)}
      }}>{cursor + 1 === players ? 'Show result' : `Lock vote and pass to Player ${cursor + 2}`}</Button>
    </GameCard>
  )}

  return (
    <GameCard title={result?.imposterWin ? 'Imposter wins' : 'Table wins'}>
      <p>Word: <b>{puzzle.a}</b> · Decoy: <b>{puzzle.b}</b></p>
      <p className="mt-2 text-sm">{result?.tied ? 'Vote tied; nobody was ejected.' : `Player ${(result?.ejected ?? 0) + 1} was ejected.`}</p>
      <p className="mt-2 text-sm">Imposter: Player {imposters[0]! + 1}</p>
      <p className="mt-1 text-xs">{imposters.length > 1 ? `All imposters: ${imposters.map(index => `Player ${index + 1}`).join(', ')}` : ''}</p>
      <Button className="mt-3" onClick={() => { setCursor(0); setShown(false); setVotes({}); setPhase('setup') }}>New round</Button>
    </GameCard>
  )
}

interface DuelQuestion {
  options: string[]
  word: string
}

function normalizeDuel(value: unknown): {
  alreadySubmitted: boolean
  previousScore?: number
  questions: DuelQuestion[]
} {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root

  const questions = Array.isArray(data.questions) ? data.questions.flatMap(item => {
    if (!item || typeof item !== 'object') {return []}
    const q = item as Record<string, unknown>
    const options = Array.isArray(q.options ?? q.opts) ? (q.options ?? q.opts) as unknown[] : []

    return typeof q.word === 'string' && options.length === 4
      ? [{ word: q.word, options: options.map(String) }]
      : []
  }) : []

  return {
    alreadySubmitted: data.already_submitted === true,
    previousScore: typeof data.previous_score === 'number' ? data.previous_score : undefined,
    questions
  }
}

function DuelGame({ skin }: { skin: WordsSkin }) {
  const [exam, setExam] = useState('gre')
  const [questions, setQuestions] = useState<DuelQuestion[]>([])
  const [answers, setAnswers] = useState<number[]>([])
  const [phase, setPhase] = useState<'confirm' | 'error' | 'loading' | 'playing' | 'result' | 'select'>('select')
  const [message, setMessage] = useState('')
  const [leaderboard, setLeaderboard] = useState<ReturnType<typeof normalizeLeaderboard>>([])
  const [startedAt, setStartedAt] = useState(0)

  const submission = useMemo(() => createSubmissionMachine(
    (input: { answers: number[]; elapsed_ms: number; exam: string }, idempotencyKey) =>
      playRpc('quizverse_words_duel_submit', { ...input, idempotency_key: idempotencyKey }) as Promise<Record<string, unknown>>
  ), [])

  const load = async () => {
    setPhase('loading')

    try {
      const response = normalizeDuel(await playRpc('quizverse_words_duel_get', { exam }))

      if (response.alreadySubmitted) {
        setMessage(`Today’s ${exam.toUpperCase()} duel is already submitted · score ${response.previousScore ?? 'recorded'}/10.`)
        setPhase('result')
        await loadLeaderboard()

        return
      }

      if (response.questions.length !== 10) {throw new Error('The authoritative duel did not return ten valid questions.')}
      setQuestions(response.questions)
      setAnswers([])
      setStartedAt(Date.now())
      setPhase('playing')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      setPhase('error')
    }
  }

  const loadLeaderboard = async () => {
    try {
      const value = await playRpc('quizverse_words_duel_leaderboard', { exam, limit: 25 })
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      setLeaderboard(normalizeLeaderboard(record.data ?? record))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const submit = async () => {
    setPhase('loading')

    try {
      const result = await submission.submit({
        answers,
        elapsed_ms: Math.max(0, Date.now() - startedAt),
        exam
      })

      const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : result
      const score = Number(data.score ?? data.correct ?? 0)

      setMessage(`Score ${Number.isFinite(score) ? score : 'submitted'}/10`)

      if (score >= 6) {
        completeStreakDay({ exam, kind: 'words', mode: 'duel', skin })
      }

      setPhase('result')
      await loadLeaderboard()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      setPhase('error')
    }
  }

  const index = answers.length

  return (
    <GameCard title="Vocab Duel">
      {phase === 'select' && <>
        <div className="flex gap-2">{['gre', 'gmat', 'ielts'].map(value => <Button key={value} onClick={() => setExam(value)} variant={exam === value ? 'default' : 'outline'}>{value.toUpperCase()}</Button>)}</div>
        <div className="mt-3 flex gap-2"><Button onClick={() => void load()}>Start today’s duel</Button><Button onClick={() => void loadLeaderboard()} variant="outline">Leaderboard</Button></div>
      </>}
      {phase === 'playing' && questions[index] && <>
        <p className="text-xs">Question {index + 1}/10 · choose the closest definition</p>
        <p className="mt-3 text-xl font-bold">{questions[index].word}</p>
        <div className="mt-3 grid gap-2">
          {questions[index].options.map((option, optionIndex) => <Button key={option} onClick={() => {
            const next = [...answers, optionIndex]
            setAnswers(next)

            if (next.length === 10) {setPhase('confirm')}
          }} variant="outline">{option}</Button>)}
        </div>
      </>}
      {phase === 'confirm' && <>
        <p className="text-sm">All ten answers are ready. Submission affects today’s ranked duel and cannot be replayed.</p>
        <Button className="mt-3" onClick={() => void submit()}>Confirm ranked submission</Button>
      </>}
      {phase === 'loading' && <p aria-live="polite">Loading authoritative duel…</p>}
      {phase === 'error' && <><Status error message={message} /><Button onClick={() => setPhase('select')}>Try again</Button></>}
      {phase === 'result' && <><Status message={message} /><CopyResult text={`QuizVerse ${exam.toUpperCase()} Vocab Duel\n${message}`} /></>}
      {leaderboard.length > 0 && <ol className="mt-4 grid gap-1">{leaderboard.map(row => <li className="text-xs" key={`${row.ownerId}:${row.rank}`}>#{row.rank} {row.username} · {row.score}</li>)}</ol>}
    </GameCard>
  )
}

export function WordsSurface({ route }: WordsRouteProps) {
  const day = useUtcDay()

  const [skin, setSkinState] = useState<WordsSkin>(() =>
    localStorage.getItem('qv_words_skin_v1') === 'gre-easy' ? 'gre-easy' : 'general'
  )

  const setSkin = (next: WordsSkin) => {
    localStorage.setItem('qv_words_skin_v1', next)
    setSkinState(next)
  }

  const wrap = (content: ReactNode) => (
    <div className="grid gap-3">
      <div aria-label="Words vocabulary skin" className="flex gap-2" role="group">
        <Button onClick={() => setSkin('general')} variant={skin === 'general' ? 'default' : 'outline'}>General</Button>
        <Button onClick={() => setSkin('gre-easy')} variant={skin === 'gre-easy' ? 'default' : 'outline'}>GRE Easy</Button>
      </div>
      {content}
    </div>
  )

  if (route === 'daily') {
    return wrap(<WordsContentLoader key={`${day}:${skin}`} mode="daily" skin={skin}>{content => <DailyWord content={content} />}</WordsContentLoader>)
  }

  if (route === 'groups') {
    return wrap(<WordsContentLoader key={`${day}:${skin}`} mode="groups" skin={skin}>{content => <GroupsGame content={content} />}</WordsContentLoader>)
  }

  if (route === 'spell') {
    return wrap(<WordsContentLoader key={`${day}:${skin}`} mode="spell" skin={skin}>{content => <SpellGame content={content} />}</WordsContentLoader>)
  }

  if (route === 'crossword') {
    return wrap(<WordsContentLoader key={`${day}:${skin}`} mode="crossword" skin={skin}>{content => <CrosswordGame content={content} />}</WordsContentLoader>)
  }

  if (route === 'imposter') {
    return wrap(<WordsContentLoader key={`${day}:${skin}`} mode="imposter" skin={skin}>{content => <ImposterGame content={content} />}</WordsContentLoader>)
  }

  if (route === 'duel') {return wrap(<DuelGame key={`${day}:${skin}`} skin={skin} />)}

  return (
    <GameCard title="Words rules and provenance">
      <p className="text-sm">Daily Word uses six attempts and duplicate-aware letter scoring. Groups allows four mistakes. Spell requires the center letter and source-list validation. All daily content is selected by the source-compatible UTC FNV-1a seed, with explicit server or offline provenance.</p>
    </GameCard>
  )
}

function GameCard({ children, title }: { children: ReactNode; title: string }) {
  return <section className="qv-glass-tile rounded-xl p-4"><h3 className="text-sm font-semibold">{title}</h3>{children}</section>
}

function Status({ error = false, message }: { error?: boolean; message: string }) {
  return message ? <p className={cn('mt-3 rounded p-2 text-xs', error ? 'bg-red-950 text-red-100' : 'bg-black/20')} role={error ? 'alert' : 'status'}>{message}</p> : null
}

function CopyResult({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  return <Button className="mt-3" onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))} size="sm" variant="outline">{copied ? 'Copied' : 'Copy share result'}</Button>
}
