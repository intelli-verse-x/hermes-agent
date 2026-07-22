import fs from 'node:fs/promises'
import path from 'node:path'

import {
  createDefaultSettings,
  LOCAL_AI_SCHEMA_VERSION,
  type LocalAiSettings,
  type LocalAiStatus,
  type LocalAiTelemetryEvent
} from './types'

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })

  try {
    await fs.rename(temporaryPath, filePath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true })
    throw error
  }
}

async function readJson(filePath: string): Promise<unknown | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8'))
    await fs.chmod(filePath, 0o600)

    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

export function sanitizeTelemetryEvent(value: LocalAiTelemetryEvent): LocalAiTelemetryEvent {
  return {
    schemaVersion: LOCAL_AI_SCHEMA_VERSION,
    name: value.name,
    outcome: value.outcome,
    durationMs: finiteNonNegative(value.durationMs),
    timestamp: value.timestamp,
    ...(value.modelId ? { modelId: value.modelId } : {}),
    ...(value.errorCode ? { errorCode: value.errorCode } : {}),
    ...(value.inputTokenCount !== undefined ? { inputTokenCount: finiteNonNegative(value.inputTokenCount) } : {}),
    ...(value.outputTokenCount !== undefined ? { outputTokenCount: finiteNonNegative(value.outputTokenCount) } : {})
  }
}

export class LocalAiPersistence {
  readonly settingsPath: string
  readonly statusPath: string
  readonly telemetryPath: string

  constructor(readonly directory: string) {
    this.settingsPath = path.join(directory, 'settings.json')
    this.statusPath = path.join(directory, 'status.json')
    this.telemetryPath = path.join(directory, 'telemetry.jsonl')
  }

  async loadSettings(): Promise<LocalAiSettings> {
    const value = (await readJson(this.settingsPath)) as Partial<LocalAiSettings> | undefined

    if (!value) {
      return createDefaultSettings()
    }

    if (value.schemaVersion !== LOCAL_AI_SCHEMA_VERSION) {
      throw new Error('Unsupported local AI settings version')
    }

    return {
      schemaVersion: LOCAL_AI_SCHEMA_VERSION,
      enabled: Boolean(value.enabled),
      endpointMode: value.endpointMode === 'existing' ? 'existing' : 'managed',
      ...(typeof value.preferredModelId === 'string' ? { preferredModelId: value.preferredModelId } : {}),
      ...(typeof value.existingEndpoint === 'string' ? { existingEndpoint: value.existingEndpoint } : {}),
      ...(typeof value.maxContextTokens === 'number' && value.maxContextTokens > 0
        ? { maxContextTokens: Math.floor(value.maxContextTokens) }
        : {})
    }
  }

  async saveSettings(settings: LocalAiSettings): Promise<void> {
    if (settings.schemaVersion !== LOCAL_AI_SCHEMA_VERSION) {
      throw new Error('Unsupported local AI settings version')
    }
    await writeJsonAtomic(this.settingsPath, settings)
  }

  async loadStatus(): Promise<LocalAiStatus | undefined> {
    const value = (await readJson(this.statusPath)) as LocalAiStatus | undefined

    if (value && value.schemaVersion !== LOCAL_AI_SCHEMA_VERSION) {
      throw new Error('Unsupported local AI status version')
    }

    return value
  }

  async saveStatus(status: LocalAiStatus): Promise<void> {
    if (status.schemaVersion !== LOCAL_AI_SCHEMA_VERSION) {
      throw new Error('Unsupported local AI status version')
    }
    await writeJsonAtomic(this.statusPath, status)
  }

  async appendTelemetry(event: LocalAiTelemetryEvent): Promise<void> {
    const sanitized = sanitizeTelemetryEvent(event)
    await fs.mkdir(this.directory, { recursive: true })
    await fs.appendFile(this.telemetryPath, `${JSON.stringify(sanitized)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    await fs.chmod(this.telemetryPath, 0o600)
  }
}
