import './quizverse-surface.css'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

// Optional Arcade satellites remain discoverable, but they are never embedded.
// A satellite needs a native protocol before desktop can safely enable it.

interface ArcadeTileInfo {
  blurb: string
  dependency: string
  id: string
  label: string
}

const ARCADE_TILES: readonly ArcadeTileInfo[] = [
  { blurb: 'Host and join live trivia events.', dependency: 'the QuizVerse Live event protocol', id: 'live', label: 'Live Trivia' },
  { blurb: 'Daily word puzzles.', dependency: 'the QuizVerse Words puzzle feed', id: 'words', label: 'Words' },
  { blurb: 'Daily multi-game brain workout.', dependency: 'the QuizVerse Voyage game manifest', id: 'voyage', label: 'Voyage' },
  { blurb: 'Play-to-earn tournaments.', dependency: 'the tournament reward service', id: 'tournament', label: 'Tournaments' },
  { blurb: 'Your knowledge graph.', dependency: 'the QuizVerse Brain graph API', id: 'brain', label: 'Brain' },
  { blurb: 'AI voice quiz host.', dependency: 'the AI Host LiveKit service', id: 'aihost', label: 'AI Host' }
]

const TILE_ACCENT: Record<string, string> = {
  aihost: 'qv-toon-media',
  brain: 'qv-toon-ai',
  live: 'qv-toon-social',
  tournament: 'qv-toon-premium',
  voyage: 'qv-toon-special',
  words: 'qv-toon-creative'
}

const TILE_ICON_SRC: Record<string, string> = {
  aihost: 'quizverse/brain-icons/chat.webp',
  brain: 'quizverse/brain-icons/map.webp',
  live: 'quizverse/brain-icons/hubs.webp',
  tournament: 'quizverse/brain-icons/recap.webp',
  voyage: 'quizverse/brain-icons/path.webp',
  words: 'quizverse/brain-icons/orphans.webp'
}

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

function ArcadeTile({ onOpen, tile }: { onOpen: (tile: ArcadeTileInfo) => void; tile: ArcadeTileInfo }) {
  const accent = TILE_ACCENT[tile.id] ?? 'qv-toon-ai'
  const iconSrc = TILE_ICON_SRC[tile.id]

  return (
    <button
      className={cn(
        'group qv-glass-tile flex min-h-32 flex-col items-start gap-2 rounded-xl p-4 text-left transition-colors hover:border-[color:var(--qv-tile-accent)]',
        accent
      )}
      onClick={() => onOpen(tile)}
      style={{ borderColor: 'rgba(139, 92, 246, 0.24)' }}
      type="button"
    >
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        {iconSrc ? (
          <img alt="" className="size-6 shrink-0 rounded" src={assetPath(iconSrc)} />
        ) : (
          <Codicon className="text-[color:var(--qv-tile-accent)]" name="game" size="1rem" />
        )}
        {tile.label}
      </span>
      <span className="text-xs text-[#b9aee6]">{tile.blurb}</span>
      <span className="mt-auto text-[0.65rem] text-muted-foreground/60">Native protocol required</span>
    </button>
  )
}

export function ArcadeTab() {
  const [active, setActive] = useState<ArcadeTileInfo | null>(null)

  if (active) {
    return (
      <div className="bg-quizverse-mesh flex h-full min-h-0 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-(--ui-border-primary) px-3">
          <Button onClick={() => setActive(null)} size="xs" variant="ghost">
            <Codicon name="arrow-left" size="0.75rem" />
            Arcade
          </Button>
          <span className="text-xs font-medium text-foreground">{active.label}</span>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <section className="qv-glass-tile max-w-lg rounded-xl p-6 text-center">
            <h2 className="text-base font-semibold">{active.label} is not available natively yet</h2>
            <p className="mt-2 text-xs text-muted-foreground">
              This satellite currently depends on {active.dependency} and does not expose a desktop protocol.
              Embedded hosted navigation is disabled until a native integration is available.
            </p>
            <Button className="mt-4" onClick={() => setActive(null)} size="sm" variant="secondary">
              Back to Arcade
            </Button>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-quizverse-mesh h-full overflow-y-auto rounded-lg p-4">
      <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ARCADE_TILES.map(tile => (
          <ArcadeTile key={tile.id} onOpen={setActive} tile={tile} />
        ))}
      </div>
    </div>
  )
}
