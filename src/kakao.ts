/**
 * 카카오톡 연동 계층.
 *
 * 읽기·전송 모두 직접 만든 `native/tkt-ax`가 담당한다. AX 트리를 직접 다루므로 빠르고
 * 카카오톡 창을 앞으로 끌어올리지 않는다.
 *
 * 채팅방은 카카오톡 창 제목으로 식별한다. 닫혀 있는 방은 헬퍼가 채팅 목록에서 찾아
 * 열 수 있다. 외부 도구 없이 이 저장소만으로 동작한다.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify, stripVTControlCharacters } from 'node:util'

const run = promisify(execFile)

/** tkt-ax read 가 돌려주는 메시지 한 줄. */
export type Message = {
  time: string
  author: string | null
  body: string
  mine: boolean
  attachment?: boolean
}

function terminalText(value: string): string {
  return stripVTControlCharacters(value)
    .replace(/\r\n?|\u2028|\u2029/gu, '\n')
    .replace(/\t/gu, '    ')
    .replace(/\p{Cc}/gu, (character) => character === '\n' ? '\n' : '')
}

export function displayChatTitle(title: string): string {
  return terminalText(title).replace(/\n/gu, ' ')
}

/**
 * 헬퍼는 카카오톡 UI를 직접 다루기 때문에 두 호출이 겹치면 서로를 방해한다.
 * 읽기·전송을 한 줄로 세워 순차 실행한다.
 */
let queue: Promise<unknown> = Promise.resolve()

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task)
  queue = next.catch(() => undefined)
  return next
}

// src/ 와 dist/ 모두 프로젝트 루트 한 단계 아래라 같은 경로로 해석된다.
const AX_HELPER = fileURLToPath(new URL('../native/tkt-ax', import.meta.url))

class HelperError extends Error {
  constructor(
    readonly code: string | number | null | undefined,
    readonly timedOut: boolean,
    detail: string,
  ) {
    super(detail)
  }
}

async function tktAx(args: string[], timeoutMs = 60_000): Promise<string> {
  try {
    const { stdout } = await run(AX_HELPER, args, {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf8',
    })
    return stdout
  } catch (error) {
    const { code, killed, signal, stderr } = error as {
      code?: number | string | null
      killed?: boolean
      signal?: string | null
      stderr?: string
    }
    const timedOut = killed === true && signal === 'SIGTERM'
    const detail = terminalText(stderr ?? '').trim()
    if (args[0] === 'send' && !detail && (timedOut || signal)) {
      throw new HelperError(code, timedOut, '전송 결과를 확인하지 못했습니다. 다시 보내기 전에 카카오톡에서 확인해 주세요.')
    }
    throw new HelperError(code, timedOut, detail || (timedOut
      ? '카카오톡이 정해진 시간 안에 응답하지 않았습니다.'
      : '카카오톡 연동 명령을 실행하지 못했습니다.'))
  }
}

function parseHelperResponse(output: string): Record<string, unknown> {
  let result: unknown
  try {
    result = JSON.parse(output)
  } catch {
    throw new Error('카카오톡 연동 응답을 읽지 못했습니다.')
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('카카오톡 연동 응답 형식이 올바르지 않습니다.')
  }
  return result as Record<string, unknown>
}

/**
 * 지금 열려 있는 카카오톡 채팅창 제목들. 채팅 목록 창은 빠진다.
 *
 * 창 제목만 훑는 가벼운 조회(0.3초)라 직렬 큐를 타지 않는다. 큐에 넣으면 읽기가
 * 진행 중일 때도 채팅방 목록을 열 수 있어야 한다.
 */
export async function listOpenChats(): Promise<string[]> {
  const out = await tktAx(['windows'])
  const { windows } = parseHelperResponse(out)
  if (!Array.isArray(windows) || !windows.every((title): title is string => typeof title === 'string')) {
    throw new Error('카카오톡 채팅창 목록 형식이 올바르지 않습니다.')
  }
  // 같은 제목의 창은 전송 대상을 구분할 수 없다.
  return windows.filter((chat) => windows.indexOf(chat) === windows.lastIndexOf(chat))
}

/** 정확한 제목의 채팅창이 열려 있지 않을 때 반환하는 헬퍼 종료 코드. */
const WINDOW_CLOSED = 3

/**
 * 닫혀 있는 채팅방을 연다.
 *
 * 카카오톡 채팅 목록에서 방을 찾아 여는데, 목록 창까지 닫혀 있으면 「창 → 채팅」 메뉴로
 * 되살린다. 앱 포커스는 뺏지 않지만 채팅창이 새로 뜨므로 화면에는 나타난다.
 */
export function openChat(chatName: string): Promise<void> {
  return serialize(async () => {
    await tktAx(['open', chatName])
  })
}

