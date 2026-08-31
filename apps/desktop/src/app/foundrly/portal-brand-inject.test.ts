import { describe, expect, it, vi } from 'vitest'

import {
  applyFoundrlyPortalBrand,
  buildFoundrlyPortalBrandScript,
  FOUNDRLY_PORTAL_MARK_DATA_URI
} from './portal-brand-inject'

describe('Foundrly portal brand inject', () => {
  it('embeds Foundrly mark data URI and renames Intelli Verse copy', () => {
    const script = buildFoundrlyPortalBrandScript()
    expect(script).toContain(FOUNDRLY_PORTAL_MARK_DATA_URI.slice(0, 32))
    expect(script).toContain('Intelli')
    expect(script).toContain('Foundrly')
    expect(script).toContain('AI co-founder for local businesses.')
    expect(script).toContain('data-foundrly-mark')
  })

  it('calls insertCSS and executeJavaScript on the guest webview', async () => {
    const insertCSS = vi.fn(async () => 'css-key')
    const executeJavaScript = vi.fn(async () => true)

    await applyFoundrlyPortalBrand({ insertCSS, executeJavaScript })

    expect(insertCSS).toHaveBeenCalledOnce()
    expect(executeJavaScript).toHaveBeenCalledOnce()
    expect(String(executeJavaScript.mock.calls[0]?.[0])).toContain('Foundrly')
  })
})
