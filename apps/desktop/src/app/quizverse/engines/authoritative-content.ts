import { fnv1a32, utcDay } from './daily-content'
import { productRequest } from './product-client'
import { loadWordsDataset, type WordsDatasetKind } from './words-content'

const WORDS_EPOCH_UTC = Date.UTC(2026, 4, 25)

export type WordsMode = 'crossword' | 'daily' | 'groups' | 'imposter' | 'spell'
export type WordsSkin = 'general' | 'gre-easy'

export interface WordsDailyEnvelope {
  attempt_count?: number
  content_error?: string
  content_license?: string
  content_provenance?: string
  content_source?: 'first-party-cache' | 'first-party-network' | 'offline-fallback'
  content_version?: string
  day_index: number
  degraded?: string
  mode: WordsMode
  recorded?: boolean
  seed: number
  server_decided: boolean
  skin: WordsSkin
  utc_day: string
  provenance?: 'authoritative-cache' | 'authoritative-network' | 'offline-fallback'
  puzzle_bank?: unknown
}

export interface VoyageTier {
  country: string
  debug?: { source?: string }
  ok: boolean
  policy: {
    banner_during_play: boolean
    banner_on_menu: boolean
    cooldown_secs: number
    free_hints_per_day: number
    interstitial_at_halfway: boolean
    interstitial_between_planets: boolean
    piggybank_price_usd: number
    premium_planet_ads_required: number
    voyage_pass_monthly_display: string
    voyage_pass_yearly_display: string
  }
  tier: 1 | 2 | 3
}

export const FALLBACK_VOYAGE_TIER: VoyageTier = {
  country: 'XX',
  debug: { source: 'client-fallback' },
  ok: true,
  policy: {
    banner_during_play: false,
    banner_on_menu: false,
    cooldown_secs: 60,
    free_hints_per_day: 3,
    interstitial_at_halfway: false,
    interstitial_between_planets: false,
    piggybank_price_usd: 1.49,
    premium_planet_ads_required: 0,
    voyage_pass_monthly_display: '$0.99',
    voyage_pass_yearly_display: '$7.99'
  },
  tier: 2
}

export function fallbackWordsDaily(
  mode: WordsMode,
  skin: WordsSkin,
  date = new Date()
): WordsDailyEnvelope {
  const day = utcDay(date)

  return {
    day_index: Math.max(0, Math.floor((date.getTime() - WORDS_EPOCH_UTC) / 86_400_000)),
    degraded: 'local_fallback',
    mode,
    seed: fnv1a32(`${mode}:${skin}:${day}`),
    server_decided: false,
    skin,
    utc_day: day,
    provenance: 'offline-fallback'
  }
}

const wordsDailyInFlight = new Map<string, Promise<WordsDailyEnvelope>>()

const CONTENT_KIND: Record<WordsMode, WordsDatasetKind> = {
  crossword: 'crossword',
  daily: 'daily-solutions',
  groups: 'groups',
  imposter: 'imposter',
  spell: 'spell-puzzles'
}

function wordsCacheKey(mode: WordsMode, skin: WordsSkin, day: string): string {
  return `qv_words_authoritative_v1:${day}:${mode}:${skin}`
}

export async function loadWordsDaily(
  mode: WordsMode,
  skin: WordsSkin,
  date = new Date()
): Promise<WordsDailyEnvelope> {
  const day = utcDay(date)
  const key = wordsCacheKey(mode, skin, day)
  let cachedDaily: WordsDailyEnvelope | null = null

  try {
    const cached = JSON.parse(localStorage.getItem(key) ?? '') as WordsDailyEnvelope

    if (
      cached.utc_day === day &&
      cached.mode === mode &&
      cached.skin === skin &&
      typeof cached.seed === 'number'
    ) {
      cachedDaily = cached
    }
  } catch {
    // An absent or corrupt cache falls through to one authoritative request.
  }

  const existing = wordsDailyInFlight.get(key)

  if (existing) {
    return existing
  }

  const request: Promise<WordsDailyEnvelope> = (async (): Promise<WordsDailyEnvelope> => {
    let bank: Awaited<ReturnType<typeof loadWordsDataset<unknown>>> | null = null
    let contentError = ''

    try {
      bank = await loadWordsDataset(CONTENT_KIND[mode], skin)
    } catch (error) {
      contentError = error instanceof Error ? error.message : String(error)
    }

    if (cachedDaily) {
      return {
        ...cachedDaily,
        content_error: contentError || undefined,
        content_source: bank?.source ?? 'offline-fallback',
        content_version: bank?.contentVersion,
        content_license: bank?.license,
        content_provenance: bank?.provenance,
        provenance: 'authoritative-cache',
        puzzle_bank: bank?.data
      }
    }

    try {
      const { data } = await productRequest<Partial<WordsDailyEnvelope>>({
        method: 'GET',
        path: `/api/words/daily?mode=${encodeURIComponent(mode)}&skin=${encodeURIComponent(skin)}`
      })

      if (
        typeof data.day_index !== 'number' ||
        typeof data.seed !== 'number' ||
        data.utc_day !== day
      ) {
        throw new Error('Words daily response is malformed or stale')
      }

      const result: WordsDailyEnvelope = {
        ...fallbackWordsDaily(mode, skin, date),
        ...data,
        content_error: contentError || undefined,
        content_source: bank?.source ?? 'offline-fallback',
        content_version: bank?.contentVersion,
        content_license: bank?.license,
        content_provenance: bank?.provenance,
        mode,
        provenance: 'authoritative-network',
        puzzle_bank: bank?.data,
        skin,
        utc_day: day
      }

      const dailyMetadata = { ...result }
      delete dailyMetadata.puzzle_bank
      localStorage.setItem(key, JSON.stringify(dailyMetadata))

      return result
    } catch (error) {
      return {
        ...fallbackWordsDaily(mode, skin, date),
        content_error: contentError || undefined,
        content_source: bank?.source ?? 'offline-fallback',
        content_version: bank?.contentVersion,
        content_license: bank?.license,
        content_provenance: bank?.provenance,
        degraded: error instanceof Error ? error.message : String(error),
        puzzle_bank: bank?.data
      }
    }
  })().finally(() => {
    wordsDailyInFlight.delete(key)
  })

  wordsDailyInFlight.set(key, request)

  return request
}

export async function loadVoyageTier(): Promise<VoyageTier> {
  try {
    const { data } = await productRequest<Partial<VoyageTier>>({
      method: 'GET',
      path: '/api/voyage/tier'
    })

    if (![1, 2, 3].includes(data.tier ?? 0) || !data.policy || typeof data.policy.cooldown_secs !== 'number') {
      throw new Error('Voyage tier response is malformed')
    }

    return data as VoyageTier
  } catch (error) {
    return {
      ...FALLBACK_VOYAGE_TIER,
      debug: { source: error instanceof Error ? error.message : 'client-fallback' }
    }
  }
}
