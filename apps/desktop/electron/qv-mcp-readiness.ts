import fs from 'node:fs'
import path from 'node:path'

import { parseDocument } from 'yaml'

import { QUIZVERSE_CONTRACTS } from '../../../packages/quizverse-mcp/contracts.mjs'

export const QUIZVERSE_SKILL_IDS = Object.freeze([
  'quizverse-game-ops',
  'quizverse-player-coach',
  'quizverse-quiz-creator',
  'quizverse-rewards-safety',
  'quizverse-social-party',
  'tutorx-learning-coach'
])

export interface QvProvisionReadinessInput {
  configPath: string
  electronExecutable: string
  relayPath: string
  serverPath: string
  serverSocket: string
  skillsRoot: string
}

export interface QvProvisionReadiness {
  ready: boolean
  reason: string
}

export function inspectQuizverseProvision(input: QvProvisionReadinessInput): QvProvisionReadiness {
  if (!fs.existsSync(input.serverPath)) {return degraded(`MCP server is missing: ${input.serverPath}`)}

  if (!fs.existsSync(input.relayPath)) {return degraded(`MCP relay is missing: ${input.relayPath}`)}

  let source = ''

  try {
    source = fs.readFileSync(input.configPath, 'utf8')
  } catch {
    return degraded(`MCP config is missing: ${input.configPath}`)
  }

  const document = parseDocument(source)

  if (document.errors.length) {return degraded(`MCP config YAML is invalid: ${document.errors[0].message}`)}
  const entry = document.getIn(['mcp_servers', 'quizverse'], true)

  const actual = entry && typeof entry === 'object' && 'toJSON' in entry
    ? (entry as { toJSON: () => unknown }).toJSON()
    : entry

  const expected = {
    args: [input.relayPath],
    command: input.electronExecutable,
    enabled: true,
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      QUIZVERSE_MCP_SERVER_SOCKET: input.serverSocket
    }
  }

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    return degraded('QuizVerse MCP config is stale or partial')
  }

  const missingSkills = QUIZVERSE_SKILL_IDS.filter(
    skill => !fs.existsSync(path.join(input.skillsRoot, skill, 'SKILL.md'))
  )

  if (missingSkills.length) {
    return degraded(`QuizVerse skills are incomplete: ${missingSkills.join(', ')}`)
  }

  return { ready: true, reason: 'Provisioned config and skills are complete' }
}

export function validateQuizverseProbe(
  probe: { profileText: string; toolIds: string[] },
  capability: { authKind: 'authenticated' | 'guest'; playerId: string } | null
): QvProvisionReadiness {
  const expected = Object.keys(QUIZVERSE_CONTRACTS).sort()
  const actual = [...probe.toolIds].sort()

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    return degraded(`MCP tool catalog mismatch: expected ${expected.length}, received ${actual.length}`)
  }

  if (!capability?.playerId || !['guest', 'authenticated'].includes(capability.authKind)) {
    return degraded('QuizVerse player capability is unavailable')
  }

  try {
    const profile = JSON.parse(probe.profileText)

    if (!profile || typeof profile !== 'object') {return degraded('Safe profile resource returned invalid data')}
  } catch {
    return degraded('Safe profile resource returned malformed JSON')
  }

  return { ready: true, reason: `Ready as ${capability.authKind}` }
}

function degraded(reason: string): QvProvisionReadiness {
  return { ready: false, reason }
}
