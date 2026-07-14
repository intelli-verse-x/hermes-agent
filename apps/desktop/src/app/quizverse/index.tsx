import './quizverse-surface.css'

import type * as React from 'react'
import { useState } from 'react'

import { useRouteEnumParam } from '../hooks/use-route-enum-param'
import { PageSearchShell } from '../page-search-shell'

import { ArcadeTab } from './arcade-tab'
import { NativePlay } from './native-play'
import { NativeTutorSurface } from './native-tutor'
import { SetupTab } from './setup-tab'
import { QvStatusStrip } from './status-strip'

// QuizVerse workspace. TutorX learning and Play are native renderer surfaces;
// the supervised FastAPI and Nakama services remain their sources of truth.
const QV_MODES = ['tutor', 'knowledge', 'memory', 'learning', 'play', 'arcade', 'setup'] as const

type QvMode = (typeof QV_MODES)[number]

const TAB_LABEL: Record<QvMode, string> = {
  arcade: 'Arcade',
  knowledge: 'Knowledge',
  learning: 'Learning Space',
  memory: 'Memory',
  play: 'Play',
  setup: 'Setup',
  tutor: 'Tutor'
}

export function QuizverseView(props: React.ComponentProps<'section'>) {
  const [mode, setMode] = useRouteEnumParam('tab', QV_MODES, 'tutor')
  const [query, setQuery] = useState('')

  return (
    <PageSearchShell
      {...props}
      activeTab={mode}
      className={`qv-workspace ${props.className ?? ''}`}
      filters={<QvStatusStrip />}
      onSearchChange={setQuery}
      onTabChange={id => {
        setMode(id as QvMode)
        setQuery('')
      }}
      searchHidden
      searchPlaceholder=""
      searchValue={query}
      tabs={QV_MODES.map(id => ({ id, label: TAB_LABEL[id] }))}
    >
      {(mode === 'tutor' || mode === 'knowledge' || mode === 'memory' || mode === 'learning') && (
        <NativeTutorSurface surface={mode} />
      )}
      {mode === 'play' && <NativePlay />}
      {mode === 'arcade' && <ArcadeTab />}
      {mode === 'setup' && <SetupTab />}
    </PageSearchShell>
  )
}
