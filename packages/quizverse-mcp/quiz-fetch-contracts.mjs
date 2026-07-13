const WEEKLY_TYPES = ['fortune', 'emoji', 'prediction', 'health', 'personal_finance']
const QUESTION_TYPES = ['mcq', 'true_false', 'image', 'audio', 'video', 'connection', 'subjective']
const EXTERNAL_PROVIDERS = [
  'jikan', 'pokeapi', 'themealdb', 'ghibli', 'countries',
  'disney', 'nasa', 'starwars', 'dog', 'sports'
]

const string = (extra = {}) => ({ type: 'string', ...extra })
const integer = (minimum, maximum) => ({ maximum, minimum, type: 'integer' })
const array = (items, extra = {}) => ({ items, type: 'array', ...extra })
const object = (properties, required = []) => ({
  additionalProperties: false,
  properties,
  required,
  type: 'object'
})
// Raw third-party APIs evolve independently. Unknown fields are accepted only
// inside this explicitly versioned boundary, then discarded by the adapter.
const extensionObject = (version, properties, required = []) => ({
  ...object(properties, required),
  additionalProperties: true,
  extensionVersion: version
})
const upstreamObject = (properties, required = []) =>
  extensionObject('provider-raw-v1', properties, required)

const inlineQuestion = object({
  correct_index: integer(0),
  explanation: string(),
  id: string({ minLength: 1 }),
  media_url: string(),
  options: array(string(), { minItems: 2 }),
  question: string({ minLength: 1 }),
  topic: string()
}, ['id', 'question', 'options', 'correct_index'])
const indexedAnswerQuestion = object({
  answer: integer(0),
  explanation: string(),
  id: string({ minLength: 1 }),
  media_url: string(),
  options: array(string(), { minItems: 2 }),
  question: string({ minLength: 1 }),
  topic: string()
}, ['id', 'question', 'options', 'answer'])
const camelIndexQuestion = object({
  correctIndex: integer(0),
  explanation: string(),
  id: string({ minLength: 1 }),
  mediaUrl: string(),
  options: array(string(), { minItems: 2 }),
  question: string({ minLength: 1 }),
  topic: string()
}, ['id', 'question', 'options', 'correctIndex'])
const textAnswerQuestion = object({
  choices: array(string(), { minItems: 2 }),
  correct: string({ minLength: 1 }),
  explanation: string(),
  id: string({ minLength: 1 }),
  mediaUrl: string(),
  question: string({ minLength: 1 }),
  topic: string()
}, ['id', 'question', 'choices', 'correct'])
const sourceQuestion = {
  oneOf: [inlineQuestion, indexedAnswerQuestion, camelIndexQuestion, textAnswerQuestion]
}

const requestSchemas = {
  request: object({
    count: integer(1, 50),
    id_prefix: string({ minLength: 1 }),
    inline_questions: array(inlineQuestion, { minItems: 1, maxItems: 500 }),
    kind: string({ enum: ['daily', 'deduped_s3'] }),
    mode: string({ minLength: 1 }),
    scope: string({ enum: ['global'] }),
    source: string({ enum: ['request'] }),
    topic: string({ minLength: 1 })
  }, ['source', 'kind', 'mode', 'count', 'inline_questions']),
  weekly: object({
    iso_day: integer(1, 7),
    iso_week: integer(1, 53),
    iso_year: integer(2000, 9999),
    lang_code: string({ pattern: '^[a-z]{2}(?:-[A-Z]{2})?$' }),
    source: string({ enum: ['weekly'] }),
    type: string({ enum: WEEKLY_TYPES })
  }, ['source', 'type', 'lang_code', 'iso_year', 'iso_week', 'iso_day']),
  external: object({
    provider: string({ enum: EXTERNAL_PROVIDERS }),
    source: string({ enum: ['external'] })
  }, ['source', 'provider']),
  news: object({
    country: string({ pattern: '^[A-Za-z]{2,3}$' }),
    lang: string({ pattern: '^[a-z]{2}$' }),
    source: string({ enum: ['news'] })
  }, ['source', 'lang']),
  movies: object({
    country: string({ pattern: '^[A-Za-z]{2,3}$' }),
    lang: string({ pattern: '^[a-z]{2}$' }),
    source: string({ enum: ['movies'] })
  }, ['source', 'country', 'lang']),
  music: object({
    country: string({ pattern: '^[A-Za-z]{2,3}$' }),
    source: string({ enum: ['music'] })
  }, ['source', 'country'])
}

