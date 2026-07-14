export interface QuizverseContract {
  allowedKeys: readonly string[]
  authenticated: boolean
  hard?: boolean
  required: readonly string[]
  response: {
    version: string
  }
  rpc?: string
  rpcs?: readonly string[]
  tutorPath?: RegExp
  write: boolean
}

export const QUIZVERSE_CONTRACTS: Readonly<Record<string, QuizverseContract>>
