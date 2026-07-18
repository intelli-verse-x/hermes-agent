import { beforeEach, describe, expect, it } from 'vitest'

import { IS_IX_AGENCY_BRAND } from '@/lib/brand'

import {
  applyTheme,
  DEFAULT_THEME_MODE,
  getBaseColors,
  modePref,
  normalizeMode
} from './context'
import { DEFAULT_SKIN_NAME } from './presets'

describe('IX Agency dark mode defaults (EVALS D1/D3/D4/D6)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
    document.documentElement.removeAttribute('data-hermes-mode')
    document.documentElement.style.cssText = ''
  })

  it('D1: unset / junk mode normalizes to brand default (dark for IX)', () => {
    expect(IS_IX_AGENCY_BRAND).toBe(true)
    expect(DEFAULT_THEME_MODE).toBe('dark')
    expect(normalizeMode(null)).toBe('dark')
    expect(normalizeMode('')).toBe('dark')
    expect(normalizeMode('dusk')).toBe('dark')
    expect(modePref.resolve('default')).toBe('dark')
  })

  it('D6: explicit light/dark/system round-trip through modePref', () => {
    modePref.assign('work', 'light')
    expect(modePref.resolve('work')).toBe('light')
    modePref.assign('work', 'dark')
    expect(modePref.resolve('work')).toBe('dark')
    modePref.assign('work', 'system')
    expect(modePref.resolve('work')).toBe('system')
  })

  it('D3: applyTheme(dark) sets .dark + dark CSS vars', () => {
    const colors = getBaseColors(DEFAULT_SKIN_NAME, 'dark')
    applyTheme(
      {
        name: `${DEFAULT_SKIN_NAME}-dark`,
        label: 'Dark',
        description: 'test',
        colors
      },
      'dark'
    )
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.hermesMode).toBe('dark')
    expect(document.documentElement.style.getPropertyValue('--theme-background-seed')).toBe(colors.background)
    expect(colors.background.toLowerCase()).not.toBe('#ffffff')
  })

  it('D4: applyTheme(light) clears .dark and uses light vars', () => {
    const darkColors = getBaseColors(DEFAULT_SKIN_NAME, 'dark')
    applyTheme(
      {
        name: `${DEFAULT_SKIN_NAME}-dark`,
        label: 'Dark',
        description: 'test',
        colors: darkColors
      },
      'dark'
    )
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    const lightColors = getBaseColors(DEFAULT_SKIN_NAME, 'light')
    applyTheme(
      {
        name: `${DEFAULT_SKIN_NAME}-light`,
        label: 'Light',
        description: 'test',
        colors: lightColors
      },
      'light'
    )
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.dataset.hermesMode).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--theme-background-seed')).toBe(lightColors.background)
  })
})
