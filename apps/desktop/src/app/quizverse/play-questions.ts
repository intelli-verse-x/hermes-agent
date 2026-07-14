import type { PlayQuestion } from './play-store'

const CDN = 'https://intelli-verse-x-media.s3.us-east-1.amazonaws.com'
const TIMEOUT_MS = 6_000

const FALLBACK: PlayQuestion[] = [
  { correctIndex: 0, id: 'fallback-capital', options: ['Paris', 'London', 'Berlin', 'Madrid'], prompt: 'What is the capital of France?' },
  { correctIndex: 1, id: 'fallback-planet', options: ['Venus', 'Mars', 'Jupiter', 'Saturn'], prompt: 'Which planet is known as the Red Planet?' },
  { correctIndex: 2, id: 'fallback-continents', options: ['5', '6', '7', '8'], prompt: 'How many continents are there?' },
  { correctIndex: 1, id: 'fallback-mammal', options: ['Elephant', 'Blue whale', 'Giraffe', 'Polar bear'], prompt: 'What is the largest mammal?' },
  { correctIndex: 2, id: 'fallback-gold', options: ['Go', 'Gd', 'Au', 'Ag'], prompt: 'What is the chemical symbol for gold?' },
  { correctIndex: 3, id: 'fallback-ocean', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], prompt: 'Which ocean is the largest?' },
  { correctIndex: 2, id: 'fallback-prime', options: ['0', '1', '2', '3'], prompt: 'What is the smallest prime number?' },
  { correctIndex: 1, id: 'fallback-hexagon', options: ['5', '6', '7', '8'], prompt: 'How many sides does a hexagon have?' },
  { correctIndex: 2, id: 'fallback-water', options: ['50', '75', '100', '150'], prompt: 'At sea level, water boils at how many °C?' },
  { correctIndex: 1, id: 'fallback-math', options: ['54', '56', '63', '48'], prompt: 'What is 7 × 8?' }
]

function utcDate(offset = 0) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offset)

  return date.toISOString().slice(0, 10)
}

