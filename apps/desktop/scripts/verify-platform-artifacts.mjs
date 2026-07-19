import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loadBrand } from './apply-brand.mjs'

const root = path.resolve(import.meta.dirname, '..')
const release = path.join(root, 'release')
const brand = loadBrand()
const entries = fs.readdirSync(release)
const matching = suffix => entries.filter(name => name.toLowerCase().endsWith(suffix))
const matchingBrand = suffix =>
  matching(suffix).filter(name => name.startsWith(`${brand.artifactPrefix}-`))

function assert(condition, message) {
  if (!condition) {throw new Error(message)}
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000, ...options })
  assert(result.status === 0, `${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`)

  return result.stdout
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const candidate = path.join(directory, entry.name)

    return entry.isDirectory() ? walk(candidate) : [candidate]
  })
}

function verifyResourceTree(directory) {
  const files = walk(directory).map(file => file.replaceAll('\\', '/'))

  for (const required of [
    '/local-ai/local-ai-model-catalog.v1.json',
    '/local-ai/local-ai-runtime-catalog.v1.json',
    '/hermes-skills/local-first-inference/SKILL.md'
  ]) {
    assert(files.some(file => file.endsWith(required)), `Missing packaged resource ${required}`)
  }
  const modelPath = files.find(file => file.endsWith('/local-ai/local-ai-model-catalog.v1.json'))
  const runtimePath = files.find(file => file.endsWith('/local-ai/local-ai-runtime-catalog.v1.json'))
  const modelCatalog = JSON.parse(fs.readFileSync(modelPath, 'utf8'))
  const runtimeCatalog = JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
  assert(modelCatalog.schemaVersion === 1 && modelCatalog.models?.length, 'Invalid packaged model catalog')
  assert(runtimeCatalog.schemaVersion === 1 && runtimeCatalog.assets?.length, 'Invalid packaged runtime catalog')
  assert(
    runtimeCatalog.assets.every(asset => /^[a-f0-9]{64}$/.test(asset.sha256)),
    'Packaged runtime catalog contains an invalid SHA-256'
  )
}

async function smokeExecutable(executable, args = [], launcher) {
  const child = spawn(launcher ?? executable, launcher ? ['-a', executable, ...args] : args, {
    env: {
      ...process.env,
      HERMES_DESKTOP_TEST_MODE: 'packaged-smoke',
      HERMES_DESKTOP_USER_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-packaged-smoke-'))
    },
    stdio: 'ignore',
    windowsHide: true
  })
  const exit = new Promise(resolve => child.once('exit', code => resolve(code)))
  const outcome = await Promise.race([
    exit.then(code => ({ kind: 'exit', code })),
    new Promise(resolve => setTimeout(() => resolve({ kind: 'alive' }), 4_000))
  ])

  if (outcome.kind === 'alive') {
    child.kill()
  } else {
    assert(outcome.code === 0, `Packaged executable exited with ${outcome.code}`)
  }
}

if (process.platform === 'linux') {
  const appImages = matchingBrand('.appimage')
  const debs = matchingBrand('.deb')
  const rpms = matchingBrand('.rpm')
  assert(appImages.length && debs.length && rpms.length, 'Expected AppImage, deb, and rpm artifacts')
  const extraction = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-appimage-'))
  run(path.join(release, appImages[0]), ['--appimage-extract'], { cwd: extraction })
  const imageRoot = path.join(extraction, 'squashfs-root')
  verifyResourceTree(imageRoot)
  await smokeExecutable(path.join(imageRoot, 'AppRun'), ['--no-sandbox', '--disable-gpu'], 'xvfb-run')
  for (const deb of debs) {
    const listing = run('dpkg-deb', ['-c', path.join(release, deb)])
    assert(listing.includes('local-ai-model-catalog.v1.json'), `${deb} lacks Local AI resources`)
    assert(listing.includes(brand.executableName), `${deb} lacks ${brand.executableName}`)
  }
  for (const rpm of rpms) {
    const listing = run('rpm', ['-qlp', path.join(release, rpm)])
    assert(listing.includes('local-ai-model-catalog.v1.json'), `${rpm} lacks Local AI resources`)
    assert(listing.includes(brand.executableName), `${rpm} lacks ${brand.executableName}`)
  }
} else if (process.platform === 'win32') {
  const zips = matchingBrand('.zip')
  assert(zips.length, 'Expected a Windows ZIP artifact')
  const extraction = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-windows-zip-'))
  run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
    path.join(release, zips[0]),
    extraction
  ])
  verifyResourceTree(extraction)
  const executable = walk(extraction).find(file => file.endsWith(`${brand.productName}.exe`))
  assert(executable, `ZIP lacks ${brand.productName}.exe`)
  await smokeExecutable(executable)
} else if (process.platform === 'darwin') {
  const app = path.join(release, 'mac-arm64', `${brand.productName}.app`)
  const fallback = path.join(release, 'mac', `${brand.productName}.app`)
  const packaged = fs.existsSync(app) ? app : fallback
  assert(fs.existsSync(packaged), `Missing packaged ${brand.productName}.app`)
  verifyResourceTree(path.join(packaged, 'Contents', 'Resources'))
  const zips = matchingBrand('.zip')
  const dmgs = matchingBrand('.dmg')
  assert(zips.length, 'Expected a macOS ZIP artifact')
  assert(dmgs.length, 'Expected a macOS DMG artifact')
  const extraction = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-macos-zip-'))
  run('ditto', ['-x', '-k', path.join(release, zips[0]), extraction])
  verifyResourceTree(extraction)
  const mountpoint = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-macos-dmg-'))
  run('hdiutil', [
    'attach',
    '-nobrowse',
    '-readonly',
    '-mountpoint',
    mountpoint,
    path.join(release, dmgs[0])
  ])
  try {
    verifyResourceTree(path.join(mountpoint, `${brand.productName}.app`, 'Contents', 'Resources'))
  } finally {
    run('hdiutil', ['detach', mountpoint])
  }
  await smokeExecutable(path.join(packaged, 'Contents', 'MacOS', brand.productName))
} else {
  throw new Error(`Unsupported platform ${process.platform}`)
}

console.log(`Verified ${brand.productName} ${process.platform} release artifacts`)
