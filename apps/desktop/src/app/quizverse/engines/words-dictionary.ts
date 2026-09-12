import { loadWordsDataset } from './words-content'

export type WordsDictionaryKind = 'guess-5' | 'spell'

const memory = new Map<WordsDictionaryKind, ReadonlySet<string>>()

export function withWordsFallback(dictionary: ReadonlySet<string>, fallback: readonly string[]): ReadonlySet<string> {
  const merged = new Set(dictionary)

  for (const word of fallback) {
    merged.add(word.toUpperCase())
  }

  return merged
}

export function normalizeWordsDictionary(value: unknown, kind: WordsDictionaryKind, minimumItems: number): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    value = (value as { items?: unknown; words?: unknown }).words ?? (value as { items?: unknown }).items
  }

  if (!Array.isArray(value)) {
    throw new Error('Words dictionary response is malformed')
  }

  const pattern = kind === 'guess-5' ? /^[A-Z]{5}$/ : /^[A-Z]{4,}$/
  const words: string[] = []
  const seen = new Set<string>()

  for (const raw of value) {
    if (typeof raw !== 'string') {
      throw new Error('Words dictionary contains a non-string item')
    }

    const word = raw.toUpperCase()

    if (!pattern.test(word)) {
      throw new Error(`Words dictionary contains an invalid ${kind} item`)
    }

    if (seen.has(word)) {
      throw new Error('Words dictionary contains duplicate items')
    }

    seen.add(word)
    words.push(word)
  }

  if (!Number.isInteger(minimumItems) || minimumItems < 1 || words.length < minimumItems) {
    throw new Error('Words dictionary response is incomplete')
  }

  return words
}

export async function loadWordsDictionary(
  kind: WordsDictionaryKind,
  fallback: readonly string[]
): Promise<ReadonlySet<string>> {
  const loaded = memory.get(kind)

  if (loaded) {
    const merged = withWordsFallback(loaded, fallback)
    memory.set(kind, merged)

    return merged
  }

  try {
    const loadedDataset = await loadWordsDataset<unknown>(kind === 'guess-5' ? 'guess-5' : 'spell-dictionary', 'shared')

    const words = normalizeWordsDictionary(loadedDataset.data, kind, loadedDataset.minimumItems)
    const result = withWordsFallback(new Set(words), fallback)
    memory.set(kind, result)

    return result
  } catch {
    const result = withWordsFallback(new Set(), fallback)
    memory.set(kind, result)

    return result
  }
}
