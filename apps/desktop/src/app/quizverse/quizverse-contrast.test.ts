import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const quizverseRoot = resolve(process.cwd(), 'src/app/quizverse')
const css = readFileSync(resolve(quizverseRoot, 'quizverse-surface.css'), 'utf8')
const view = readFileSync(resolve(quizverseRoot, 'index.tsx'), 'utf8')
const arcade = readFileSync(resolve(quizverseRoot, 'arcade-tab.tsx'), 'utf8')
const nativeTutor = readFileSync(resolve(quizverseRoot, 'native-tutor.tsx'), 'utf8')
const preload = readFileSync(resolve(process.cwd(), 'electron/preload.ts'), 'utf8')
const bundleScript = readFileSync(resolve(process.cwd(), 'scripts/bundle-electron-main.mjs'), 'utf8')

function token(name: string) {
  const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]

  expect(value, `missing --${name}`).toBeDefined()

  return value!
}

function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map(value => Number.parseInt(value, 16) / 255)

  const [red, green, blue] = channels.map(value =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  )

  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

function contrast(foreground: string, background: string) {
  const light = Math.max(luminance(foreground), luminance(background))
  const dark = Math.min(luminance(foreground), luminance(background))

  return (light + 0.05) / (dark + 0.05)
}

describe('QuizVerse contrast contract', () => {
  it('meets WCAG contrast for text and UI token pairs', () => {
    const canvas = token('qv-canvas')
    const surface = token('qv-surface')

    expect(contrast(token('qv-foreground'), canvas)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token('qv-muted-foreground'), canvas)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token('qv-foreground'), surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token('qv-muted-foreground'), surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token('qv-border'), canvas)).toBeGreaterThanOrEqual(3)
    expect(contrast(token('qv-focus'), canvas)).toBeGreaterThanOrEqual(3)
  })

  it('keeps mesh decoration behind an opaque scoped workspace', () => {
    const workspaceRule = css.match(/\.qv-workspace\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const meshRule = css.match(/\.qv-workspace \.bg-quizverse-mesh\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

    expect(view).toContain('className={`qv-workspace ')
    expect(workspaceRule).toContain('background: var(--qv-canvas)')
    expect(`${workspaceRule}\n${meshRule}`).not.toMatch(/(?:^|[;\s])(?:filter|mix-blend-mode|opacity)\s*:/m)
    expect(css).toContain('.qv-workspace .bg-quizverse-mesh::before')
    expect(css).toContain('.qv-workspace .bg-quizverse-mesh > *')
  })

  it('scopes every QuizVerse surface selector to its workspace', () => {
    const selectors = css.split('\n').filter(line => line.startsWith('.qv-') && line.includes('{'))

    expect(selectors.every(line => line.startsWith('.qv-workspace'))).toBe(true)
  })

  it('routes Arcade satellites through the native surface router', () => {
    expect(arcade).not.toMatch(/<webview|QvWebviewPane|document\.createElement\(['"]webview/)
    expect(arcade).toContain('NATIVE_SURFACES')
    expect(arcade).toContain('NativeSurfaceRouter')
  })

  it('has no frame renderer or retired QuizVerse webview IPC', () => {
    expect(nativeTutor).not.toMatch(/<iframe|srcDoc=/)
    expect(preload).not.toMatch(/quizverse:(?:surfaces|webview:preload-path|deep-link)/)
    expect(bundleScript).not.toContain("entryPoints: [resolve(root, 'electron/qv-webview-preload.ts')]")
    expect(bundleScript).toContain('Remove the retired guest webview preload')
  })
})