export const QUIZ_FETCH_INPUT_SCHEMA = Object.freeze({
  oneOf: Object.values(requestSchemas),
  type: 'object'
})

export const QUIZ_FETCH_ROUTES = Object.freeze({
  external: Object.freeze({
    requestVersion: 'external-provider-v1',
    responseAdapter: 'external-provider-raw-v1',
    rpc: 'quizverse_fetch_external_quiz'
  }),
  movies: Object.freeze({
    requestVersion: 'unity-movies-v1',
    responseAdapter: 'unity-movies-v1',
    rpc: 'quizverse_fetch_movies_quiz'
  }),
  music: Object.freeze({
    requestVersion: 'unity-music-v1',
    responseAdapter: 'unity-music-v1',
    rpc: 'quizverse_fetch_music_quiz'
  }),
  news: Object.freeze({
    requestVersion: 'web-unity-news-v1',
    responseAdapter: 'unity-news-v1',
    rpc: 'quizverse_fetch_news_quiz'
  }),
  request: Object.freeze({
    requestVersion: 'question-pack-v1',
    responseAdapter: 'question-pack-v1',
    rpc: 'quizverse_request_questions'
  }),
  weekly: Object.freeze({
    requestVersion: 'iso-weekly-v1',
    responseAdapter: 'weekly-raw-json-v1',
    rpc: 'quizverse_weekly_fetch'
  })
})

export function validateQuizFetchRequest(value, expectedRpc) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('qv_quiz_fetch arguments must be an object')
  }
  const source = value.source
  const route = QUIZ_FETCH_ROUTES[source]
  if (!route) throw new Error(`Unknown qv_quiz_fetch source: ${String(source)}`)
  if (expectedRpc && route.rpc !== expectedRpc) {
    throw new Error(`qv_quiz_fetch source ${source} does not map to ${expectedRpc}`)
  }
  validateSchema(requestSchemas[source], value, '$')
  if (source === 'request') {
    for (const [index, question] of value.inline_questions.entries()) {
      if (question.correct_index >= question.options.length) {
        throw new Error(`$.inline_questions[${index}].correct_index exceeds options`)
      }
    }
  }
  return route
}

export function mapQuizFetchRequest(args) {
  const route = validateQuizFetchRequest(args)
  const payload = { ...args }
  delete payload.source
  return { payload, rpc: route.rpc }
}

export function validateQuizFetchBrokerPayload(rpc, payload) {
  const source = Object.keys(QUIZ_FETCH_ROUTES).find(key => QUIZ_FETCH_ROUTES[key].rpc === rpc)
  if (!source) throw new Error(`Unknown qv_quiz_fetch RPC: ${String(rpc)}`)
  validateQuizFetchRequest({ source, ...payload }, rpc)
  return source
}

export function validateAndNormalizeQuizFetchResponse(rpc, payload, value) {
  const source = validateQuizFetchBrokerPayload(rpc, payload)
  if (!value || typeof value !== 'object' || (Array.isArray(value) && source !== 'external')) {
    throw new Error(`${rpc} returned a non-object response`)
  }
  const route = QUIZ_FETCH_ROUTES[source]
  if (value.ok === false) {
    validateSchema(object({
      error: string({ minLength: 1 }),
      fallback_to_client: { type: 'boolean' },
      message: string(),
      ok: { enum: [false], type: 'boolean' },
      rpc: string(),
      source_trace: object({ kind: string(), served_by: string() }, [])
    }, ['ok', 'error']), value, '$')
    return {
      contractVersion: 'quiz-fetch-routed-v2',
      data: {
        provenance: compact({
          adapter: route.responseAdapter,
          provider: source === 'external' ? payload.provider : undefined,
          requestVersion: route.requestVersion,
          route: source,
          rpc
        }),
        questions: [],
        rawMetadata: {
          error: value.error,
          fallbackToClient: value.fallback_to_client ?? false,
          sourceTrace: value.source_trace ?? null
        },
        route: source
      },
      success: false
    }
  }
  const normalized = source === 'request'
    ? normalizeQuestionPack(value)
    : source === 'weekly'
      ? normalizeWeekly(value)
      : source === 'external'
        ? normalizeExternal(payload.provider, value)
        : source === 'news'
          ? normalizeNews(value)
          : source === 'movies'
            ? normalizeMovies(value)
            : normalizeMusic(value)

  return {
    contractVersion: 'quiz-fetch-routed-v2',
    data: {
      ...normalized,
      provenance: compact({
        adapter: route.responseAdapter,
        provider: source === 'external' ? payload.provider : undefined,
        requestVersion: route.requestVersion,
        route: source,
        rpc
      }),
      route: source
    },
    success: normalized.success
  }
}

