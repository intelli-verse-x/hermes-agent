import { BRAND_NAME } from '@/lib/brand'

import { en } from './en'
import { ja } from './ja'
import type { Locale, Translations } from './types'
import { zh } from './zh'
import { zhHant } from './zh-hant'

// Locale files never hardcode the product name — they carry a `{brandName}`
// token so one catalog serves every build flavor (IX Agency, QuizVerse, …).
// The token is resolved once at module load: plain strings are substituted
// eagerly, translation functions are wrapped so their output is substituted
// per call. Arrays and nested sections are walked recursively.
const BRAND_TOKEN = '{brandName}'

function brandString(value: string): string {
  return value.includes(BRAND_TOKEN) ? value.replaceAll(BRAND_TOKEN, BRAND_NAME) : value
}

function brandValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return brandString(value)
  }

  if (typeof value === 'function') {
    const fn = value as (...args: unknown[]) => string

    return (...args: unknown[]) => brandString(fn(...args))
  }

  if (Array.isArray(value)) {
    return value.map(brandValue)
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, brandValue(entry)]))
  }

  return value
}

function brandTranslations(catalog: Translations): Translations {
  return brandValue(catalog) as Translations
}

export const TRANSLATIONS: Record<Locale, Translations> = {
  en: brandTranslations(en),
  zh: brandTranslations(zh),
  'zh-hant': brandTranslations(zhHant),
  ja: brandTranslations(ja)
}
