import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

const {
  assertQuizverseIsolatedHome,
  resolveQuizverseEffectiveHermesHome
} = await import(new URL('./qv-mcp-profile.ts', import.meta.url).href)

test('resolves default and named QuizVerse profiles under the isolated root', () => {
  const base = path.join(path.sep, 'tmp', 'quizverse', 'hermes-home')

  assert.equal(resolveQuizverseEffectiveHermesHome(base, null), base)
  assert.equal(resolveQuizverseEffectiveHermesHome(base, 'default'), base)
  assert.equal(
    resolveQuizverseEffectiveHermesHome(base, 'student'),
    path.join(base, 'profiles', 'student')
  )
})

test('refuses an explicit IX default home but accepts a migrated path', () => {
  const ixDefault = path.join(path.sep, 'home', 'player', '.hermes')

  assert.throws(() => assertQuizverseIsolatedHome(ixDefault, ixDefault), /refuses the shared/)
  assert.equal(
    assertQuizverseIsolatedHome(path.join(path.sep, 'home', 'player', '.quizverse-hermes'), ixDefault),
    path.join(path.sep, 'home', 'player', '.quizverse-hermes')
  )
})