/** 채팅창의 최근 메시지를 읽는다. 창이 닫혀 있으면 한 번 열고 다시 시도한다. */
export function readMessages(chatName: string, limit: number): Promise<Message[]> {
  return serialize(async () => {
    const parse = async () => {
      const out = await tktAx(['read', chatName, String(limit)])
      const { messages } = parseHelperResponse(out) as { messages?: Message[] }
      if (!Array.isArray(messages) || messages.some((entry) => (
        !entry || typeof entry.time !== 'string' || typeof entry.body !== 'string' || typeof entry.mine !== 'boolean'
        || (entry.author !== null && typeof entry.author !== 'string')
        || (entry.attachment !== undefined && typeof entry.attachment !== 'boolean')
      ))) {
        throw new Error('카카오톡 대화 기록 형식이 올바르지 않습니다.')
      }
      return messages.map((entry) => ({ ...entry, time: displayChatTitle(entry.time), body: terminalText(entry.body) }))
    }

    try {
      return await parse()
    } catch (error) {
      if (!(error instanceof HelperError) || error.code !== WINDOW_CLOSED) throw error

      await tktAx(['open', chatName])
      return await parse()
    }
  })
}

export function sendMessage(chatName: string, text: string): Promise<void> {
  return serialize(async () => {
    await tktAx(['send', chatName, text])
  })
}

/** `tkt-ax check` 가 돌려주는 준비 상태. */
type Readiness = { trusted: boolean; kakaoRunning: boolean }

const ACCESSIBILITY_HELP = [
  '손쉬운 사용(Accessibility) 권한 — 지금 쓰는 터미널 앱에 권한이 없습니다.',
  '시스템 다이얼로그가 떴다면 「시스템 설정 열기」를 누르세요.',
  '뜨지 않았다면 (이미 목록에 있는데 꺼져 있는 경우) 직접 켜야 합니다.',
  '시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용에서 이 터미널 앱을 켜세요.',
  '권한은 터미널 앱마다 따로입니다 (Terminal, iTerm, VS Code 내장 터미널…).',
  '켠 뒤에는 터미널을 완전히 종료했다 다시 열어야 반영됩니다.',
].join('\n')

const BUILD_HELP = 'native/tkt-ax — `npm run build:native` 로 빌드하세요 (Xcode Command Line Tools 필요)'

/**
 * 헬퍼는 있는데 진단이 실패했을 때의 안내.
 *
 * 예전에는 이 경우도 "빌드하세요" 로 뭉뚱그렸는데, 실제로는 헬퍼가 응답하지 않거나
 * 실행 자체가 막힌 경우가 섞여 있어서 엉뚱한 곳을 보게 만들었다. 원인을 그대로 보여준다.
 */
function helperFailedHelp(error: unknown): string {
  const timedOut = error instanceof HelperError && error.timedOut
  const reason = error instanceof Error ? error.message : String(error)

  const lines = timedOut
    ? ['native/tkt-ax — 헬퍼가 10초 안에 응답하지 않았습니다.']
    : ['native/tkt-ax — 헬퍼를 실행하지 못했습니다.']

  lines.push(`직접 실행해 무엇이 나오는지 확인하세요: ./native/tkt-ax check`)
  lines.push(`자세한 진단: npm run doctor`)
  if (!timedOut) lines.push(`오류: ${reason}`)
  return lines.join('\n')
}

/**
 * 준비되지 않은 항목을 안내 문구로 돌려준다.
 *
 * 접근성 권한이 없으면 AX API 가 통째로 막혀서, 나중에 나오는 오류는 원인을 알려주지
 * 않는다. 그래서 시작할 때 헬퍼에게 한 번 물어보고 여기서 걸러낸다.
 */
export async function missingTools(): Promise<string[]> {
  if (!existsSync(AX_HELPER)) return [BUILD_HELP]

  let readiness: Readiness
  try {
    // 진단 한 번에 10초를 넘길 이유가 없다. 넘긴다면 헬퍼가 멈춘 것이니 그렇게 알린다.
    const { trusted, kakaoRunning } = parseHelperResponse(await tktAx(['check'], 10_000))
    if (typeof trusted !== 'boolean' || typeof kakaoRunning !== 'boolean') {
      throw new Error('카카오톡 준비 상태의 응답 형식이 올바르지 않습니다.')
    }
    readiness = { trusted, kakaoRunning }
  } catch (error) {
    return [helperFailedHelp(error)]
  }

  const missing: string[] = []
  if (!readiness.trusted) missing.push(ACCESSIBILITY_HELP)
  if (!readiness.kakaoRunning) {
    missing.push('카카오톡 Mac 앱 — 실행해 로그인하고, 쓰려는 채팅방 창을 열어두세요.')
  }
  return missing
}
