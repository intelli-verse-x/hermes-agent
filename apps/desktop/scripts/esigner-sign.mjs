// esigner-sign.mjs — electron-builder custom Windows sign hook (SSL.com eSigner).
//
// WHY THIS EXISTS
// ---------------
// The Windows installers ship from CI unsigned → SmartScreen shows "Unknown
// publisher". We hold an SSL.com OV Code Signing certificate for
// "Intelliverse X Inc." with an eSigner cloud signing credential — no USB
// token, so CI can sign with CodeSignTool (SSL.com's CLI, a Java app).
//
// Signing MUST happen inside the electron-builder run (not as a later
// workflow step): electron-builder computes the sha512 in latest.yml from the
// final installer bytes, and electron-updater verifies that hash before
// applying an update. Signing after packaging would corrupt the update feed.
//
// HOW IT'S WIRED (CI-only, mirrors the macOS CSC_LINK gating)
// -----------------------------------------------------------
// package.json keeps win.signAndEditExecutable=false so local/dev builds are
// untouched (turning it on pulls electron-builder's winCodeSign archive,
// which fails to extract on non-admin Windows — see set-exe-identity.mjs).
// desktop-release.yml re-enables it ONLY when the ES_* secrets exist:
//
//   -c.win.signAndEditExecutable=true
//   -c.win.signtoolOptions.sign=scripts/esigner-sign.mjs
//
// electron-builder then calls this hook for the app exe and each installer
// (nsis exe / msi). With signAndEditExecutable=true electron-builder also
// does its own rcedit pass (icon + version metadata), so after-pack.mjs skips
// its stamp when this hook is active — stamping AFTER signing would break the
// signature.
//
// Required env (all four, else the hook throws — a partially-signed release
// must never publish):
//   ES_USERNAME / ES_PASSWORD    — SSL.com account
//   ES_TOTP_SECRET               — eSigner OTP secret (base64 text under the QR)
//   ES_CREDENTIAL_ID             — eSigner signing credential UUID
//   CODE_SIGN_TOOL_PATH          — CodeSignTool install dir (workflow downloads it)
//
// electron-builder invokes the hook TWICE per file (sha1 + sha256 passes).
// eSigner always applies a sha256 RFC3161 timestamped signature, so the sha1
// pass is skipped — double-signing would just re-upload the file for nothing.

import { execFileSync } from 'node:child_process'
import { existsSync, copyFileSync, rmSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REQUIRED = ['ES_USERNAME', 'ES_PASSWORD', 'ES_TOTP_SECRET', 'ES_CREDENTIAL_ID']

export default async function sign(configuration) {
  const file = configuration.path

  // Second electron-builder pass (sha1) — eSigner already signed with sha256.
  if (configuration.hash === 'sha1') {
    console.log(`[esigner-sign] skip sha1 pass for ${path.basename(file)} (sha256 already applied)`)
    return
  }

  const missing = REQUIRED.filter(v => !process.env[v])
  if (missing.length === REQUIRED.length) {
    // No eSigner env at all → unsigned build (local dev, forks). Same
    // behaviour as before this hook existed.
    console.warn(`[esigner-sign] ES_* env not set — leaving ${path.basename(file)} unsigned`)
    return
  }
  if (missing.length > 0) {
    // PARTIAL env is a misconfiguration; publishing a half-signed release
    // silently would be worse than failing the build.
    throw new Error(`[esigner-sign] missing env: ${missing.join(', ')}`)
  }

  const toolDir = process.env.CODE_SIGN_TOOL_PATH
  if (!toolDir || !existsSync(toolDir)) {
    throw new Error(`[esigner-sign] CODE_SIGN_TOOL_PATH not set or missing: ${toolDir}`)
  }
  // Run the jar directly instead of CodeSignTool.bat: Node refuses to spawn
  // .bat files without shell:true (EINVAL), and shell:true would put the
  // password through cmd.exe quoting. `java -jar` takes argv verbatim.
  const jarDir = path.join(toolDir, 'jar')
  const jar = existsSync(jarDir) && readdirSync(jarDir).find(f => f.endsWith('.jar'))
  if (!jar) {
    throw new Error(`[esigner-sign] no jar found under ${jarDir}`)
  }

  // CodeSignTool refuses -output_dir_path == input dir, so sign into a temp
  // dir and move the signed file back over the original.
  const outDir = mkdtempSync(path.join(tmpdir(), 'esigner-'))
  const signed = path.join(outDir, path.basename(file))

  console.log(`[esigner-sign] signing ${path.basename(file)} via eSigner (Intelliverse X Inc.)`)
  try {
    execFileSync(
      'java',
      [
        '-jar',
        path.join(jarDir, jar),
        'sign',
        `-username=${process.env.ES_USERNAME}`,
        `-password=${process.env.ES_PASSWORD}`,
        `-totp_secret=${process.env.ES_TOTP_SECRET}`,
        `-credential_id=${process.env.ES_CREDENTIAL_ID}`,
        `-input_file_path=${file}`,
        `-output_dir_path=${outDir}`
      ],
      // cwd at the install dir so the tool finds conf/code_sign_tool.properties;
      // CODE_SIGN_TOOL_PATH is already in process.env for the same reason.
      { cwd: toolDir, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, timeout: 10 * 60 * 1000 }
    )
    if (!existsSync(signed)) {
      throw new Error('CodeSignTool exited 0 but produced no signed file')
    }
    // copy (not rename): temp dir can be on another drive → EXDEV on rename.
    copyFileSync(signed, file)
    console.log(`[esigner-sign] signed ${path.basename(file)}`)
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}
