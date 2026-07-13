export interface LeaderboardRow {
  ownerId: string
  rank: number
  score: number
  username: string
}

export function normalizeLeaderboard(value: unknown): LeaderboardRow[] {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const rows = Array.isArray(record.records) ? record.records : []

  return rows
    .flatMap((row, index) => {
      if (!row || typeof row !== 'object') {
        return []
      }

      const item = row as Record<string, unknown>
      const score = Number(item.score)

      if (!Number.isFinite(score)) {
        return []
      }

      return [{
        ownerId: String(item.ownerId ?? item.owner_id ?? ''),
        rank: Number.isInteger(item.rank) && Number(item.rank) > 0 ? Number(item.rank) : index + 1,
        score,
        username: String(item.username ?? item.playerName ?? `Player ${index + 1}`)
      }]
    })
    .sort((left, right) => left.rank - right.rank || right.score - left.score)
}
