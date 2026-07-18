import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

// jsdom ships without declarations in this workspace; the exercised surface is standard DOM.
// @ts-expect-error -- runtime dependency is present and covered by this browser-contract test.
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const desktopRoot = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(desktopRoot, relativePath), 'utf8')

const readTree = (relativePath: string): string =>
  readdirSync(path.join(desktopRoot, relativePath), { withFileTypes: true })
    .flatMap(entry => {
      const child = path.join(relativePath, entry.name)

      if (entry.isDirectory()) {
        return readTree(child)
      }

      return /\.(?:html|json|tsx?)$/.test(entry.name) && !entry.name.includes('.test.') ? read(child) : []
    })
    .join('\n')

const agencySource = readTree('src/app/ix-agency')
const indexSource = read('src/app/ix-agency/index.tsx')
const downloadSource = read('download-site/index.html')
const brandSource = read('brands/ix-agency.json')
const packageSource = read('package.json')

const releaseSigners = JSON.parse(read('release-signers.json')) as Record<
  string,
  { appleTeamId: string; windowsSignerSha256: string }
>

const compact = (source: string) => source.replace(/\s+/g, ' ')
const agencyText = compact(agencySource)
const downloadText = compact(downloadSource)
const indexText = compact(indexSource)

describe('IVX Agency ecosystem story', () => {
  it('explains the client isolation and consent boundary', () => {
    expect(indexText).toContain('Three native engines, one shared Memory')
    expect(indexText).toContain('one Brand or App ID')
    expect(indexText).toContain('Subject identity and consent')
  })

  it('uses precise per-engine availability labels', () => {
    expect(indexText).toContain('connected per-App setup')
    expect(indexText).toContain('Memory automation rolling out')
    expect(indexText).toContain('connected deployment')
    expect(indexText).toContain('kiosk Worlds approved pilots')
  })

  it('keeps unimplemented agency workflows roadmap-honest', () => {
    expect(indexText).toContain('Discount-code and payout review workflows are roadmap')
    expect(indexText).toContain('named-role administration panel remains roadmap')
    expect(agencySource).not.toMatch(/discount codes are issued/i)
    expect(agencySource).not.toMatch(/payouts are tracked per campaign/i)
  })

  it('links to the attributed connected-engine setup path', () => {
    expect(indexText).toContain('router.intelli-verse-x.ai/apps?intent=connected-engine-setup')
    expect(indexText).toContain('role=agency-operator&engine=all')
    expect(indexText).toContain('utm_source=ivx-agency-desktop')
    expect(indexText).toContain('utm_campaign=native_engines')
    expect(indexText).toContain('intent=agency-connected-engine-pilot')
    expect(indexText).toContain('intent=agency-connected-engine-pilot&role=agency-operator&engine=all')
    expect(indexText).toContain('Request an agency connected-engine pilot')
    expect(downloadText).toContain('utm_source=ivx-agency-download')
    expect(downloadText).toContain('utm_content=pre_download_setup')
    expect(downloadText).toContain('utm_content=post_download_pilot')
  })

  it('discloses local-only CRM and role boundaries', () => {
    expect(indexText).toContain('local to this device')
    expect(indexText).toContain('not synced platform records')
    expect(indexText).toContain('do not send invoices or process payments')
    expect(agencyText).toContain('does not send invoices or process payments')
    expect(agencyText).toContain('Desktop does not grant organization roles')
  })

  it('uses admin-authorized eligibility and a fallible setup story', () => {
    expect(agencyText).toContain('admin-authorized work email')
    expect(agencyText).toContain('Guided first-run checklist')
    expect(agencyText).toContain('Provisioning steps can fail independently')
    expect(downloadText).toContain('Provisioning is guided after sign-in')
    expect(downloadSource).not.toMatch(/everything else is automatic/i)
    expect(downloadSource).not.toMatch(/cognito secret\), connects/i)
  })

  it('does not instruct users to bypass operating-system trust controls', () => {
    expect(downloadText).toContain('do not bypass Gatekeeper, SmartScreen')
    expect(downloadSource).not.toContain('xattr -cr')
    expect(downloadSource).not.toMatch(/run anyway/i)
    expect(downloadSource).not.toMatch(/open anyway/i)
  })

  it('scopes credential and copilot security claims', () => {
    expect(agencyText).toContain('public OAuth app client')
    expect(agencyText).toContain('rotation and revocation')
    expect(agencyText).toContain('server-side authorization')
    expect(agencySource).not.toMatch(/writes always stop/i)
    expect(agencySource).not.toMatch(/nothing stays on disk/i)
    expect(agencySource).not.toMatch(/all attached automatically/i)
  })

  it('keeps package identity and required brand assets explicit', () => {
    expect(brandSource).toContain('"productName": "IVX Agency"')
    expect(brandSource).toContain('"copyright": "Copyright © 2026 Intelliverse X"')
    expect(brandSource).toContain('"protocolScheme": "ivx-agency"')
    expect(brandSource).toContain('"iconSha256":')
    expect(packageSource).toContain('"name": "@intelliverse-x/desktop"')
    expect(packageSource).toContain('"appId": "ai.intelli-verse-x.ix-agency"')
    expect(packageSource).toContain('"icon": "assets/icon"')
  })

  it('uses one public name and artifact-exact trust gating', () => {
    expect(downloadSource).not.toContain('IVX Admin Desktop')
    expect(downloadSource).not.toContain('#ivx-admin')
    expect(downloadText).toContain('Desktop is the operator surface')
    expect(downloadText).toContain('trust.schemaVersion === 1')
    expect(downloadText).toContain('trust.channel?.sha512 === (await sha512Base64(manifestText))')
    expect(downloadText).toContain('artifact?.sha512 === file.sha512')
    expect(downloadText).toContain('expectedSignerValid(os, brand.id, trust.verification?.signer)')
    expect(downloadText).toContain('actualId === teamId')
    expect(downloadText).toContain('actualId === certificateSha256')

    for (const [brandId, signer] of Object.entries(releaseSigners)) {
      expect(downloadText).toContain(
        `${brandId === 'ix-agency' ? "'ix-agency'" : brandId}: Object.freeze({ appleTeamId: '${signer.appleTeamId}', windowsSignerSha256: '${signer.windowsSignerSha256}' })`
      )
    }
  })

  it('captures and forwards bounded first-touch attribution', () => {
    expect(downloadText).toContain('new URLSearchParams(location.search)')
    expect(downloadText).toContain('localStorage.setItem(ATTRIBUTION_STORAGE_KEY')
    expect(downloadText).toContain('90 * 24 * 60 * 60 * 1000')

    for (const clickId of ['gclid', 'wbraid', 'gbraid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id', 'twclid']) {
      expect(downloadText).toContain(`'${clickId}'`)
    }

    expect(downloadText).toContain('target.searchParams.set(`first_${field}`, value)')
    expect(downloadText).toContain('target.searchParams.set(`hop_${field}`, value)')
    expect(downloadText).toContain("target.searchParams.set('attribution_id', firstTouch.attributionId)")
    expect(downloadText).toContain("target.pathname.includes('/team') ? 'request-agency-access' : 'agency-portal'")
    expect(downloadText).toContain('stores no credentials or entitlement')
  })

  it('persists inbound attribution and decorates access handoffs at runtime', () => {
    const dom = new JSDOM(downloadSource, {
      beforeParse(window: Window) {
        Object.defineProperty(window, 'fetch', {
          value: async () => ({ ok: false, status: 403 })
        })
      },
      runScripts: 'dangerously',
      url: 'https://intelliverse-x-desktop.s3.amazonaws.com/index.html?utm_source=partner&utm_medium=email&utm_campaign=launch&utm_content=cta&intent=agency-evaluation&role=agency-operator&engine=all&gclid=google-click&wbraid=web-braid&gbraid=app-braid&fbclid=meta-click&msclkid=microsoft-click&ttclid=tiktok-click&li_fat_id=linkedin-click&twclid=x-click'
    })

    const portal = dom.window.document.querySelector<HTMLAnchorElement>(
      'a[href^="https://admin.intelli-verse-x.ai/admin/portal"]'
    )

    const portalUrl = new URL(portal?.href || '')
    const stored = JSON.parse(dom.window.localStorage.getItem('ivx-desktop-download-first-touch-v1') || '{}')

    expect(stored.values).toEqual(
      expect.objectContaining({
        engine: 'all',
        intent: 'agency-evaluation',
        role: 'agency-operator',
        fbclid: 'meta-click',
        gbraid: 'app-braid',
        gclid: 'google-click',
        li_fat_id: 'linkedin-click',
        msclkid: 'microsoft-click',
        ttclid: 'tiktok-click',
        twclid: 'x-click',
        utm_campaign: 'launch',
        utm_content: 'cta',
        utm_medium: 'email',
        utm_source: 'partner',
        wbraid: 'web-braid'
      })
    )
    expect(stored.attributionId).toMatch(/^(desktop-|[0-9a-f]{8}-)/)
    expect(portalUrl.searchParams.get('first_utm_source')).toBe('partner')
    expect(portalUrl.searchParams.get('first_intent')).toBe('agency-evaluation')
    expect(portalUrl.searchParams.get('first_gclid')).toBe('google-click')
    expect(portalUrl.searchParams.get('first_wbraid')).toBe('web-braid')
    expect(portalUrl.searchParams.get('first_gbraid')).toBe('app-braid')
    expect(portalUrl.searchParams.get('first_fbclid')).toBe('meta-click')
    expect(portalUrl.searchParams.get('first_msclkid')).toBe('microsoft-click')
    expect(portalUrl.searchParams.get('first_ttclid')).toBe('tiktok-click')
    expect(portalUrl.searchParams.get('first_li_fat_id')).toBe('linkedin-click')
    expect(portalUrl.searchParams.get('first_twclid')).toBe('x-click')
    expect(portalUrl.searchParams.get('attribution_id')).toBe(stored.attributionId)
    expect(portalUrl.searchParams.get('hop_utm_source')).toBe('ivx-agency-download')
    expect(portalUrl.searchParams.get('hop_intent')).toBe('agency-portal')
    expect(portalUrl.searchParams.get('hop_role')).toBe('agency-operator')
    expect(portalUrl.searchParams.get('hop_engine')).toBe('all')
    expect(portalUrl.searchParams.get('intent')).toBe('agency-portal')

    const handoffs = [
      'a[href*="admin.intelli-verse-x.ai/admin/team"]',
      'a[href*="router.intelli-verse-x.ai/apps"]',
      'a[href*="router.intelli-verse-x.ai/demo"]',
      'a[href*="quizverse.world"]'
    ]

    for (const selector of handoffs) {
      const link = dom.window.document.querySelector<HTMLAnchorElement>(selector)
      const target = new URL(link?.href || '')

      expect(target.searchParams.get('attribution_id')).toBe(stored.attributionId)
      expect(target.searchParams.get('first_gclid')).toBe('google-click')
      expect(target.searchParams.get('first_fbclid')).toBe('meta-click')
      expect(target.searchParams.get('first_msclkid')).toBe('microsoft-click')
      expect(target.searchParams.get('first_li_fat_id')).toBe('linkedin-click')
      expect(target.searchParams.get('hop_utm_source')).toBe('ivx-agency-download')
      expect(target.searchParams.get('hop_intent')).toBeTruthy()
      expect(target.searchParams.get('hop_role')).toBeTruthy()
      expect(target.searchParams.get('hop_engine')).toBeTruthy()
    }
  })

  it('prefers inbound first-touch aliases over the immediate hop', () => {
    const dom = new JSDOM(downloadSource, {
      beforeParse(window: Window) {
        Object.defineProperty(window, 'fetch', {
          value: async () => ({ ok: false, status: 403 })
        })
      },
      runScripts: 'dangerously',
      url: 'https://intelliverse-x-desktop.s3.amazonaws.com/index.html?utm_source=router&utm_medium=referral&utm_campaign=native_engines&utm_content=desktop_handoff&intent=desktop-download&role=agency-operator&engine=all&gclid=immediate-google&first_utm_source=paid-search&first_utm_medium=cpc&first_utm_campaign=launch&first_utm_content=original-ad&first_intent=agency-evaluation&first_role=buyer&first_engine=questx&first_gclid=original-google&first_wbraid=original-wbraid&first_gbraid=original-gbraid&first_fbclid=original-meta&first_msclkid=original-microsoft&first_ttclid=original-tiktok&first_li_fat_id=original-linkedin&first_twclid=original-x&attribution_id=upstream-attribution-id'
    })

    const stored = JSON.parse(dom.window.localStorage.getItem('ivx-desktop-download-first-touch-v1') || '{}')

    const portal = dom.window.document.querySelector<HTMLAnchorElement>(
      'a[href^="https://admin.intelli-verse-x.ai/admin/portal"]'
    )

    const portalUrl = new URL(portal?.href || '')

    expect(stored.attributionId).toBe('upstream-attribution-id')
    expect(stored.values).toEqual(
      expect.objectContaining({
        engine: 'questx',
        fbclid: 'original-meta',
        gclid: 'original-google',
        intent: 'agency-evaluation',
        li_fat_id: 'original-linkedin',
        msclkid: 'original-microsoft',
        role: 'buyer',
        ttclid: 'original-tiktok',
        twclid: 'original-x',
        utm_campaign: 'launch',
        utm_content: 'original-ad',
        utm_medium: 'cpc',
        utm_source: 'paid-search'
      })
    )
    expect(portalUrl.searchParams.get('first_utm_source')).toBe('paid-search')
    expect(portalUrl.searchParams.get('first_gclid')).toBe('original-google')
    expect(portalUrl.searchParams.get('gclid')).toBe('original-google')
    expect(portalUrl.searchParams.get('utm_source')).toBe('ivx-agency-download')
    expect(portalUrl.searchParams.get('hop_utm_source')).toBe('ivx-agency-download')
    expect(portalUrl.searchParams.get('attribution_id')).toBe('upstream-attribution-id')
  })
})