function normalizeQuestionPack(value) {
  const schema = object({
    context_pack_version: string(),
    error: string(),
    meta: extensionObject('question-pack-meta-v1', {}),
    ok: { type: 'boolean' },
    question_pack_id: string({ minLength: 1 }),
    questions: array(sourceQuestion),
    repeat_policy: object({
      fresh_count: integer(0),
      pool_exhausted: { type: 'boolean' },
      review_count: integer(0)
    }, ['fresh_count', 'review_count', 'pool_exhausted']),
    seen_snapshot: array(string()),
    source_trace: object({
      kind: string(),
      served_by: string()
    }, ['kind', 'served_by'])
  }, ['ok', 'questions', 'question_pack_id'])
  validateSchema(schema, value, '$')
  return {
    questionPackId: value.question_pack_id,
    questions: value.questions.map(normalizeQuestion),
    rawMetadata: {
      contextPackVersion: value.context_pack_version ?? null,
      repeatPolicy: value.repeat_policy ?? null,
      seenCount: value.seen_snapshot?.length ?? 0,
      sourceTrace: value.source_trace ?? null
    },
    success: value.ok
  }
}

function normalizeWeekly(value) {
  validateSchema(object({ raw_json: string({ minLength: 2 }) }, ['raw_json']), value, '$')
  let decoded
  try {
    decoded = JSON.parse(value.raw_json)
  } catch {
    throw new Error('quizverse_weekly_fetch.raw_json is not valid JSON')
  }
  const { questions: rawQuestions, wrapper } = extractWeeklyQuestions(decoded)
  const questions = rawQuestions
    .map((question, index) => normalizeSourceQuestion(question, index))
    .filter(Boolean)
  if (questions.length === 0) {
    throw new Error('quizverse_weekly_fetch.raw_json has no answerable questions')
  }
  return {
    questions,
    rawMetadata: {
      acceptedCount: questions.length,
      encoding: 'json',
      inputCount: rawQuestions.length,
      rejectedCount: rawQuestions.length - questions.length,
      wrapper
    },
    success: true
  }
}

function normalizeNews(value) {
  const article = object({
    category: string(),
    description: string(),
    imageUrl: string({ minLength: 1 }),
    publishedAt: string(),
    sourceName: string(),
    title: string({ minLength: 1 })
  }, ['title', 'imageUrl'])
  validateSchema(object({
    articles: array(article),
    cached: { type: 'boolean' },
    source: string(),
    success: { type: 'boolean' }
  }, ['success', 'articles']), value, '$')
  return cardsResult(value.articles.map(item => ({
    image: item.imageUrl,
    label: item.title,
    metadata: { category: item.category, publishedAt: item.publishedAt, sourceName: item.sourceName }
  })), 'news', {
    cached: value.cached ?? false,
    source: value.source ?? null
  }, value.success)
}

function normalizeMovies(value) {
  const movie = object({
    overview: string(),
    posterUrl: string({ minLength: 1 }),
    title: string({ minLength: 1 }),
    year: string()
  }, ['title', 'posterUrl'])
  validateSchema(object({
    cached: { type: 'boolean' },
    movies: array(movie),
    source: string(),
    success: { type: 'boolean' }
  }, ['success', 'movies']), value, '$')
  return cardsResult(value.movies.map(item => ({
    image: item.posterUrl,
    label: item.title,
    metadata: { year: item.year }
  })), 'movies', {
    cached: value.cached ?? false,
    source: value.source ?? null
  }, value.success)
}

function normalizeMusic(value) {
  const artist = object({
    artistName: string({ minLength: 1 }),
    imageUrl: string({ minLength: 1 }),
    playcount: string()
  }, ['artistName', 'imageUrl'])
  validateSchema(object({
    artists: array(artist),
    cached: { type: 'boolean' },
    country: string(),
    success: { type: 'boolean' }
  }, ['success', 'artists', 'country']), value, '$')
  return cardsResult(value.artists.map(item => ({
    image: item.imageUrl,
    label: item.artistName,
    metadata: { playcount: item.playcount }
  })), 'music', {
    cached: value.cached ?? false,
    country: value.country
  }, value.success)
}

