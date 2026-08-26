import fs from 'node:fs'
import path from 'node:path'

export interface FoundrlySkillsProvisionInput {
  hermesHome: string
  skillsSource: string
}

export interface FoundrlySkillsProvisionResult {
  skillCount: number
  destination: string
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

/**
 * Copy bundled Foundrly skill playbooks into the isolated Foundrly HERMES_HOME.
 * Foundrly-only — no MCP config, no IX Agency / QuizVerse touch.
 */
export function provisionFoundrlySkills(input: FoundrlySkillsProvisionInput): FoundrlySkillsProvisionResult {
  if (!fs.existsSync(input.skillsSource)) {
    throw new Error(`Foundrly skill bundle is missing: ${input.skillsSource}`)
  }

  fs.mkdirSync(input.hermesHome, { recursive: true })

  const skillsRoot = path.join(input.hermesHome, 'skills')
  const destination = path.join(skillsRoot, 'foundrly')
  const temporary = path.join(skillsRoot, `.foundrly.${process.pid}.tmp`)

  fs.rmSync(temporary, { force: true, recursive: true })
  copyDirectory(input.skillsSource, temporary)
  fs.rmSync(destination, { force: true, recursive: true })
  fs.renameSync(temporary, destination)

  const skillCount = fs
    .readdirSync(destination, { withFileTypes: true })
    .filter(
      entry => entry.isDirectory() && fs.existsSync(path.join(destination, entry.name, 'SKILL.md'))
    ).length

  return { skillCount, destination }
}
