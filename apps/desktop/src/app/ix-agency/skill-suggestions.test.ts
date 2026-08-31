/**
 * Tests for skill-suggestions.ts — the copilot composer's contextual skill
 * matcher (desktop port of the admin portal engine).
 */
import { describe, expect, test } from 'vitest'

import skillsData from './data/skills.json'
import { buildSkillKeywords, MAX_SKILL_SUGGESTIONS, suggestSkills, tokenize } from './skill-suggestions'
import type { IxSkillItem } from './types'

const skill = (overrides: Partial<IxSkillItem> & Pick<IxSkillItem, 'id' | 'title'>): IxSkillItem => ({
  appIds: [],
  bundles: [],
  content: '',
  description: '',
  persona: 'all tiers',
  rank: null,
  starterPrompts: [],
  superAdminOnly: false,
  tiers: [],
  ...overrides
})

const CATALOG: IxSkillItem[] = [
  skill({
    content: '# Skill: Cloud cost review\n## Goal\nExplain the AWS bill.\n## Steps\naws_cost_by_service trends.',
    description: 'Monthly AWS bill breakdown, trend, forecast, and concrete saving actions.',
    id: 'cloud-cost-review',
    rank: 1,
    title: 'Cloud cost review'
  }),
  skill({
    content: '# Skill: Weekly business report\n## Steps\nEmail, social, support, CRM, cloud costs.',
    description: 'Pull numbers from email, social, support, CRM and cloud costs into one report.',
    id: 'weekly-business-report',
    rank: 2,
    title: 'Weekly business report'
  }),
  skill({
    content: '# Skill: Support triage\n## Steps\nchatwoot conversations.',
    description: 'Open support conversations, backlog and response times.',
    id: 'support-triage',
    title: 'Support triage'
  })
]

describe('tokenize', () => {
  test('lowercases, drops stopwords and short tokens, dedupes', () => {
    expect(tokenize('Show me MY AWS costs costs at a glance')).toEqual(['aws', 'costs', 'glance'])
  })

  test('empty input yields no tokens', () => {
    expect(tokenize('')).toEqual([])
  })
})

describe('buildSkillKeywords', () => {
  test('uses id parts, title, description and markdown headers — not body prose', () => {
    const keywords = buildSkillKeywords({
      content: '# Skill: Cloud cost review\n## Goal\nSecret zanzibar prose line.',
      description: 'AWS bill breakdown.',
      id: 'cloud-cost-review',
      title: 'Cloud cost review'
    })

    expect(keywords).toContain('cloud')
    expect(keywords).toContain('aws')
    expect(keywords).toContain('goal')
    expect(keywords).not.toContain('zanzibar')
  })
})

describe('suggestSkills', () => {
  test('AWS cost draft ranks cloud-cost-review first', () => {
    const out = suggestSkills(CATALOG, { activeSkillIds: [], composerText: 'why is our aws bill so high this month' })

    expect(out[0]?.skill.id).toBe('cloud-cost-review')
    expect(out.length).toBeLessThanOrEqual(MAX_SKILL_SUGGESTIONS)
  })

  test('empty composer yields nothing (the picker already shows the catalog)', () => {
    expect(suggestSkills(CATALOG, { activeSkillIds: [], composerText: '   ' })).toEqual([])
  })

  test('active skills are never re-suggested', () => {
    const out = suggestSkills(CATALOG, {
      activeSkillIds: ['cloud-cost-review'],
      composerText: 'aws cloud cost forecast'
    })

    expect(out.map(s => s.skill.id)).not.toContain('cloud-cost-review')
  })

  test('unrelated drafts yield no zero-score noise', () => {
    expect(suggestSkills(CATALOG, { activeSkillIds: [], composerText: 'qqq zzz xyzzy' })).toEqual([])
  })

  test('rank breaks ties toward flagship playbooks', () => {
    const tied = [
      skill({ description: 'grafana alerts overview', id: 'b-specialist', rank: 3, title: 'Grafana specialist' }),
      skill({ description: 'grafana alerts overview', id: 'a-flagship', rank: 1, title: 'Grafana flagship' })
    ]

    const out = suggestSkills(tied, { activeSkillIds: [], composerText: 'grafana alerts' })

    expect(out[0]?.skill.id).toBe('a-flagship')
  })

  test('the bundled org catalog produces suggestions for a real ops query', () => {
    const catalog = ((skillsData as { items?: IxSkillItem[] }).items ?? []) as IxSkillItem[]
    const out = suggestSkills(catalog, { activeSkillIds: [], composerText: 'break down our aws cloud costs' })

    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThanOrEqual(MAX_SKILL_SUGGESTIONS)
    expect(out.map(s => s.skill.id)).toContain('cloud-cost-review')
  })
})
