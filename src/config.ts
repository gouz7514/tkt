import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'

export type Config = {
  /** 카카오톡 채팅창 제목. 채팅방을 식별하는 유일한 키다. */
  displayName: string
  /** 한 번 읽고 나서 다음 읽기까지 쉬는 시간(ms). */
  pollIntervalMs: number
  /** 화면에 유지할 최근 메시지 수. */
  historyLimit: number
}

// 프로젝트 루트의 config.json. src/ 와 dist/ 모두 루트 한 단계 아래라 같은 곳을 가리킨다.
const FILE = fileURLToPath(new URL('../config.json', import.meta.url))

export const DEFAULTS = {
  pollIntervalMs: 1_000,
  historyLimit: 30,
}

export async function loadConfig(): Promise<Config | null> {
  try {
    const raw = await readFile(FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<Config>
    if (!parsed.displayName) return null
    return {
      displayName: parsed.displayName,
      pollIntervalMs: parsed.pollIntervalMs ?? DEFAULTS.pollIntervalMs,
      historyLimit: parsed.historyLimit ?? DEFAULTS.historyLimit,
    }
  } catch {
    return null
  }
}

export async function saveConfig(config: Config): Promise<string> {
  await writeFile(FILE, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return FILE
}

export const configPath = FILE
