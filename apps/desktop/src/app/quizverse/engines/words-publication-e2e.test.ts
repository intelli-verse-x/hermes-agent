import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parseWordsContentManifest } from './words-content'
import { normalizeWordsDictionary, withWordsFallback } from './words-dictionary'

const require = createRequire(import.meta.url)
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../../Quizverse-web-frontend/web')
const catalogPath = path.join(webRoot, 'lib/words-content/catalog.cjs')

// This suite validates the ACTUAL published Words artifacts, so it needs the
// Quizverse-web-frontend checkout as a sibling of this repo. Worktrees and CI
// runners without that checkout skip instead of failing at module load.
const catalogAvailable = fs.existsSync(catalogPath)

const { buildWordsCatalog } = (catalogAvailable ? require(catalogPath) : { buildWordsCatalog: () => null }) as {
  buildWordsCatalog: (options?: { publicDir: string }) => {
    datasets: Array<{ items: unknown[]; kind: string; min_items: number; skin: string }>
    manifest: unknown
  }
}

describe.skipIf(!catalogAvailable)('published Words artifacts through Desktop contracts', () => {
  it('parses the actual web manifest and accepts its authored dictionaries', () => {
    const catalog = buildWordsCatalog({ publicDir: path.join(webRoot, 'public') })
    const manifest = parseWordsContentManifest(catalog.manifest)

    for (const kind of ['guess-5', 'spell-dictionary'] as const) {
      const descriptor = manifest.datasets.find(item => item.kind === kind && item.skin === 'shared')
      const dataset = catalog.datasets.find(item => item.kind === kind && item.skin === 'shared')

      expect(descriptor).toBeDefined()
      expect(dataset).toBeDefined()
      expect(
        normalizeWordsDictionary(dataset!.items, kind === 'guess-5' ? 'guess-5' : 'spell', descriptor!.min_items)
      ).toHaveLength(dataset!.items.length)
    }
  })

  it('keeps every published daily and Spell answer accepted', () => {
    const catalog = buildWordsCatalog({ publicDir: path.join(webRoot, 'public') })
    const guesses = new Set(catalog.datasets.find(item => item.kind === 'guess-5')!.items as string[])
    const spellWords = new Set(catalog.datasets.find(item => item.kind === 'spell-dictionary')!.items as string[])

    for (const dataset of catalog.datasets.filter(item => item.kind === 'daily-solutions')) {
      for (const answer of dataset.items as string[]) {
        expect(guesses.has(answer), `${dataset.skin} daily answer ${answer}`).toBe(true)
      }
    }

    for (const dataset of catalog.datasets.filter(item => item.kind === 'spell-puzzles')) {
      for (const raw of dataset.items) {
        const puzzle = raw as { pangram: string; words: string[] }

        for (const answer of [...puzzle.words, puzzle.pangram]) {
          expect(spellWords.has(answer), `${dataset.skin} Spell answer ${answer}`).toBe(true)
        }
      }
    }
  })

  it('still rejects malformed authored dictionaries', () => {
    expect(() => normalizeWordsDictionary(['ALPHA', 'ALPHA'], 'guess-5', 1)).toThrow(/duplicate/)
    expect(() => normalizeWordsDictionary(['ALPHA', 42], 'guess-5', 1)).toThrow(/non-string/)
    expect(() => normalizeWordsDictionary(['TOO-LONG'], 'guess-5', 1)).toThrow(/invalid/)
    expect(() => normalizeWordsDictionary(['ALPHA'], 'guess-5', 2)).toThrow(/incomplete/)
  })

  it('accumulates authoritative fallbacks across offline daily and puzzle changes', () => {
    const general = withWordsFallback(new Set<string>(), ['ALPHA'])
    const gre = withWordsFallback(general, ['ABASE'])

    expect([...gre]).toEqual(['ALPHA', 'ABASE'])
  })
})