function monthAnchor(offset = 0) {
  const date = new Date()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + offset)

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`
}

async function json(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })

    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

function options(raw: Record<string, unknown>): string[] {
  const value = raw.options ?? raw.choices

  return Array.isArray(value)
    ? value.map(item =>
        typeof item === 'object' && item
          ? String((item as Record<string, unknown>).text ?? (item as Record<string, unknown>).option ?? '')
          : String(item)
      )
    : []
}

export function normalizePlayQuestions(payload: unknown): PlayQuestion[] {
  const source = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ((payload as Record<string, unknown>).questions ??
        (payload as Record<string, unknown>).items ??
        (payload as Record<string, unknown>).data ??
        [])
      : []

  if (!Array.isArray(source)) {
    return []
  }

  return source.flatMap((item, index) => {
    const raw = (item ?? {}) as Record<string, unknown>
    const answerOptions = options(raw)
    const prompt = String(raw.prompt ?? raw.question ?? raw.questionText ?? raw.text ?? '').trim()
    const explicit = raw.correctIndex ?? raw.correct_index ?? raw.correct_answer ?? raw.correctAnswer
    const answer = raw.answer ?? raw.correct

    const correctIndex =
      typeof explicit === 'number'
        ? explicit
        : typeof answer === 'number'
          ? answer
          : answerOptions.findIndex(option => option.toLowerCase() === String(answer ?? '').toLowerCase())

    if (!prompt || answerOptions.length < 2 || correctIndex < 0 || correctIndex >= answerOptions.length) {
      return []
    }

    return [{
      correctIndex,
      explanation: String(raw.explanation ?? ''),
      id: String(raw.id ?? raw.questionId ?? raw.question_id ?? `question-${index}`),
      mediaUrl: String(raw.mediaUrl ?? raw.media_url ?? raw.image ?? raw.audio ?? raw.video ?? '') || undefined,
      options: answerOptions,
      prompt
    }]
  })
}

export async function dailyPool(daysBack = 4): Promise<PlayQuestion[]> {
  for (let day = 0; day <= daysBack; day += 1) {
    const document = (await json(`${CDN}/quiz-verse/daily/dailyquiz-${utcDate(-day)}.json`)) as
      | { questions?: unknown[]; today_quiz?: { questions?: unknown[] } }
      | null

    const questions = normalizePlayQuestions(document?.today_quiz?.questions ?? document?.questions ?? [])

    if (questions.length) {
      return questions
    }
  }

  return []
}

export async function premiumPool(language = 'en'): Promise<PlayQuestion[]> {
  for (let day = 0; day <= 4; day += 1) {
    const document = (await json(`${CDN}/quiz-verse/daily/dailyquiz-prem-${language}-${utcDate(-day)}.json`)) as
      | { premium_questions?: unknown[] }
      | null

    const questions = normalizePlayQuestions(document?.premium_questions ?? [])

    if (questions.length) {
      return questions
    }
  }

  return dailyPool()
}

export async function bankPool(language = 'en'): Promise<PlayQuestion[]> {
  for (let month = 0; month <= 6; month += 1) {
    const document = (await json(
      `${CDN}/quiz-verse/question-bank/${monthAnchor(-month)}/${language}/questions.json`
    )) as { questions?: unknown[] } | null

    const questions = normalizePlayQuestions(document?.questions ?? [])

    if (questions.length) {
      return questions
    }
  }

  return []
}

export async function viralPool(): Promise<PlayQuestion[]> {
  const documents = await Promise.all(
    Array.from({ length: 14 }, (_, day) => json(`${CDN}/quiz-verse/daily/dailyquiz-${utcDate(-day)}.json`))
  )

  return documents.flatMap(document => {
    const value = document as { questions?: unknown[]; today_quiz?: { questions?: unknown[] } } | null

    return normalizePlayQuestions(value?.today_quiz?.questions ?? value?.questions ?? [])
  })
}

export function bundledFallback(count: number): PlayQuestion[] {
  return FALLBACK.slice(0, Math.max(1, Math.min(count, FALLBACK.length)))
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function shuffled<T>(values: T[]): T[] {
  const copy = [...values]

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))

    ;[copy[index], copy[target]] = [copy[target], copy[index]]
  }

  return copy
}

interface ExternalCard {
  image?: string
  label: string
}

function externalCards(provider: string, payload: unknown): ExternalCard[] {
  const data = (payload ?? {}) as Record<string, any>
  const titleCase = (value: string) => value.replace(/(^|[\s-])([a-z])/g, (_match, prefix, letter) => prefix + letter.toUpperCase())
  const adapters: Record<string, () => ExternalCard[]> = {
    countries: () => asArray(payload).map(item => {
      const country = item as Record<string, any>

      return { image: string(country.flags?.png ?? country.flags?.svg), label: string(country.name?.common) }
    }),
    disney: () => asArray(data.data).map(item => {
      const character = item as Record<string, any>

      return { image: string(character.imageUrl), label: string(character.name) }
    }),
    dog: () => asArray(data.message).map(item => {
      const image = string(item)
      const token = image.split('/breeds/')[1]?.split('/')[0] ?? ''

      return { image, label: token.split('-').reverse().map(value => titleCase(value)).join(' ') }
    }),
    ghibli: () => asArray(payload).map(item => {
      const film = item as Record<string, any>

      return { image: string(film.image ?? film.movie_banner), label: string(film.title) }
    }),
    jikan: () => asArray(data.data).map(item => {
      const anime = item as Record<string, any>

      return {
        image: string(anime.images?.jpg?.large_image_url ?? anime.images?.jpg?.image_url ?? anime.images?.webp?.image_url),
        label: string(anime.title_english ?? anime.title)
      }
    }),
    nasa: () => asArray(data.collection?.items).map(item => {
      const entry = item as Record<string, any>

      return {
        image: string((asArray(entry.links)[0] as Record<string, unknown>)?.href),
        label: string((asArray(entry.data)[0] as Record<string, unknown>)?.title)
      }
    }),
    pokeapi: () => asArray(data.results).map(item => {
      const pokemon = item as Record<string, any>
      const id = /\/pokemon\/(\d+)\/?$/.exec(string(pokemon.url))?.[1]

      return {
        image: id ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png` : undefined,
        label: titleCase(string(pokemon.name))
      }
    }),
    sports: () => asArray(data.teams).map(item => {
      const team = item as Record<string, any>

      return { image: string(team.strBadge ?? team.strTeamBadge), label: string(team.strTeam) }
    }),
    themealdb: () => asArray(data.meals).map(item => {
      const meal = item as Record<string, any>

      return { image: string(meal.strMealThumb), label: string(meal.strMeal) }
    })
  }

  return (adapters[provider]?.() ?? []).filter(card => card.label && card.image)
}

