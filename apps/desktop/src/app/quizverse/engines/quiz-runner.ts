import { atom } from 'nanostores'

export interface QuizQuestion {
  correctIndex: number
  id: string
  options: readonly string[]
  prompt: string
}

export interface QuizRunnerState {
  answers: readonly number[]
  index: number
  phase: 'complete' | 'playing' | 'ready'
  questions: readonly QuizQuestion[]
  score: number
}

export function createQuizRunner(questions: readonly QuizQuestion[]) {
  const state = atom<QuizRunnerState>({
    answers: [],
    index: 0,
    phase: 'ready',
    questions,
    score: 0
  })

  return {
    answer(selectedIndex: number) {
      const current = state.get()

      if (current.phase !== 'playing') {
        return current
      }

      const question = current.questions[current.index]

      if (!question || selectedIndex < 0 || selectedIndex >= question.options.length) {
        throw new Error('Quiz answer is outside the current question options')
      }

      const answers = [...current.answers, selectedIndex]
      const score = current.score + (selectedIndex === question.correctIndex ? 1 : 0)
      const complete = answers.length === current.questions.length

      const next = {
        ...current,
        answers,
        index: complete ? current.index : current.index + 1,
        phase: complete ? ('complete' as const) : ('playing' as const),
        score
      }

      state.set(next)

      return next
    },
    reset() {
      state.set({ answers: [], index: 0, phase: 'ready', questions, score: 0 })
    },
    start() {
      if (questions.length === 0) {
        throw new Error('Quiz requires at least one question')
      }

      state.set({ answers: [], index: 0, phase: 'playing', questions, score: 0 })
    },
    state
  }
}
