// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { sanitizeTutorMarkup } from './native-tutor'

describe('TutorX native visualization sanitizer', () => {
  it('removes scripts, handlers, javascript URLs, and embedded frames from HTML', () => {
    const clean = sanitizeTutorMarkup(
      '<section onclick="steal()"><script>steal()</script><a href="javascript:steal()">bad</a><img src="https://safe.test/a.png" onerror="steal()"><iframe src="https://bad.test"></iframe><p>Safe</p></section>',
      'html'
    )

    expect(clean).toContain('<p>Safe</p>')
    expect(clean).toContain('https://safe.test/a.png')
    expect(clean).not.toMatch(/script|iframe|onclick|onerror|javascript:/i)
  })

  it('blocks SVG foreign content and executable links', () => {
    const clean = sanitizeTutorMarkup(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject><iframe src="x"></iframe></foreignObject><a href="javascript:alert(1)">bad</a><rect width="10" height="10"/></svg>',
      'svg'
    )

    expect(clean).toContain('<svg')
    expect(clean).toContain('<rect')
    expect(clean).not.toMatch(/script|foreignObject|iframe|javascript:/i)
  })

  it('rejects non-SVG documents in the SVG renderer', () => {
    expect(sanitizeTutorMarkup('<html><p>not svg</p></html>', 'svg')).toBe('')
  })
})