export function externalToPlayQuestions(provider: string, payload: unknown, count: number): PlayQuestion[] {
  if (provider === 'news') {
    const articles = asArray((payload as Record<string, unknown>)?.articles)
      .map(item => item as Record<string, unknown>)
      .filter(item => string(item.title) && string(item.imageUrl ?? item.image))
    const titles = articles.map(item => string(item.title))

    return shuffled(articles).slice(0, count).map((article, index) => {
      const correct = string(article.title)
      const answerOptions = shuffled([correct, ...shuffled(titles.filter(title => title !== correct)).slice(0, 3)])

      return {
        correctIndex: answerOptions.indexOf(correct),
        id: `news-${index}-${correct.slice(0, 20)}`,
        mediaUrl: string(article.imageUrl ?? article.image),
        options: answerOptions,
        prompt: 'Which headline matches this image?'
      }
    }).filter(question => question.options.length === 4)
  }

  if (provider === 'starwars') {
    const people = asArray((payload as Record<string, unknown>)?.results)
      .map(item => item as Record<string, unknown>)
      .filter(item => string(item.name) && string(item.eye_color) && string(item.eye_color) !== 'unknown')
    const colors = [...new Set(people.map(person => string(person.eye_color)))]

    return shuffled(people).slice(0, count).flatMap((person, index) => {
      const correct = string(person.eye_color)
      const answerOptions = shuffled([correct, ...shuffled(colors.filter(color => color !== correct)).slice(0, 3)])

      return answerOptions.length === 4
        ? [{
            correctIndex: answerOptions.indexOf(correct),
            id: `starwars-${index}-${string(person.name)}`,
            options: answerOptions,
            prompt: `What colour are ${string(person.name)}'s eyes?`
          }]
        : []
    })
  }

  const cards = externalCards(provider, payload)
  const labels = cards.map(card => card.label)
  const prompts: Record<string, string> = {
    countries: 'Which country does this flag belong to?',
    disney: 'Which Disney character is this?',
    dog: 'Which dog breed is this?',
    ghibli: 'Which Studio Ghibli film is this?',
    jikan: 'Which anime is this?',
    nasa: 'What is shown in this image?',
    pokeapi: "Who's that Pokémon?",
    sports: "Which club's badge is this?",
    themealdb: 'Which dish is this?'
  }

  return shuffled(cards).slice(0, count).flatMap((card, index) => {
    const answerOptions = shuffled([card.label, ...shuffled(labels.filter(label => label !== card.label)).slice(0, 3)])

    return answerOptions.length === 4
      ? [{
          correctIndex: answerOptions.indexOf(card.label),
          id: `${provider}-${index}-${card.label.slice(0, 20)}`,
          mediaUrl: card.image,
          options: answerOptions,
          prompt: prompts[provider] ?? 'Identify the image'
        }]
      : []
  })
}

export function isoWeekParts(date = new Date()): { isoDay: number; isoWeek: number; isoYear: number } {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const isoDay = value.getUTCDay() || 7

  value.setUTCDate(value.getUTCDate() + 4 - isoDay)
  const isoYear = value.getUTCFullYear()
  const yearStart = Date.UTC(isoYear, 0, 1)
  const isoWeek = Math.ceil(((value.getTime() - yearStart) / 86_400_000 + 1) / 7)

  return { isoDay, isoWeek, isoYear }
}

export function dedupePlayQuestions(questions: PlayQuestion[], seen: ReadonlySet<string>): PlayQuestion[] {
  const unseen = questions.filter(question => !seen.has(question.id))

  return unseen.length ? unseen : questions
}

export function inlineQuestions(questions: PlayQuestion[]) {
  return questions.map(question => ({
    correct_index: question.correctIndex,
    explanation: question.explanation,
    id: question.id,
    media_url: question.mediaUrl,
    options: question.options,
    question: question.prompt
  }))
}
