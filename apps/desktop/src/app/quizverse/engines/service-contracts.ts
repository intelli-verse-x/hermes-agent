function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function sourceData(value: unknown): Record<string, unknown> {
  const root = object(value)

  return object(root.data ?? root)
}

export function debateScorePayload(topic: string, userPosition: string) {
  return { topic, userPosition }
}

export function audiobookLibraryPath(userId: string): string {
  if (!userId) {throw new Error('Audiobook library requires a user identity')}

  return `/audiobook/library/${encodeURIComponent(userId)}`
}

export function audiobookPositionPayload(seconds: number) {
  return { positionMs: Math.max(0, Math.round(seconds * 1000)) }
}

export interface TournamentBracket {
  bracketId: string
  exists: boolean
  publicDashboardUrl: string
  round: number
  totalRounds: number
}

export function normalizeTournamentBracket(value: unknown): TournamentBracket {
  const data = sourceData(value)
  const exists = data.exists === true
  const bracketId = String(data.bracket_id ?? '')
  const round = Number(data.round ?? 0)
  const totalRounds = Number(data.total_rounds ?? 0)
  let publicDashboardUrl = String(data.public_dashboard_url ?? '')

  if (publicDashboardUrl) {
    const url = new URL(publicDashboardUrl)

    if (url.protocol !== 'https:' || url.hostname !== 'bracket.intelli-verse-x.ai') {
      throw new Error('Tournament bracket returned an untrusted dashboard URL')
    }

    publicDashboardUrl = url.toString()
  }

  if (
    typeof data.exists !== 'boolean' ||
    (exists && !bracketId) ||
    !Number.isInteger(round) ||
    round < 0 ||
    !Number.isInteger(totalRounds) ||
    totalRounds < 0
  ) {
    throw new Error('Tournament bracket response is malformed')
  }

  return { bracketId, exists, publicDashboardUrl, round, totalRounds }
}

export function certificateIdFromClaim(value: unknown): string {
  const data = sourceData(value)

  return String(data.certificate_id ?? data.id ?? '')
}

export function normalizeTournamentCertificate(value: unknown): Record<string, unknown> | null {
  const certificate = object(sourceData(value).certificate)

  return String(certificate.id ?? '') ? certificate : null
}

export function normalizeLearningTrack(value: unknown): {
  track: Record<string, unknown>
  videos: Record<string, unknown>[]
} {
  const track = object(sourceData(value).track)
  const videos = Array.isArray(track.videos) ? track.videos.map(object) : []

  if (!String(track.track_id ?? '') || !Array.isArray(track.videos)) {
    throw new Error('Learning track response is malformed')
  }

  return { track, videos }
}

export interface TournamentQuestion {
  correctIndex: number
  explanation?: string
  id: string
  mediaUrl?: string
  options: string[]
  prompt: string
}

export function normalizeTournamentQuestions(value: unknown): TournamentQuestion[] {
  const root = object(value)

  const rows = Array.isArray(value)
    ? value
    : [root.questions, root.items, root.data, root.results].find(Array.isArray) ?? []

  return rows.flatMap((raw, index) => {
    const row = object(raw)
    const prompt = String(row.prompt ?? row.question ?? row.questionText ?? row.text ?? '').trim()
    const rawOptions = row.options ?? row.choices ?? row.answers
    const options = Array.isArray(rawOptions) ? rawOptions.map(option => String(option)) : []
    let correctIndex = Number(row.correctIndex ?? row.correct_index ?? row.answer ?? row.correct ?? -1)

    if (!Number.isInteger(correctIndex) && typeof row.correct === 'string') {
            correctIndex = options.findIndex(
              option => option.trim().toLowerCase() === String(row.correct).trim().toLowerCase()
            )
    }

    if (!prompt || options.length < 2 || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      return []
    }

    return [{
      correctIndex,
      explanation: row.explanation ? String(row.explanation) : undefined,
      id: String(row.id ?? row.questionId ?? row.question_id ?? `q_${index}`),
      mediaUrl: row.mediaUrl || row.media_url || row.image ? String(row.mediaUrl ?? row.media_url ?? row.image) : undefined,
      options,
      prompt
    }]
  })
}

export async function loadTournamentPackArtifact(
  value: unknown,
  slug: string,
  fetcher: typeof fetch = fetch
): Promise<{ packId: string; questions: TournamentQuestion[]; status: 'generating' | 'ready' }> {
  const data = sourceData(value)
  const pack = object(data.pack)
  const artifactUrl = String(pack.s3_url ?? '')

  if (!artifactUrl) {
    return { packId: String(data.task_id ?? ''), questions: [], status: 'generating' }
  }

  const url = new URL(artifactUrl)

  const trustedHost = url.hostname === 's3.amazonaws.com' ||
    url.hostname.endsWith('.amazonaws.com') ||
    url.hostname.endsWith('.intelli-verse-x.ai')

  if (url.protocol !== 'https:' || !trustedHost || url.username || url.password) {
    throw new Error('Tournament pack returned an untrusted artifact URL')
  }

  const response = await fetcher(url, { cache: 'no-store', credentials: 'omit' })

  if (!response.ok) {throw new Error(`Tournament pack fetch failed (${response.status})`)}
  const questions = normalizeTournamentQuestions(await response.json())

  if (!questions.length) {throw new Error('Tournament pack contains no playable questions')}

  return {
    packId: String(pack.content_factory_task_id ?? slug),
    questions,
    status: 'ready'
  }
}
