export interface DailyContent<T> {
  date: string
  index: number
  seed: number
  value: T
}

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

/** FNV-1a 32-bit, matching the Words and Voyage web clients. */
export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

export function dailyContent<T>(
  namespace: string,
  values: readonly T[],
  date = new Date(),
  salt = 'en'
): DailyContent<T> {
  if (values.length === 0) {
    throw new Error('Daily content requires at least one value')
  }

  const day = utcDay(date)
  const seed = fnv1a32(`${day}:${namespace}:${salt}`)
  const index = seed % values.length

  return { date: day, index, seed, value: values[index]! }
}

export function seededShuffle<T>(values: readonly T[], seed: number): T[] {
  const result = [...values]
  let state = seed >>> 0

  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0

    const swap = state % (index + 1)

    ;[result[index], result[swap]] = [result[swap]!, result[index]!]
  }

  return result
}
