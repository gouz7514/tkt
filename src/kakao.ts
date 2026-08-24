/**
 * 카카오톡 연동 계층.
 *
 * 읽기·전송 모두 직접 만든 `native/tkt-ax`가 담당한다. AX 트리를 직접 다루므로 빠르고
 * 카카오톡 창을 앞으로 끌어올리지 않는다.
 *
 * 채팅방은 카카오톡 창 제목으로만 식별한다. 그래서 이미 열려 있는 채팅창만 다룰 수 있고,
 * 대신 외부 도구 없이 이 저장소만으로 동작한다.
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

async function tktAx(args: string[]): Promise<string> {
  const { stdout } = await run(AX_HELPER, args, {
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'utf8',
  })
  return stdout
}

/**
 * 지금 열려 있는 카카오톡 채팅창 제목들. 채팅 목록 창은 빠진다.
 *
 * 창 제목만 훑는 가벼운 조회(0.3초)라 직렬 큐를 타지 않는다. 큐에 넣으면 읽기가
 * 진행 중일 때 Tab 을 눌러도 채팅방 목록이 뜨지 않는다.
 */
export async function listOpenChats(): Promise<string[]> {
  const out = await tktAx(['windows'])
  return (JSON.parse(out).windows ?? []) as string[]
}

/** 채팅창의 최근 메시지를 읽는다. 창이 닫혀 있으면 오류를 낸다. */
export function readMessages(chatName: string, limit: number): Promise<Message[]> {
  return serialize(async () => {
    const out = await tktAx(['read', chatName, String(limit)])
    return (JSON.parse(out).messages ?? []) as Message[]
  })
}

export function sendMessage(chatName: string, text: string): Promise<void> {
  return serialize(async () => {
    await tktAx(['send', chatName, text])
  })
}

/** 준비되지 않은 항목을 안내 문구로 돌려준다. */
export async function missingTools(): Promise<string[]> {
  if (existsSync(AX_HELPER)) return []
  return ['native/tkt-ax — `yarn build:native` 로 빌드하세요 (Xcode Command Line Tools 필요)']
}
