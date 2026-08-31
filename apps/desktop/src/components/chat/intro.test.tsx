// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { BRAND } from '@/lib/brand'

import { Intro } from './intro'

describe('Intro', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows the brand mark above the wordmark (file://-safe asset path)', () => {
    render(<Intro personality="none" seed={0} />)

    const mark = screen.getByTestId('intro-brand-mark').querySelector('img')
    const expected = `${import.meta.env.BASE_URL}${BRAND.markSvg.replace(/^\/+/, '')}`

    expect(mark).toBeTruthy()
    expect(mark?.getAttribute('src')).toBe(expected)
    expect(screen.getByLabelText(BRAND.productName.toUpperCase())).toBeTruthy()
  })
})