function normalizeExternal(provider, value) {
  if (!EXTERNAL_PROVIDERS.includes(provider)) throw new Error(`Unsupported external provider: ${provider}`)
  if (provider === 'starwars') return normalizeStarWars(value)
  const cards = externalCards(provider, value)
  return cardsResult(cards, provider, {
    itemCount: cards.length,
    upstreamContract: `${provider}-raw-v1`
  }, true)
}

function externalCards(provider, value) {
  if (provider === 'jikan') {
    validateSchema(upstreamObject({
      data: array(upstreamObject({
        images: upstreamObject({
          jpg: upstreamObject({ image_url: string(), large_image_url: string() }, ['image_url']),
          webp: upstreamObject({ image_url: string() })
        }, ['jpg']),
        title: string({ minLength: 1 }),
        title_english: string()
      }, ['title', 'images']))
    }, ['data']), value, '$')
    return value.data.map(item => ({
      image: item.images.jpg.large_image_url || item.images.jpg.image_url,
      label: item.title_english || item.title
    }))
  }
  if (provider === 'pokeapi') {
    validateSchema(upstreamObject({
      count: integer(0),
      next: { anyOf: [string(), { type: 'null' }] },
      previous: { anyOf: [string(), { type: 'null' }] },
      results: array(upstreamObject({ name: string({ minLength: 1 }), url: string({ minLength: 1 }) }, ['name', 'url']))
    }, ['count', 'results']), value, '$')
    return value.results.map(item => {
      const id = /\/pokemon\/(\d+)\/?$/.exec(item.url)?.[1]
      return {
        image: id ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png` : '',
        label: titleCase(item.name)
      }
    })
  }
  if (provider === 'themealdb') {
    validateSchema(upstreamObject({
      meals: array(upstreamObject({
        idMeal: string(),
        strMeal: string({ minLength: 1 }),
        strMealThumb: string({ minLength: 1 })
      }, ['strMeal', 'strMealThumb']))
    }, ['meals']), value, '$')
    return value.meals.map(item => ({ image: item.strMealThumb, label: item.strMeal }))
  }
  if (provider === 'ghibli') {
    validateSchema(array(upstreamObject({
      image: string(),
      movie_banner: string(),
      title: string({ minLength: 1 })
    }, ['title'])), value, '$')
    return value.map(item => ({ image: item.image || item.movie_banner, label: item.title }))
  }
  if (provider === 'countries') {
    validateSchema(array(upstreamObject({
      flags: upstreamObject({ png: string(), svg: string() }, ['png']),
      name: upstreamObject({ common: string({ minLength: 1 }) }, ['common'])
    }, ['name', 'flags'])), value, '$')
    return value.map(item => ({ image: item.flags.png || item.flags.svg, label: item.name.common }))
  }
  if (provider === 'disney') {
    validateSchema(upstreamObject({
      data: array(upstreamObject({ imageUrl: string({ minLength: 1 }), name: string({ minLength: 1 }) }, ['name', 'imageUrl']))
    }, ['data']), value, '$')
    return value.data.map(item => ({ image: item.imageUrl, label: item.name }))
  }
  if (provider === 'nasa') {
    const nasaItem = upstreamObject({
      data: array(upstreamObject({ title: string({ minLength: 1 }) }, ['title']), { minItems: 1 }),
      links: array(upstreamObject({ href: string({ minLength: 1 }) }, ['href']), { minItems: 1 })
    }, ['data', 'links'])
    validateSchema(upstreamObject({
      collection: upstreamObject({ items: array(nasaItem) }, ['items'])
    }, ['collection']), value, '$')
    return value.collection.items.map(item => ({ image: item.links[0].href, label: item.data[0].title }))
  }
  if (provider === 'starwars') {
    throw new Error('Star Wars uses its dedicated semantic adapter')
  }
  if (provider === 'dog') {
    validateSchema(upstreamObject({
      message: array(string({ minLength: 1 })),
      status: string({ enum: ['success'] })
    }, ['message', 'status']), value, '$')
    return value.message.map(url => ({
      image: url,
      label: titleCase((url.split('/breeds/')[1]?.split('/')[0] ?? '').split('-').reverse().join(' '))
    }))
  }
  if (provider === 'sports') {
    validateSchema(upstreamObject({
      teams: array(upstreamObject({
        strBadge: string(),
        strTeam: string({ minLength: 1 }),
        strTeamBadge: string()
      }, ['strTeam']))
    }, ['teams']), value, '$')
    return value.teams.map(item => ({ image: item.strBadge || item.strTeamBadge, label: item.strTeam }))
  }
  throw new Error(`Missing external adapter for ${provider}`)
}

function cardsResult(cards, topic, rawMetadata, success) {
  const usable = cards.filter(card => card.label && (topic === 'starwars' || card.image))
  const labels = usable.map(card => card.label)
  const questions = usable.map((card, index) => {
    const distractors = labels.filter(label => label !== card.label).slice(0, 3)
    const options = [card.label, ...distractors]
    return compact({
      correctIndex: 0,
      id: `${topic}:${slug(card.label) || index}`,
      mediaUrl: card.image || undefined,
      options,
      prompt: topic === 'news' ? 'Which headline matches this image?' : `Identify this ${topic} item`,
      topic,
      type: card.image ? 'image' : 'mcq'
    })
  }).filter(question => question.options.length >= 4)
  return { questions, rawMetadata, success }
}

function normalizeQuestion(question) {
  const options = question.options ?? question.choices
  const explicit = question.correct_index ?? question.answer ?? question.correctIndex
  const correctIndex = Number.isInteger(explicit)
    ? explicit
    : options.findIndex(option => option.trim().toLowerCase() === question.correct.trim().toLowerCase())
  if (correctIndex < 0 || correctIndex >= options.length) {
    throw new Error(`Question ${String(question.id)} has an invalid correct answer`)
  }
  return compact({
    correctIndex,
    explanation: question.explanation,
    id: String(question.id),
    mediaUrl: question.media_url ?? question.mediaUrl,
    options,
    prompt: question.question,
    topic: question.topic,
    type: question.media_url ? 'image' : 'mcq'
  })
}

function extractWeeklyQuestions(decoded) {
  if (Array.isArray(decoded)) return { questions: decoded, wrapper: 'root-array' }
  if (!decoded || typeof decoded !== 'object') {
    throw new Error('quizverse_weekly_fetch.raw_json is not a question payload')
  }
  for (const key of ['questions', 'items', 'data', 'results']) {
    if (Array.isArray(decoded[key])) return { questions: decoded[key], wrapper: key }
  }
  throw new Error('quizverse_weekly_fetch.raw_json has no supported question wrapper')
}

function normalizeSourceQuestion(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const prompt = firstString(raw.prompt, raw.question, raw.questionText, raw.text).trim()
  if (!prompt) return null
  const sourceOptions = raw.options ?? raw.choices
  const options = (Array.isArray(sourceOptions) ? sourceOptions : []).map(option => {
    if (option && typeof option === 'object' && !Array.isArray(option)) {
      return String(option.text ?? option.option ?? option.label ?? option.answer ?? option.value ?? '')
    }
    return String(option)
  })
  const type = normalizeQuestionType(raw)
  const correctIndex = normalizeCorrectIndex(raw, options)
  if (type !== 'subjective' && (
    options.length < 2 ||
    correctIndex < 0 ||
    correctIndex >= options.length
  )) return null

  return compact({
    category: typeof raw.category === 'string' ? raw.category : undefined,
    correctIndex: type === 'subjective' ? -1 : correctIndex,
    difficulty: typeof raw.difficulty === 'string' ? raw.difficulty : undefined,
    explanation: typeof raw.explanation === 'string' ? raw.explanation : undefined,
    id: raw.id != null
      ? String(raw.id)
      : raw.questionId != null
        ? String(raw.questionId)
        : `q_${index}`,
    mediaUrl: firstString(
      raw.mediaUrl,
      raw.media_url,
      raw.media,
      raw.image,
      raw.audio,
      raw.video
    ) || undefined,
    options,
    prompt,
    topic: firstString(raw.topic, raw.theme) || undefined,
    type
  })
}

function normalizeQuestionType(raw) {
  const declared = String(raw.type ?? '').toLowerCase().replace(/[\s-]/g, '_')
  if (QUESTION_TYPES.includes(declared)) return declared
  if (raw.video || raw.type === 'video') return 'video'
  if (raw.audio) return 'audio'
  if (raw.image || raw.media || raw.mediaUrl || raw.media_url) return 'image'
  return 'mcq'
}

function normalizeCorrectIndex(raw, options) {
  const explicit = raw.correctIndex ?? raw.correct_index ?? raw.correct_answer ?? raw.correctAnswer
  if (Number.isInteger(explicit)) return explicit
  const answer = raw.answer ?? raw.correct
  if (Number.isInteger(answer)) return answer
  if (typeof answer === 'string') {
    return options.findIndex(option => option.toLowerCase().trim() === answer.toLowerCase().trim())
  }
  return -1
}

function normalizeStarWars(value) {
  validateSchema(array(upstreamObject({
    eye_color: string({ minLength: 1 }),
    name: string({ minLength: 1 })
  }, ['name', 'eye_color'])), value, '$')
  const people = value.filter(person =>
    person.name.trim() &&
    person.eye_color.trim() &&
    person.eye_color.trim().toLowerCase() !== 'unknown'
  )
  const colors = [...new Set(people.map(person => person.eye_color.trim()))]
  if (people.length < 4 || colors.length < 4) {
    throw new Error('starwars raw response needs four characters with distinct known eye colours')
  }
  const questions = people.map(person => {
    const correct = titleCase(person.eye_color.trim())
    const distractors = colors
      .filter(color => color.toLowerCase() !== person.eye_color.trim().toLowerCase())
      .slice(0, 3)
      .map(titleCase)
    const options = deterministicOptions([correct, ...distractors], person.name)

    return {
      correctIndex: options.indexOf(correct),
      id: `starwars:${slug(person.name)}`,
      options,
      prompt: `What colour are ${person.name.trim()}'s eyes? (Star Wars)`,
      topic: 'starwars',
      type: 'mcq'
    }
  })
  return {
    questions,
    rawMetadata: {
      characterCount: people.length,
      distinctEyeColourCount: colors.length,
      upstreamContract: 'starwars-raw-v1'
    },
    success: true
  }
}

function deterministicOptions(options, seed) {
  const offset = [...seed].reduce((total, character) => total + character.codePointAt(0), 0) % options.length
  return options.slice(offset).concat(options.slice(0, offset))
}

function validateSchema(schema, value, path) {
  if (schema.oneOf || schema.anyOf) {
    const candidates = schema.oneOf ?? schema.anyOf
    const matches = []
    for (const candidate of candidates) {
      try {
        validateSchema(candidate, value, path)
        matches.push(candidate)
      } catch {
        // Candidate mismatch is expected while evaluating a union.
      }
    }
    if (schema.oneOf && matches.length !== 1) throw new Error(`${path} must match exactly one routed schema`)
    if (schema.anyOf && matches.length === 0) throw new Error(`${path} must match a compatible schema`)
    return
  }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} has an unsupported value`)
  if (schema.type === 'null' && value !== null) throw new Error(`${path} must be null`)
  if (schema.type === 'string') {
    if (typeof value !== 'string') throw new Error(`${path} must be a string`)
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new Error(`${path} is too short`)
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) throw new Error(`${path} has an invalid format`)
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${path} must be boolean`)
  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) throw new Error(`${path} must be an integer`)
    if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`${path} is below minimum`)
    if (schema.maximum !== undefined && value > schema.maximum) throw new Error(`${path} exceeds maximum`)
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`${path} has too few items`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`${path} has too many items`)
    value.forEach((item, index) => validateSchema(schema.items, item, `${path}[${index}]`))
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`)
    for (const key of schema.required ?? []) if (!(key in value)) throw new Error(`${path}.${key} is required`)
    for (const [key, item] of Object.entries(value)) {
      if (!schema.properties[key]) {
        if (!schema.additionalProperties) throw new Error(`${path}.${key} is unknown`)
      } else {
        validateSchema(schema.properties[key], item, `${path}.${key}`)
      }
    }
  }
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
}

function titleCase(value) {
  return String(value).replace(/(^|[\s-])([a-z])/g, (_match, prefix, character) =>
    `${prefix}${character.toUpperCase()}`)
}

function firstString(...values) {
  const value = values.find(item => typeof item === 'string')
  return value ?? ''
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}
