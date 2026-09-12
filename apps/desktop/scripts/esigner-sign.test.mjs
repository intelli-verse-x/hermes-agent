// esigner-sign.test.mjs — env-gating contract for the Windows eSigner hook.
//
// The signing call itself needs CodeSignTool + live SSL.com credentials, so
// these tests lock the part that can silently ruin a release instead:
//   - no ES_* env        → no-op (unsigned build, same as before the hook)
//   - PARTIAL ES_* env   → throw (a half-signed release must never publish)
//   - sha1 second pass   → skipped (eSigner already applied sha256)
//   - env OK, tool absent → throw (fail closed, not unsigned)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'vitest'

import sign from '../scripts/esigner-sign.mjs'

const ES_VARS = ['ES_USERNAME', 'ES_PASSWORD', 'ES_TOTP_SECRET', 'ES_CREDENTIAL_ID', 'CODE_SIGN_TOOL_PATH']
let savedEnv

beforeEach(() => {
  savedEnv = {}
  for (const v of ES_VARS) {
    savedEnv[v] = process.env[v]
    delete process.env[v]
  }
})

afterEach(() => {
  for (const v of ES_VARS) {
    if (savedEnv[v] === undefined) delete process.env[v]
    else process.env[v] = savedEnv[v]
  }
})

function fakeExe() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esigner-test-'))
  const file = path.join(dir, 'Setup.exe')
  fs.writeFileSync(file, 'MZ-fake')
  return { dir, file }
}

test('no ES_* env → no-op, file untouched', async () => {
  const { dir, file } = fakeExe()
  try {
    await sign({ path: file, hash: 'sha256' })
    assert.equal(fs.readFileSync(file, 'utf8'), 'MZ-fake')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('partial ES_* env → throws naming the missing vars', async () => {
  const { dir, file } = fakeExe()
  process.env.ES_USERNAME = 'sales@example.com'
  process.env.ES_PASSWORD = 'pw'
  // ES_TOTP_SECRET + ES_CREDENTIAL_ID missing
  try {
    await assert.rejects(() => sign({ path: file, hash: 'sha256' }), /ES_TOTP_SECRET, ES_CREDENTIAL_ID/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('sha1 pass → skipped even with full env', async () => {
  const { dir, file } = fakeExe()
  for (const v of ES_VARS) process.env[v] = 'x'
  try {
    await sign({ path: file, hash: 'sha1' })
    assert.equal(fs.readFileSync(file, 'utf8'), 'MZ-fake')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('full env but CODE_SIGN_TOOL_PATH missing/invalid → throws (fail closed)', async () => {
  const { dir, file } = fakeExe()
  process.env.ES_USERNAME = 'u'
  process.env.ES_PASSWORD = 'p'
  process.env.ES_TOTP_SECRET = 't'
  process.env.ES_CREDENTIAL_ID = 'c'
  process.env.CODE_SIGN_TOOL_PATH = path.join(dir, 'nope')
  try {
    await assert.rejects(() => sign({ path: file, hash: 'sha256' }), /CODE_SIGN_TOOL_PATH/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
