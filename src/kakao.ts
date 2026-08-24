/**
 * 카카오톡 연동 계층.
 *
 * 읽기·전송 모두 직접 만든 `native/tkt-ax`가 담당한다. AX 트리를 직접 다루므로 빠르고
 * 카카오톡 포커스를 뺏지 않는다.
 *
 * `kmsg`는 두 군데서만 남아 쓰인다.
 *   1. `tkt setup` 의 채팅방 목록 조회
 *   2. 채팅창이 닫혀 있을 때 다시 여는 용도 — `tkt-ax`는 이미 열린 창만 다루기 때문에
 *      한 번은 창을 띄워줘야 한다. 이때만 카카오톡이 앞으로 나온다.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** tkt-ax read 가 돌려주는 메시지 한 줄. */
export type Message = {
  time: string
  author: string | null
  body: string
  mine: boolean
}

export type KmsgChat = {
  chat_id: string
  title: string
  last_message: string | null
}

/**
 * kmsg는 카카오톡 창을 직접 조작하기 때문에 두 명령이 겹쳐 돌면 서로를 방해한다.
 * 모든 호출을 한 줄로 세워 순차 실행한다.
 */
let queue: Promise<unknown> = Promise.resolve()

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task)
  queue = next.catch(() => undefined)
  return next
}

// read 는 실측 20초 안팎이 걸린다. 넉넉하게 잡는다.
const TIMEOUT_MS = 180_000
const MAX_BUFFER = 32 * 1024 * 1024

async function kmsg(args: string[]): Promise<string> {
  const { stdout } = await run('kmsg', args, {
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    encoding: 'utf8',
  })
  return stdout
}

// src/ 와 dist/ 모두 프로젝트 루트 한 단계 아래라 같은 경로로 해석된다.
const AX_HELPER = fileURLToPath(new URL('../native/tkt-ax', import.meta.url))

async function tktAx(args: string[]): Promise<string> {
  const { stdout } = await run(AX_HELPER, args, {
    timeout: 60_000,
    maxBuffer: MAX_BUFFER,
    encoding: 'utf8',
  })
  return stdout
}

export function listChats(): Promise<KmsgChat[]> {
  return serialize(async () => {
    const out = await kmsg(['chats', '--json'])
    return (JSON.parse(out).chats ?? []) as KmsgChat[]
  })
}

/**
 * 지금 열려 있는 카카오톡 채팅창 제목들. 채팅 목록 창은 빠진다.
 *
 * 창 제목만 훑는 가벼운 조회(0.3초)라 직렬 큐를 타지 않는다. 큐에 넣으면 17초짜리
 * 읽기가 진행 중일 때 Tab 을 눌러도 채팅방 목록이 뜨지 않는다.
 */
export async function listOpenChats(): Promise<string[]> {
  const out = await tktAx(['windows'])
  return (JSON.parse(out).windows ?? []) as string[]
}

/** tkt-ax 가 "채팅창이 안 열려 있다"고 알려줄 때의 표식. */
const WINDOW_CLOSED = '열려 있지 않습니다'

/** 닫힌 채팅창을 다시 연다. 카카오톡이 앞으로 나오는 유일한 지점. */
async function reopenChatWindow(chatId: string): Promise<void> {
  await kmsg(['read', '--chat-id', chatId, '--limit', '1', '--json', '--keep-window'])
}

/**
 * 채팅창을 읽는다.
 *
 * `reopenChatId` 를 주면 채팅창이 닫혀 있을 때 kmsg 로 한 번 다시 연다. 설정된 기본
 * 채팅방에만 해당하고(그 방의 chat_id 를 알고 있으므로), 사용자가 다른 창으로 전환한
 * 경우에는 이미 열린 창만 다루므로 재열기가 필요 없다.
 */
export function readMessages(
  chatName: string,
  limit: number,
  reopenChatId?: string,
): Promise<Message[]> {
  return serialize(async () => {
    const parse = async () => {
      const out = await tktAx(['read', chatName, String(limit)])
      return (JSON.parse(out).messages ?? []) as Message[]
    }

    try {
      return await parse()
    } catch (error) {
      const detail = [
        (error as { stderr?: string }).stderr ?? '',
        error instanceof Error ? error.message : '',
      ].join('\n')

      if (!reopenChatId || !detail.includes(WINDOW_CLOSED)) throw error

      await reopenChatWindow(reopenChatId)
      return await parse()
    }
  })
}

export function sendMessage(chatName: string, text: string): Promise<void> {
  return serialize(async () => {
    await tktAx(['send', chatName, text])
  })
}

/** 준비되지 않은 항목을 안내 문구로 돌려준다. */
export async function missingTools(): Promise<string[]> {
  const missing: string[] = []

  try {
    await run('kmsg', ['--version'], { timeout: 10_000 })
  } catch {
    missing.push('kmsg (읽기) — brew install channprj/tap/kmsg')
  }

  if (!existsSync(AX_HELPER)) {
    missing.push('native/tkt-ax (전송) — yarn build:native')
  }

  return missing
}
