import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

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
    expect(downloadText).toContain('Desktop is the operator surface')
    expect(downloadText).toContain('trust.schemaVersion === 1')
    expect(downloadText).toContain('trust.channel?.sha512 === (await sha512Base64(manifestText))')
    expect(downloadText).toContain('artifact?.sha512 === file.sha512')
  })
})
