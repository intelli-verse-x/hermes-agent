import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const desktopRoot = process.cwd()

function readPublicSource(relativePath: string): string {
  return readdirSync(path.join(desktopRoot, relativePath), { withFileTypes: true })
    .flatMap(entry => {
      const child = path.join(relativePath, entry.name)

      if (entry.isDirectory()) {
        return readPublicSource(child)
      }

      return /\.(?:html|json|tsx?)$/.test(entry.name) && !entry.name.includes('.test.')
        ? readFileSync(path.join(desktopRoot, child), 'utf8')
        : []
    })
    .join('\n')
}

describe('QuizVerse public desktop story', () => {
  it('does not ship retired blockchain or NFT game modes', () => {
    const source = readPublicSource('src/app/quizverse')

    expect(source).not.toMatch(/\bblockchain\b/i)
    expect(source).not.toMatch(/\bNFTs?\b/i)
  })
})
