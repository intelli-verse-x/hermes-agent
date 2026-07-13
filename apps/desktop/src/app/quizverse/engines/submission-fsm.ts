import { atom } from 'nanostores'

export interface SubmissionSnapshot<T> {
  error?: string
  idempotencyKey?: string
  phase: 'idle' | 'submitting' | 'submitted'
  result?: T
}

export interface SubmissionMachine<TInput, TResult> {
  state: ReturnType<typeof atom<SubmissionSnapshot<TResult>>>
  reset: () => void
  submit: (input: TInput) => Promise<TResult>
}

export function createSubmissionMachine<TInput, TResult>(
  write: (input: TInput, idempotencyKey: string) => Promise<TResult>
): SubmissionMachine<TInput, TResult> {
  const state = atom<SubmissionSnapshot<TResult>>({ phase: 'idle' })
  let inFlight: Promise<TResult> | null = null
  let retainedKey: string | undefined

  return {
    reset() {
      if (!inFlight) {
        retainedKey = undefined
        state.set({ phase: 'idle' })
      }
    },
    state,
    submit(input) {
      if (inFlight) {
        return inFlight
      }

      retainedKey ??= crypto.randomUUID()
      const idempotencyKey = retainedKey

      state.set({ idempotencyKey, phase: 'submitting' })
      inFlight = write(input, idempotencyKey)
        .then(result => {
          state.set({ idempotencyKey, phase: 'submitted', result })

          return result
        })
        .catch(error => {
          state.set({
            error: error instanceof Error ? error.message : String(error),
            idempotencyKey,
            phase: 'idle'
          })
          throw error
        })
        .finally(() => {
          inFlight = null
        })

      return inFlight
    }
  }
}
