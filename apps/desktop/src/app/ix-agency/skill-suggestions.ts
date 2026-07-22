/**
 * Contextual skill suggestions for the IX Agency copilot composer — the
 * desktop port of the admin portal's engine (Intelliverse-X-Webfrontend
 * src/lib/skill-suggestion-engine.ts, PR #203). Same v1 posture: keyword
 * overlap + lightweight rank bonus, no LLM, pure functions (framework-
 * agnostic — no React/Electron imports) so the matcher is portable.
 *
 * Inputs are the composer draft and the org skill catalog the copilot
 * already renders as picker chips ($ixSync orgSkillCatalog). Skills already
 * active in the picker are never suggested again.
 */

import type { IxSkillItem } from './types'

export interface ScoredSkillSuggestion {
  score: number
  skill: IxSkillItem
}

export interface SkillSuggestionContext {
  /** Skill ids already active in the picker — excluded from suggestions. */
  activeSkillIds: string[]
  composerText: string
}

/** Same cadence as the admin portal composer chips. */
export const SKILL_SUGGEST_DEBOUNCE_MS = 400

export const MAX_SKILL_SUGGESTIONS = 3

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'do',
  'for',
  'from',
  'get',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'show',
  'the',
  'this',
  'to',
  'us',
  'we',
  'what',
  'with',
  'you',
  'your'
])

/** Lowercase alphanumeric tokens (min length 3), stopwords removed. */
export function tokenize(text: string): string[] {
  if (!text) {
    return []
  }

  const raw = text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []

  return [...new Set(raw.filter(token => !STOP_WORDS.has(token)))]
}

/**
 * Keyword corpus from skill metadata: id parts, title, description and the
 * markdown headers of the playbook body (never the full content — headers
 * carry the tool/topic names without drowning the corpus in prose).
 */
export function buildSkillKeywords(skill: Pick<IxSkillItem, 'content' | 'description' | 'id' | 'title'>): string[] {
  const headerLines = (skill.content ?? '')
    .split('\n')
    .filter(line => /^#{1,3}\s/.test(line))
    .join(' ')

  return tokenize([...skill.id.split(/[-_]/), skill.title, skill.description, headerLines].join(' '))
}

function scoreSkill(
  skill: IxSkillItem,
  keywords: string[],
  composerTokens: Set<string>,
  composerLower: string
): number {
  let score = 0

  for (const keyword of keywords) {
    if (composerTokens.has(keyword)) {
      score += 4
    } else if (composerLower.includes(keyword)) {
      score += 2
    }
  }

  // Rank bonus mirrors the portal picker ordering (1 = flagship cross-MCP
  // playbooks, 2 = preloaded insights, null/3 = specialists) — but only on
  // top of a real keyword match, so unrelated drafts stay suggestion-free.
  if (score > 0) {
    const rank = skill.rank ?? 2.5

    if (rank <= 1) {
      score += 2
    } else if (rank <= 2) {
      score += 1
    }
  }

  return score
}

/**
 * Up to MAX_SKILL_SUGGESTIONS suggestions for a non-empty composer draft.
 * Empty draft ⇒ no suggestions: unlike the portal composer the desktop pane
 * already shows the whole catalog as picker chips, so idle suggestions would
 * be pure noise.
 */
export function suggestSkills(
  catalog: IxSkillItem[],
  ctx: SkillSuggestionContext,
  limit = MAX_SKILL_SUGGESTIONS
): ScoredSkillSuggestion[] {
  const composerLower = ctx.composerText.trim().toLowerCase()

  if (!composerLower) {
    return []
  }

  const composerTokens = new Set(tokenize(ctx.composerText))
  const active = new Set(ctx.activeSkillIds)

  const scored = catalog
    .filter(skill => !active.has(skill.id))
    .map(skill => ({
      score: scoreSkill(skill, buildSkillKeywords(skill), composerTokens, composerLower),
      skill
    }))
    .filter(entry => entry.score > 0)

  scored.sort((a, b) => b.score - a.score || (a.skill.rank ?? 2.5) - (b.skill.rank ?? 2.5))

  return scored.slice(0, limit)
}
