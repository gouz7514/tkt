import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

export type Config = {
  /** 카카오톡 채팅창 제목. 채팅방을 식별하는 유일한 키다. */
  displayName: string
  /** 한 번 읽고 나서 다음 읽기까지 쉬는 시간(ms). */
  pollIntervalMs: number
  /** 화면에 유지할 최근 메시지 수. */
  historyLimit: number
} & Partial<AppearanceSettings>

export const promptThemes = {
  original: 'Original',
  agnoster: 'Agnoster',
  robbyrussell: 'Robbyrussell',
  minimal: 'Minimal',
} as const

export type PromptTheme = keyof typeof promptThemes

export const ansiColors = ['cyan', 'green', 'yellow', 'magenta', 'blue', 'red'] as const
export type AnsiColor = typeof ansiColors[number]
export const promptColors = ['default', 'black', ...ansiColors] as const
export type HexColor = `#${string}`

export type AppearanceSettings = {
  promptTheme: PromptTheme
  attachmentColor: AnsiColor
  selfName: string
  nameColor: AnsiColor | HexColor
  promptColor: typeof promptColors[number] | HexColor
}

export const terminalApps = {
  current: '현재 터미널',
  terminal: 'Terminal',
  iterm2: 'iTerm2',
} as const

export type TerminalApp = keyof typeof terminalApps
type ConfigFile = Partial<Config> & {
  terminal?: TerminalApp
  agnosterColor?: AnsiColor
  agnosterContextColor?: 'black' | AnsiColor
}

// 프로젝트 루트의 config.json. src/ 와 dist/ 모두 루트 한 단계 아래라 같은 곳을 가리킨다.
const FILE = fileURLToPath(new URL('../config.json', import.meta.url))

export const DEFAULTS = {
  pollIntervalMs: 1_000,
  historyLimit: 30,
  selfName: 'me000',
  nameColor: '#C8B6FF' as const,
  promptColor: 'black' as const,
}

export function singleLineName(value: string): string {
  return value.replace(/[\p{Cc}\u2028\u2029]/gu, '')
}

export function parseHexColor(value: unknown): HexColor | undefined {
  if (typeof value !== 'string') return undefined
  const color = value.trim().toUpperCase()
  return /^#[0-9A-F]{6}$/.test(color) ? color as HexColor : undefined
}

export function isTerminalApp(value: unknown): value is TerminalApp {
  return typeof value === 'string' && Object.hasOwn(terminalApps, value)
}

async function readConfig(): Promise<Record<string, unknown>> {
  let raw: string
  try {
    raw = await readFile(FILE, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }

  const invalidFile = () => new Error(`설정 파일의 JSON 형식을 확인해 주세요. (${FILE})`)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw invalidFile()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidFile()
  return parsed as Record<string, unknown>
}

function configInteger(value: unknown, minimum: number, fallback: number, maximum = Number.MAX_SAFE_INTEGER) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback
}

export async function loadConfig(): Promise<Config | null> {
  const parsed = await readConfig()
  if (typeof parsed.displayName !== 'string' || !parsed.displayName) return null
  return {
    displayName: parsed.displayName,
    pollIntervalMs: configInteger(parsed.pollIntervalMs, 1, DEFAULTS.pollIntervalMs, 2_147_483_647),
    historyLimit: configInteger(parsed.historyLimit, 0, DEFAULTS.historyLimit),
    promptTheme: typeof parsed.promptTheme === 'string' && Object.hasOwn(promptThemes, parsed.promptTheme)
      ? parsed.promptTheme as PromptTheme
      : undefined,
    attachmentColor: ansiColors.find((color) => color === parsed.attachmentColor),
    nameColor: parseHexColor(parsed.nameColor)
      ?? ansiColors.find((color) => color === parsed.nameColor)
      ?? ansiColors.find((color) => color === parsed.agnosterColor),
    promptColor: parseHexColor(parsed.promptColor)
      ?? promptColors.find((color) => color === parsed.promptColor)
      ?? promptColors.find((color) => color === parsed.agnosterContextColor),
    selfName: typeof parsed.selfName === 'string'
      ? singleLineName(parsed.selfName).trim() || DEFAULTS.selfName
      : DEFAULTS.selfName,
  }
}

export async function loadTerminalApp(): Promise<TerminalApp> {
  const { terminal } = await readConfig()
  return isTerminalApp(terminal) ? terminal : 'current'
}

async function lockConfig() {
  // Darwin의 O_EXLOCK은 파일을 닫거나 프로세스가 끝나면 해제됩니다. Node는 이 상수를 제공하지 않습니다.
  const O_EXLOCK = 0x20
  const flags = constants.O_CREAT | constants.O_RDWR | constants.O_NONBLOCK | O_EXLOCK
  const deadline = performance.now() + 5_000
  // 설정 파일이 rename으로 교체되어도 모든 저장 작업이 같은 잠금 파일을 사용합니다.
  while (true) {
    try {
      return await open(`${FILE}.lock.tmp`, flags, 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EAGAIN') throw error
      if (performance.now() >= deadline) throw new Error('설정 파일이 사용 중입니다. 잠시 후 다시 시도해 주세요.')
      await delay(50)
    }
  }
}

export async function saveConfig(changes: ConfigFile): Promise<string> {
  const lock = await lockConfig()
  try {
    const config = { ...await readConfig(), ...changes }
    if (changes.nameColor !== undefined) delete config.agnosterColor
    if (changes.promptColor !== undefined) delete config.agnosterContextColor
    const temp = `${FILE}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
      await rename(temp, FILE)
    } finally {
      await rm(temp, { force: true })
    }
  } finally {
    await lock.close()
  }
  return FILE
}

export const configPath = FILE
