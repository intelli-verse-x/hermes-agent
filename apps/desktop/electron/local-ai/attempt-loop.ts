export type ReadinessAttemptPhase = 'candidate' | 'runtime-repair'

export interface ReadinessAttempt<Candidate> {
  candidate: Candidate
  index: number
  total: number
  phase: ReadinessAttemptPhase
}

export interface ReadinessAttemptResult {
  ok: boolean
  reason?: string
  terminal?: boolean
}

export interface ReadinessLoopResult<Candidate> extends ReadinessAttemptResult {
  attempts: number
  selected?: Candidate
}

export async function runCandidateReadinessLoop<Candidate>(
  candidates: readonly Candidate[],
  attempt: (input: ReadinessAttempt<Candidate>) => Promise<ReadinessAttemptResult>,
  onResult?: (input: ReadinessAttempt<Candidate>, result: ReadinessAttemptResult) => Promise<void> | void
): Promise<ReadinessLoopResult<Candidate>> {
  const total = candidates.length * 2
  let index = 0
  let reason = 'No candidate passed readiness verification'

  for (const candidate of candidates) {
    for (const phase of ['candidate', 'runtime-repair'] as const) {
      index += 1
      const input = { candidate, index, total, phase }
      const result = await attempt(input)
      await onResult?.(input, result)

      if (result.ok) {
        return { ok: true, attempts: index, selected: candidate }
      }

      reason = result.reason || reason

      if (result.terminal) {
        return { ok: false, attempts: index, reason, terminal: true }
      }
    }
  }

  return { ok: false, attempts: index, reason }
}
