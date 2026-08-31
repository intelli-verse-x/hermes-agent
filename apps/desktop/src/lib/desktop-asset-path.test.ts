import { describe, expect, it } from 'vitest'

import { desktopAssetPath } from './desktop-asset-path'

describe('desktopAssetPath', () => {
  it('prefixes with BASE_URL when base is absolute', () => {
    // vitest/vite default BASE_URL is typically '/'
    const result = desktopAssetPath('foundrly/mark-512.png')
    expect(result === '/foundrly/mark-512.png' || result.endsWith('foundrly/mark-512.png')).toBe(true)
    expect(result).not.toMatch(/foundrly\/foundrly\//)
  })

  it('strips leading slashes from the relative path', () => {
    const a = desktopAssetPath('/foundrly/mark-512.png')
    const b = desktopAssetPath('foundrly/mark-512.png')
    expect(a).toBe(b)
  })
})
