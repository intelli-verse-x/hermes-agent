import { describe, expect, it } from 'vitest'

import { intelliversePublicText } from '../ix-agency/connect-tab'

import { quizversePublicText } from './store'

describe('desktop public branding boundaries', () => {
  it('maps upstream runtime and package output to TutorX in QuizVerse', () => {
    const text = quizversePublicText('Installing deeptutor. Deep Tutor ready under Hermes Agent.')

    expect(text).toBe('Installing TutorX. TutorX ready under QuizVerse.')
    expect(text).not.toMatch(/deeptutor|deep tutor|hermes/i)
  })

  it('maps runtime setup output to Intelliverse in IX', () => {
    const text = intelliversePublicText('Hermes Agent initialized by hermes-deployment in ~/.hermes')

    expect(text).not.toMatch(/hermes/i)
    expect(text).toContain('Intelliverse')
  })
})
