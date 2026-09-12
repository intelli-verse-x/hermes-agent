import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface LocalAiCleanupOptions {
  directories: string[]
  stopSidecar?: () => Promise<unknown>
}

export interface LocalAiCleanupResult {
  removed: string[]
  missing: string[]
}

export interface RemoveLocalAiInstallationOptions {
  rootDirectory: string
  managedPaths: string[]
  stopSidecar?: () => Promise<unknown>
}

function assertSafeCleanupPath(candidate: string): string {
  if (!path.isAbsolute(candidate)) {
    throw new Error(`Cleanup path must be absolute: ${candidate}`)
  }
  const normalized = path.resolve(candidate)
  const filesystemRoot = path.parse(normalized).root
  const forbidden = new Set([filesystemRoot, path.resolve(os.homedir()), path.resolve(os.tmpdir())])

  if (forbidden.has(normalized)) {
    throw new Error(`Refusing unsafe cleanup path: ${normalized}`)
  }

  if (normalized.split(path.sep).filter(Boolean).length < 3) {
    throw new Error(`Refusing shallow cleanup path: ${normalized}`)
  }

  return normalized
}

export async function cleanupLocalAiInstallation(options: LocalAiCleanupOptions): Promise<LocalAiCleanupResult> {
  await options.stopSidecar?.()
  const directories = [...new Set(options.directories.map(assertSafeCleanupPath))].sort()
  const result: LocalAiCleanupResult = { removed: [], missing: [] }

  for (const directory of directories) {
    try {
      await fs.lstat(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        result.missing.push(directory)

        continue
      }

      throw error
    }

    await fs.rm(directory, { recursive: true, force: false })
    result.removed.push(directory)
  }

  return result
}

export async function removeLocalAiInstallation(
  options: RemoveLocalAiInstallationOptions
): Promise<LocalAiCleanupResult> {
  const root = assertSafeCleanupPath(options.rootDirectory)

  const managed = options.managedPaths.map(relativePath => {
    if (!relativePath || path.isAbsolute(relativePath)) {
      throw new Error(`Managed cleanup path must be relative: ${relativePath}`)
    }

    const candidate = path.resolve(root, relativePath)
    const relative = path.relative(root, candidate)

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Managed cleanup path escapes root: ${relativePath}`)
    }

    return candidate
  })

  return cleanupLocalAiInstallation({
    directories: managed,
    stopSidecar: options.stopSidecar
  })
}

export const uninstallInternals = { assertSafeCleanupPath }
