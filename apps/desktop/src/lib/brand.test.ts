import { describe, expect, it } from 'vitest'

import ixAgencyBrand from '../../brands/ix-agency.json'
import quizverseBrand from '../../brands/quizverse.json'

import { BRAND, DESKTOP_BRAND_ID, IS_IX_AGENCY_BRAND, IS_QUIZVERSE_BRAND } from './brand'

// Invariants over the brand manifests — the contracts that keep two branded
// apps strictly separated (not snapshots of any one brand's current values).

const MANIFESTS = [ixAgencyBrand, quizverseBrand]

const IDENTITY_FIELDS = [
  'appId',
  'artifactPrefix',
  'executableName',
  'iconSha256',
  'productName',
  'protocolScheme',
  's3PublishPath',
  'updateFeedUrl'
] as const

describe('brand manifests', () => {
  it('every manifest carries a complete identity', () => {
    for (const manifest of MANIFESTS) {
      expect(manifest.id).toBeTruthy()

      for (const field of IDENTITY_FIELDS) {
        expect(manifest[field], `${manifest.id}.${field}`).toBeTruthy()
      }
    }
  })

  it('no identity value is shared between brands — separate userData, feeds, links', () => {
    for (const field of IDENTITY_FIELDS) {
      const values = MANIFESTS.map(manifest => manifest[field])

      expect(new Set(values).size, field).toBe(MANIFESTS.length)
    }
  })

  it('each brand publishes to its own S3 prefix and polls its own feed', () => {
    for (const manifest of MANIFESTS) {
      expect(manifest.updateFeedUrl.endsWith(`/${manifest.s3PublishPath}`), manifest.id).toBe(true)
    }
  })

  it('pins canonical icon assets and never uses the retired Hermes protocol', () => {
    for (const manifest of MANIFESTS) {
      expect(manifest.iconSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(manifest.protocolScheme).not.toBe('hermes')
    }
  })

  it('no brand borrows another brand’s download landing page', () => {
    // downloadPageUrl may be empty (→ direct artifact fallback), but a set
    // value must never be another brand's page — that is how a QuizVerse
    // user would end up on the IX Agency installer page.
    for (const manifest of MANIFESTS) {
      const others = MANIFESTS.filter(other => other.id !== manifest.id)

      for (const other of others) {
        if (manifest.downloadPageUrl) {
          expect(manifest.downloadPageUrl, manifest.id).not.toBe(other.downloadPageUrl)
        }
      }
    }
  })

  it('quizverse manifest declares TutorX without hosted surface navigation', () => {
    const qv = quizverseBrand.quizverse

    expect(qv.deeptutorRemoteUrl).toMatch(/^https:\/\//)
    expect(qv).not.toHaveProperty('subdomains')
  })
})

describe('active brand resolution', () => {
  it('resolves to exactly one brand and the flags agree with it', () => {
    expect(IS_IX_AGENCY_BRAND).not.toBe(IS_QUIZVERSE_BRAND)
    expect(BRAND.id).toBe(IS_QUIZVERSE_BRAND ? 'quizverse' : 'ix-agency')
    expect(BRAND.workspace).toBe(BRAND.id)
    expect(['ix-agency', 'quizverse']).toContain(DESKTOP_BRAND_ID)
  })
})
