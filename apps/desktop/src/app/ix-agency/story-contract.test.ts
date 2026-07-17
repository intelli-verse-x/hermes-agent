import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const source = readFileSync(path.join(process.cwd(), 'src/app/ix-agency/index.tsx'), 'utf8')

describe('IVX Agency ecosystem story', () => {
  it('explains the client isolation and consent boundary', () => {
    expect(source).toContain('Three native engines, one shared Memory')
    expect(source).toContain('one Brand or App ID')
    expect(source).toContain('Subject identity and consent')
  })

  it('uses precise per-engine availability labels', () => {
    expect(source).toContain('connected per-App setup')
    expect(source).toContain('Memory automation rolling out')
    expect(source).toContain('connected deployment')
    expect(source).toContain('kiosk Worlds approved pilots')
  })

  it('keeps unimplemented agency workflows roadmap-honest', () => {
    expect(source).toContain('Discount-code and payout review workflows are roadmap')
    expect(source).toContain('named role administration remains roadmap')
    expect(source).not.toMatch(/discount codes are issued/i)
    expect(source).not.toMatch(/payouts are tracked per campaign/i)
  })

  it('links to the attributed connected-engine setup path', () => {
    expect(source).toContain('router.intelli-verse-x.ai/apps')
    expect(source).toContain('utm_source=ivx-agency-desktop')
    expect(source).toContain('utm_campaign=native_engines')
    expect(source).toContain('intent=agency-connected-engine-pilot')
    expect(source).toContain('Request an agency connected-engine pilot')
  })
})
