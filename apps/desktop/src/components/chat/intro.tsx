import { type CSSProperties, useState } from 'react'

import { BRAND_NAME, IS_QUIZVERSE_BRAND } from '@/lib/brand'
import { capitalize, normalize } from '@/lib/text'

import introCopyJsonl from './intro-copy.jsonl?raw'

type IntroCopy = {
  headline: string
  body: string
}

type IntroCopyRecord = IntroCopy & {
  personality: string
}

export type IntroProps = {
  personality?: string
  seed?: number
}

const NEUTRAL_PERSONALITIES = new Set(['', 'default', 'none', 'neutral'])

const FALLBACK_COPY_CODING: IntroCopy[] = [
  {
    headline: 'What are we moving today?',
    body: "Send a bug, branch, plan, or rough idea. I'll inspect the repo and turn it into the next concrete step."
  },
  {
    headline: "What's on your mind?",
    body: "Bring the code, question, or stuck part. I'll read the room before making changes."
  },
  {
    headline: `What should ${BRAND_NAME} look at?`,
    body: "Send the task, failing path, or half-formed plan. I'll help turn it into action."
  },
  {
    headline: 'Where should we start?',
    body: "Bring the problem, goal, or file. I'll inspect first and keep the next step concrete."
  },
  {
    headline: 'What needs attention?',
    body: "Send the context you have. I'll help sort it into a plan or a fix."
  }
]

const FALLBACK_COPY_QUIZVERSE: IntroCopy[] = [
  {
    headline: 'What do you want to learn?',
    body: 'Ask about an exam topic, practice question, or concept. I’ll explain clearly and keep the next step simple.'
  },
  {
    headline: 'Ready to study?',
    body: 'Tell me the subject, exam, or stuck concept. I’ll help you understand it without jargon.'
  },
  {
    headline: `What should ${BRAND_NAME} cover?`,
    body: 'Drop a topic, past paper question, or weak area. I’ll turn it into a focused study turn.'
  },
  {
    headline: 'Where should we start?',
    body: 'Share the exam goal or the chapter you’re on. I’ll keep answers short and useful.'
  },
  {
    headline: 'What needs practice?',
    body: 'Send a question or concept. I’ll walk through it and check you understand.'
  }
]

const FALLBACK_COPY = IS_QUIZVERSE_BRAND ? FALLBACK_COPY_QUIZVERSE : FALLBACK_COPY_CODING

function normalizeKey(value?: string): string {
  return normalize(value)
}

function titleize(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(' ')
}

function isIntroCopyRecord(value: unknown): value is IntroCopyRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>

  return (
    typeof record.personality === 'string' &&
    typeof record.headline === 'string' &&
    typeof record.body === 'string' &&
    Boolean(record.personality.trim()) &&
    Boolean(record.headline.trim()) &&
    Boolean(record.body.trim())
  )
}

function parseIntroCopy(raw: string): Record<string, IntroCopy[]> {
  const byPersonality: Record<string, IntroCopy[]> = {}

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed) {
      continue
    }

    try {
      const parsed: unknown = JSON.parse(trimmed)

      if (!isIntroCopyRecord(parsed)) {
        continue
      }

      const key = normalizeKey(parsed.personality)
      byPersonality[key] ??= []
      byPersonality[key].push({
        headline: parsed.headline.trim(),
        body: parsed.body.trim()
      })
    } catch {
      // Bad generated copy should not break the whole desktop app.
    }
  }

  return byPersonality
}

const INTRO_COPY_BY_PERSONALITY = parseIntroCopy(introCopyJsonl)

function neutralCopy(): IntroCopy[] {
  // QuizVerse must never surface coding/Hermes intro-copy.jsonl rows
  // ("point me at a repo…") — brand study copy wins for empty chat.
  if (IS_QUIZVERSE_BRAND) {
    return FALLBACK_COPY_QUIZVERSE
  }

  return INTRO_COPY_BY_PERSONALITY.none || INTRO_COPY_BY_PERSONALITY.default || FALLBACK_COPY
}

