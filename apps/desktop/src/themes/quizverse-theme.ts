import type { DesktopTheme } from './types'

const QV_LAP = {
  purpleDeep: '#5B21B6',
  purple: '#7C3AED',
  bgTop: '#2A1568',
  bgBottom: '#6B3FCE',
  surface: 'rgba(122, 99, 214, 0.14)',
  ctaStart: '#FBBF24',
  ctaEnd: '#F97316',
  ink: '#2A1568',
  muted: '#B9AEE6',
  gameBg: '#170138',
  gameSurface: '#241248'
} as const

const QV_ROBOTO = '"Roboto", system-ui, sans-serif'

/** QuizVerse — Link & Play audited tokens on a cosmic violet canvas. */
export const quizverseTheme: DesktopTheme = {
  name: 'quizverse',
  label: 'QuizVerse',
  description: 'LAP purple mesh with amber CTA accents',
  colors: {
    background: '#FAF8FF',
    foreground: '#17141F',
    card: '#FFFFFF',
    cardForeground: '#17141F',
    muted: 'rgba(122, 99, 214, 0.08)',
    mutedForeground: '#6B6478',
    popover: '#FFFFFF',
    popoverForeground: '#17141F',
    primary: QV_LAP.purpleDeep,
    primaryForeground: '#FCFCFC',
    secondary: 'rgba(122, 99, 214, 0.12)',
    secondaryForeground: QV_LAP.ink,
    accent: 'rgba(122, 99, 214, 0.16)',
    accentForeground: QV_LAP.ink,
    border: 'rgba(139, 92, 246, 0.22)',
    input: 'rgba(139, 92, 246, 0.28)',
    ring: QV_LAP.purple,
    midground: QV_LAP.purple,
    composerRing: QV_LAP.purpleDeep,
    destructive: '#C72E4D',
    destructiveForeground: '#FFFFFF',
    sidebarBackground: '#F6F3FF',
    sidebarBorder: 'rgba(139, 92, 246, 0.18)',
    userBubble: 'rgba(122, 99, 214, 0.1)',
    userBubbleBorder: 'rgba(139, 92, 246, 0.24)'
  },
  darkColors: {
    background: QV_LAP.gameBg,
    foreground: '#E8DFFF',
    card: QV_LAP.gameSurface,
    cardForeground: '#E8DFFF',
    muted: '#2E1857',
    mutedForeground: QV_LAP.muted,
    popover: '#1D1138',
    popoverForeground: '#E8DFFF',
    primary: '#C4B5FD',
    primaryForeground: QV_LAP.gameBg,
    secondary: '#31205C',
    secondaryForeground: '#DCD0FF',
    accent: '#3A2A66',
    accentForeground: '#EDE5FF',
    border: '#43307A',
    input: '#241547',
    ring: '#A78BFA',
    midground: QV_LAP.purple,
    composerRing: '#A78BFA',
    destructive: '#C0473A',
    destructiveForeground: '#FEF2F2',
    sidebarBackground: '#0E061F',
    sidebarBorder: '#2A1B4E',
    userBubble: '#231345',
    userBubbleBorder: '#43307A'
  },
  typography: {
    fontSans: `${QV_ROBOTO}`
  }
}
