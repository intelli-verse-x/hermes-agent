import './quizverse-surface.css'

import { useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { NATIVE_SURFACES, type NativeSurfaceContract } from './native-contracts'
import { openNativeSurface } from './native-surface-store'
import { NativeSurfaceRouter } from './native-surfaces'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

function ArcadeTile({ onOpen, tile }: { onOpen: (tile: NativeSurfaceContract) => void; tile: NativeSurfaceContract }) {
  return (
    <button
      className={cn(
        'group qv-glass-tile flex min-h-32 flex-col items-start gap-2 rounded-xl p-4 text-left transition-colors hover:border-[color:var(--qv-tile-accent)]',
        tile.accent
      )}
      onClick={() => onOpen(tile)}
      style={{ borderColor: 'rgba(139, 92, 246, 0.24)' }}
      type="button"
    >
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        <img alt="" className="size-6 shrink-0 rounded" src={assetPath(tile.icon)} />
        {tile.label}
      </span>
      <span className="text-xs text-[#d3c8ef]">{tile.description}</span>
      <span className="mt-auto flex items-center gap-1 text-[0.65rem] text-emerald-200">
        <Codicon name="device-desktop" size="0.65rem" />
        {tile.routes.length} native routes
      </span>
    </button>
  )
}

export function ArcadeTab() {
  const [active, setActive] = useState(false)

  if (active) {
    return <NativeSurfaceRouter onBack={() => setActive(false)} />
  }

  return (
    <div className="bg-quizverse-mesh h-full overflow-y-auto rounded-lg p-4">
      <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {NATIVE_SURFACES.map(tile => (
          <ArcadeTile
            key={tile.id}
            onOpen={surface => {
              openNativeSurface(surface.id, surface.routes[0]?.id)
              setActive(true)
            }}
            tile={tile}
          />
        ))}
      </div>
    </div>
  )
}
