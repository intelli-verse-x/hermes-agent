import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import { promisify } from 'node:util'

import { type HardwareProfile, LOCAL_AI_SCHEMA_VERSION, type LocalAiAcceleration } from './types'

export interface HardwareProbeDependencies {
  platform(): NodeJS.Platform
  arch(): NodeJS.Architecture
  cpus(): Array<{ model: string }>
  totalmem(): number
  freemem(): number
  readFile(path: string, encoding: BufferEncoding): Promise<string>
  execFile(command: string, args: string[]): Promise<{ stdout: string; stderr?: string }>
}

const execFileAsync = promisify(execFile)

const defaultDependencies: HardwareProbeDependencies = {
  platform: os.platform,
  arch: () => os.arch() as NodeJS.Architecture,
  cpus: os.cpus,
  totalmem: os.totalmem,
  freemem: os.freemem,
  readFile: (path, encoding) => fs.readFile(path, encoding),
  execFile: async (command, args) => {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true
    })

    return { stdout: result.stdout, stderr: result.stderr }
  }
}

function positiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value)

  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback
}

function parseFirstInteger(value: string): number | undefined {
  const match = value.match(/\d[\d,]*/)

  if (!match) {return undefined}
  const parsed = Number(match[0].replaceAll(',', ''))

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function parseNvidiaMemoryBytes(value: string): number | undefined {
  const mib = parseFirstInteger(value)

  return mib ? mib * 1024 * 1024 : undefined
}

function uniqueAccelerators(values: LocalAiAcceleration[]): LocalAiAcceleration[] {
  const order: LocalAiAcceleration[] = ['metal', 'cuda', 'rocm', 'vulkan', 'cpu']
  const set = new Set(values)
  set.add('cpu')

  return order.filter(value => set.has(value))
}

async function optionalCommand(
  deps: HardwareProbeDependencies,
  command: string,
  args: string[]
): Promise<string> {
  try {
    return (await deps.execFile(command, args)).stdout.trim()
  } catch {
    return ''
  }
}

async function optionalFile(deps: HardwareProbeDependencies, path: string): Promise<string> {
  try {
    return await deps.readFile(path, 'utf8')
  } catch {
    return ''
  }
}

function linuxPhysicalCpuCount(cpuInfo: string): number | undefined {
  const packages = new Set<string>()

  for (const block of cpuInfo.split(/\n\s*\n/)) {
    const physical = block.match(/^physical id\s*:\s*(.+)$/m)?.[1]
    const core = block.match(/^core id\s*:\s*(.+)$/m)?.[1]

    if (physical !== undefined && core !== undefined) {packages.add(`${physical}:${core}`)}
  }

  return packages.size || undefined
}

function detectAccelerators(platform: NodeJS.Platform, text: string): LocalAiAcceleration[] {
  const lowered = text.toLowerCase()
  const detected: LocalAiAcceleration[] = []

  if (platform === 'darwin' && /(apple|metal)/.test(lowered)) {detected.push('metal')}

  if (/(nvidia|cuda)/.test(lowered)) {detected.push('cuda')}

  if (/(amd|radeon|rocm)/.test(lowered)) {detected.push('rocm')}

  if (/vulkan/.test(lowered)) {detected.push('vulkan')}

  return uniqueAccelerators(detected)
}

export async function probeHardware(
  overrides: Partial<HardwareProbeDependencies> = {}
): Promise<HardwareProfile> {
  const deps = { ...defaultDependencies, ...overrides }
  const platform = deps.platform()
  const cpus = deps.cpus()
  let physicalCpuCount: number | undefined
  let gpuText = cpus.map(cpu => cpu.model).join('\n')
  let gpuMemoryBytes: number | undefined
  let gpuMemorySource: HardwareProfile['gpuMemorySource']

  if (platform === 'darwin') {
    physicalCpuCount = parseFirstInteger(await optionalCommand(deps, 'sysctl', ['-n', 'hw.physicalcpu']))
    gpuText += `\n${await optionalCommand(deps, 'system_profiler', ['SPDisplaysDataType', '-json'])}`

    if (/\bapple\b|\bmetal\b/i.test(gpuText)) {
      gpuMemoryBytes = Math.floor(deps.totalmem() * 0.7)
      gpuMemorySource = 'unified-memory'
    }
  } else if (platform === 'linux') {
    physicalCpuCount = linuxPhysicalCpuCount(await optionalFile(deps, '/proc/cpuinfo'))
    gpuText += `\n${await optionalCommand(deps, 'lspci', ['-mm'])}`

    const nvidiaMemory = await optionalCommand(deps, 'nvidia-smi', [
      '--query-gpu=memory.total',
      '--format=csv,noheader,nounits'
    ])

    gpuMemoryBytes = parseNvidiaMemoryBytes(nvidiaMemory)

    if (gpuMemoryBytes) {gpuMemorySource = 'nvidia-smi'}
  } else if (platform === 'win32') {
    physicalCpuCount = parseFirstInteger(
      await optionalCommand(deps, 'powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-CimInstance Win32_Processor | Measure-Object NumberOfCores -Sum).Sum'
      ])
    )

    const gpuJson = await optionalCommand(deps, 'powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress'
    ])

    gpuText += `\n${gpuJson}`
    const adapterMatches = [...gpuJson.matchAll(/"AdapterRAM"\s*:\s*(\d+)/g)]
    gpuMemoryBytes = Math.max(0, ...adapterMatches.map(match => Number(match[1]))) || undefined

    if (gpuMemoryBytes) {gpuMemorySource = 'adapter-reported'}
  }

  const memoryBytes = positiveInteger(deps.totalmem(), 1)

  return {
    schemaVersion: LOCAL_AI_SCHEMA_VERSION,
    platform,
    architecture: deps.arch(),
    logicalCpuCount: positiveInteger(cpus.length, 1),
    physicalCpuCount,
    memoryBytes,
    freeMemoryBytes: Math.max(0, Math.floor(Number(deps.freemem()) || 0)),
    usableMemoryBytes: Math.max(1, Math.floor(memoryBytes * 0.65)),
    accelerators: detectAccelerators(platform, gpuText),
    gpuMemoryBytes,
    gpuMemorySource
  }
}

export const hardwareInternals = {
  detectAccelerators,
  linuxPhysicalCpuCount,
  parseFirstInteger,
  parseNvidiaMemoryBytes
}
