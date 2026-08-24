import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

export type Config = {
  chatId: string
  displayName: string
  /** 한 번 읽고 나서 다음 읽기까지 쉬는 시간(ms). */
  pollIntervalMs: number
  /** 화면에 유지할 최근 메시지 수. */
  historyLimit: number
}

const DIR = join(homedir(), '.config', 'tkt')
const FILE = join(DIR, 'config.json')

export const DEFAULTS = {
  pollIntervalMs: 1_000,
  historyLimit: 30,
}

export async function loadConfig(): Promise<Config | null> {
  try {
    const raw = await readFile(FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<Config>
    if (!parsed.chatId) return null
    return {
      chatId: parsed.chatId,
      displayName: parsed.displayName ?? parsed.chatId,
      pollIntervalMs: parsed.pollIntervalMs ?? DEFAULTS.pollIntervalMs,
      historyLimit: parsed.historyLimit ?? DEFAULTS.historyLimit,
    }
  } catch {
    return null
  }
}

export async function saveConfig(config: Config): Promise<string> {
  await mkdir(DIR, { recursive: true })
  await writeFile(FILE, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return FILE
}

export const configPath = FILE
