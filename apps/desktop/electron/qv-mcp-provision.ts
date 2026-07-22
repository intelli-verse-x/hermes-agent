import fs from 'node:fs'
import path from 'node:path'

import { parseDocument } from 'yaml'

export interface QvMcpProvisionInput {
  electronExecutable: string
  hermesHome: string
  mcpRelayPath: string
  mcpServerPath: string
  skillsSource: string
  socketPath: string
}

export interface QvMcpProvisionResult {
  configChanged: boolean
  serverPath: string
  skillCount: number
}

function copyDirectory(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true })

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)

    if (entry.isDirectory()) {
      copyDirectory(from, to)
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to)
    }
  }
}

function atomicWrite(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

function mcpEntry(input: QvMcpProvisionInput) {
  return {
    args: [input.mcpRelayPath],
    command: input.electronExecutable,
    enabled: true,
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      QUIZVERSE_MCP_SERVER_SOCKET: input.socketPath
    }
  }
}

/**
 * Structurally merge QuizVerse's MCP entry while retaining the YAML document's
 * comments and unrelated keys. Runtime broker secrets are inherited from the
 * Electron process and intentionally never appear here.
 */
export function provisionQuizverseMcp(input: QvMcpProvisionInput): QvMcpProvisionResult {
  if (!fs.existsSync(input.mcpServerPath)) {
    throw new Error(`QuizVerse MCP server is missing: ${input.mcpServerPath}`)
  }

  if (!fs.existsSync(input.mcpRelayPath)) {
    throw new Error(`QuizVerse MCP relay is missing: ${input.mcpRelayPath}`)
  }

  if (!fs.existsSync(input.skillsSource)) {
    throw new Error(`QuizVerse skill bundle is missing: ${input.skillsSource}`)
  }

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
    throw new Error(`QuizVerse cannot safely update invalid config.yaml: ${document.errors[0].message}`)
  }

  const desired = mcpEntry(input)
  const current = document.getIn(['mcp_servers', 'quizverse'], true)

  const currentJson =
    current && typeof current === 'object' && 'toJSON' in current
      ? (current as { toJSON: () => unknown }).toJSON()
      : current

  const configChanged = JSON.stringify(currentJson) !== JSON.stringify(desired)

  if (configChanged) {
    document.setIn(['mcp_servers', 'quizverse'], desired)
    atomicWrite(configPath, document.toString())
  }

  const skillsRoot = path.join(input.hermesHome, 'skills')
  const destination = path.join(skillsRoot, 'quizverse')
  const temporary = path.join(skillsRoot, `.quizverse.${process.pid}.tmp`)
  fs.rmSync(temporary, { force: true, recursive: true })
  copyDirectory(input.skillsSource, temporary)
  fs.rmSync(destination, { force: true, recursive: true })
  fs.renameSync(temporary, destination)

  const skillCount = fs
    .readdirSync(destination, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(destination, entry.name, 'SKILL.md'))).length

  return { configChanged, serverPath: input.mcpServerPath, skillCount }
}
