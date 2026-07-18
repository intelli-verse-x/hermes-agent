import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const { provisionDesktopBrand } = await import(
  new URL('./desktop-brand-provision.ts', import.meta.url).href
)

function brainFixture(root: string, brandId: string, appId: string) {
  const brainSource = path.join(root, `${brandId}-brain`)
  fs.mkdirSync(path.join(brainSource, 'skills', 'ivx-gbrain'), { recursive: true })
  fs.writeFileSync(
    path.join(brainSource, 'AGENTS.md'),
    `# ${brandId} gBrain\n\nApp-ID: ${appId}\n`,
    'utf8'
  )
  fs.writeFileSync(
    path.join(brainSource, 'skills', 'ivx-gbrain', 'SKILL.md'),
    '---\nname: ivx-gbrain\ndescription: test\n---\n# gBrain\n',
    'utf8'
  )

  return brainSource
}

test('seeds skin, SOUL gBrain block, AGENTS.md, and ivx-gbrain skill', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-gbrain-'))
  const hermesHome = path.join(root, 'home')
  const brainSource = brainFixture(root, 'ix-agency', 'ai.intelli-verse-x.ix-agency')

  const result = provisionDesktopBrand({
    hermesHome,
    brandId: 'ix-agency',
    productName: 'IX Agency',
    appId: 'ai.intelli-verse-x.ix-agency',
    brainSource
  })

  assert.equal(result.brainSeeded, true)
  assert.ok(fs.existsSync(result.skinPath))
  assert.match(fs.readFileSync(result.soulPath, 'utf8'), /ai\.intelli-verse-x\.ix-agency/)
  assert.match(fs.readFileSync(result.soulPath, 'utf8'), /ivx-gbrain:start/)
  assert.match(fs.readFileSync(path.join(hermesHome, 'AGENTS.md'), 'utf8'), /ix-agency gBrain/)
  assert.ok(fs.existsSync(path.join(hermesHome, 'skills', 'ivx-gbrain', 'SKILL.md')))
})

test('upserts gBrain SOUL block without wiping custom identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-gbrain-soul-'))
  const hermesHome = path.join(root, 'home')
  fs.mkdirSync(hermesHome, { recursive: true })
  fs.writeFileSync(path.join(hermesHome, 'SOUL.md'), '# Custom soul\n\nStay friendly.\n', 'utf8')
  const brainSource = brainFixture(root, 'quizverse', 'ai.intelli-verse-x.quizverse')

  provisionDesktopBrand({
    hermesHome,
    brandId: 'quizverse',
    productName: 'QuizVerse',
    appId: 'ai.intelli-verse-x.quizverse',
    brainSource
  })

  const soul = fs.readFileSync(path.join(hermesHome, 'SOUL.md'), 'utf8')
  assert.match(soul, /Custom soul/)
  assert.match(soul, /ai\.intelli-verse-x\.quizverse/)

  provisionDesktopBrand({
    hermesHome,
    brandId: 'quizverse',
    productName: 'QuizVerse',
    appId: 'ai.intelli-verse-x.quizverse',
    brainSource
  })

  const again = fs.readFileSync(path.join(hermesHome, 'SOUL.md'), 'utf8')
  assert.equal((again.match(/ivx-gbrain:start/g) || []).length, 1)
})

test('is a no-op for brain when brainSource is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-gbrain-miss-'))
  const hermesHome = path.join(root, 'home')

  const result = provisionDesktopBrand({
    hermesHome,
    brandId: 'ix-agency',
    productName: 'IX Agency',
    appId: 'ai.intelli-verse-x.ix-agency',
    brainSource: path.join(root, 'does-not-exist')
  })

  assert.equal(result.brainSeeded, false)
  assert.equal(fs.existsSync(path.join(hermesHome, 'AGENTS.md')), false)
})
