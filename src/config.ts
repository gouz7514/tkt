import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'

export type Config = {
  /** 카카오톡 채팅창 제목. 채팅방을 식별하는 유일한 키다. */
  displayName: string
  /** 한 번 읽고 나서 다음 읽기까지 쉬는 시간(ms). */
  pollIntervalMs: number
  /** 화면에 유지할 최근 메시지 수. */
  historyLimit: number
} & Partial<AppearanceSettings>

export const promptThemes = {
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
  nameColor: 'blue' as const,
  promptColor: 'default' as const,
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

async function readConfig(): Promise<ConfigFile> {
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export async function loadConfig(): Promise<Config | null> {
  const parsed = await readConfig()
  if (!parsed.displayName) return null
  return {
    displayName: parsed.displayName,
    pollIntervalMs: parsed.pollIntervalMs ?? DEFAULTS.pollIntervalMs,
    historyLimit: parsed.historyLimit ?? DEFAULTS.historyLimit,
    promptTheme: typeof parsed.promptTheme === 'string' && Object.hasOwn(promptThemes, parsed.promptTheme)
      ? parsed.promptTheme
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

export async function saveConfig(changes: ConfigFile): Promise<string> {
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
  return FILE
}

export const configPath = FILE
