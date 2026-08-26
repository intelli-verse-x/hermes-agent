import fs from 'node:fs'
import path from 'node:path'

import { parseDocument } from 'yaml'

import { provisionFoundrlySkills } from './foundrly-skills-provision'

export interface FoundrlyMcpProvisionInput {
  electronExecutable: string
  hermesHome: string
  mcpServerPath: string
  skillsSource: string
}

export interface FoundrlyMcpProvisionResult {
  configChanged: boolean
  serverPath: string
  skillCount: number
}

function atomicWrite(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

/**
 * Stdio MCP entry — Hermes spawns Electron-as-Node on server.mjs.
 * No broker secret (product knowledge only; no Mail Studio / CRM).
 */
export function foundrlyMcpEntry(input: Pick<FoundrlyMcpProvisionInput, 'electronExecutable' | 'mcpServerPath'>) {
  return {
    args: [input.mcpServerPath],
    command: input.electronExecutable,
    enabled: true,
    env: {
      ELECTRON_RUN_AS_NODE: '1'
    }
  }
}

/**
 * Copy Foundrly skills and register mcp_servers.foundrly for left-rail Hermes.
 * Foundrly brand only — does not touch QuizVerse / IX Agency MCP configs.
 */
export function provisionFoundrlyMcp(input: FoundrlyMcpProvisionInput): FoundrlyMcpProvisionResult {
  if (!fs.existsSync(input.mcpServerPath)) {
    throw new Error(`Foundrly MCP server is missing: ${input.mcpServerPath}`)
  }

  const skills = provisionFoundrlySkills({
    hermesHome: input.hermesHome,
    skillsSource: input.skillsSource
  })

  fs.mkdirSync(input.hermesHome, { recursive: true })
  const configPath = path.join(input.hermesHome, 'config.yaml')
  let existing = ''

  try {
    existing = fs.readFileSync(configPath, 'utf8')
  } catch {
    /* first launch */
  }

  const document = parseDocument(existing || '{}\n', { keepSourceTokens: true })

  if (document.errors.length) {
    throw new Error(`Foundrly cannot safely update invalid config.yaml: ${document.errors[0].message}`)
  }

  const desired = foundrlyMcpEntry(input)
  const current = document.getIn(['mcp_servers', 'foundrly'], true)
  const currentJson =
    current && typeof current === 'object' && 'toJSON' in current
      ? (current as { toJSON: () => unknown }).toJSON()
      : current

  const configChanged = JSON.stringify(currentJson) !== JSON.stringify(desired)

  if (configChanged) {
    document.setIn(['mcp_servers', 'foundrly'], desired)
    atomicWrite(configPath, document.toString())
  }

  return {
    configChanged,
    serverPath: input.mcpServerPath,
    skillCount: skills.skillCount
  }
}