function fallbackCopyForPersonality(personalityKey: string): IntroCopy[] {
  if (NEUTRAL_PERSONALITIES.has(personalityKey)) {
    return neutralCopy()
  }

  const label = titleize(personalityKey)

  if (IS_QUIZVERSE_BRAND) {
    return [
      {
        headline: `${label} mode is on. What should we study?`,
        body: "Ask about a topic, practice question, or weak area. I'll keep the explanation clear and exam-focused."
      },
      {
        headline: `What does ${label} ${BRAND_NAME} need to cover?`,
        body: "Bring the concept or stuck part. I'll adapt to your configured study voice."
      },
      {
        headline: `${label} mode is ready.`,
        body: "Send the question or chapter. I'll follow the personality you've configured."
      },
      {
        headline: `What should ${label} ${BRAND_NAME} teach next?`,
        body: "Drop the topic here. I'll keep the next step simple and useful."
      },
      {
        headline: 'Where should we begin?',
        body: `Give me the exam goal and I'll answer in ${label} mode.`
      }
    ]
  }

  return [
    {
      headline: `${label} mode is on. What should we work on?`,
      body: "Send the task, file, or rough idea. I'll use your configured voice and keep the work grounded in this repo."
    },
    {
      headline: `What does ${label} ${BRAND_NAME} need to see?`,
      body: "Bring the context or the stuck part. I'll adapt to your configured personality."
    },
    {
      headline: `${label} mode is ready.`,
      body: "Send the problem, file, or idea. I'll follow the personality you've configured."
    },
    {
      headline: `What should ${label} ${BRAND_NAME} tackle?`,
      body: "Drop the task here. I'll keep the work grounded in the repo."
    },
    {
      headline: 'Where should we begin?',
      body: `Give me the context and I'll answer in ${label} mode.`
    }
  ]
}

function pickCopy(copies: IntroCopy[], seed = 0): IntroCopy {
  return copies[Math.abs(seed) % copies.length] || FALLBACK_COPY[0]
}

// The giant fit-text wordmark on every empty thread follows the brand — no
// Hermes branding is user-visible in either desktop flavor (audit F1).
const WORDMARK = BRAND_NAME.toUpperCase()

function resolveCopy(personality?: string, seed?: number): IntroCopy {
  const personalityKey = normalizeKey(personality)

  if (IS_QUIZVERSE_BRAND && NEUTRAL_PERSONALITIES.has(personalityKey)) {
    return pickCopy(FALLBACK_COPY_QUIZVERSE, seed)
  }

  const copies = NEUTRAL_PERSONALITIES.has(personalityKey)
    ? INTRO_COPY_BY_PERSONALITY[personalityKey] || neutralCopy()
    : IS_QUIZVERSE_BRAND
      ? fallbackCopyForPersonality(personalityKey)
      : INTRO_COPY_BY_PERSONALITY[personalityKey] || fallbackCopyForPersonality(personalityKey)

  return pickCopy(copies, seed)
}

export function Intro({ personality, seed }: IntroProps) {
  const [mountSeed] = useState(() => Math.floor(Math.random() * 100000))
  const copy = resolveCopy(personality, mountSeed + (seed ?? 0))

  return (
    <div
      className="pointer-events-none flex w-full min-w-0 flex-col items-center justify-center px-0.5 py-6 text-center text-muted-foreground sm:px-6 lg:px-8"
      data-slot="aui_intro"
    >
      <div className="w-full min-w-0">
        <p
          aria-label={WORDMARK}
          className="fit-text mx-auto mb-1 w-[calc(100%-1rem)] font-['Collapse'] font-bold uppercase leading-[0.9] tracking-[0.08em] text-midground mix-blend-plus-lighter dark:text-foreground/90"
          style={{ '--fit-min': '2.75rem' } as CSSProperties}
        >
          <span>
            <span>{WORDMARK}</span>
          </span>
          <span aria-hidden="true">{WORDMARK}</span>
        </p>

        <p className="m-0 text-center leading-normal tracking-tight">{copy.body}</p>
      </div>
    </div>
  )
}
