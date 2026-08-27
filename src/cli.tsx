#!/usr/bin/env node
import React from 'react'
import { render } from 'ink'
import { createInterface } from 'node:readline/promises'
import App from './app.js'
import { DEFAULTS, configPath, loadConfig, saveConfig, type Config } from './config.js'
import { listOpenChats, missingTools } from './kakao.js'

/**
 * 대상 채팅방을 고른다.
 *
 * 카카오톡에서 이미 열려 있는 채팅창만 후보가 된다. tkt 는 채팅창을 직접 열지 못하고
 * 열려 있는 창을 다루기만 하기 때문이다.
 */
async function setup(): Promise<Config> {
  const chats = await listOpenChats()

  if (chats.length === 0) {
    console.error('열려 있는 카카오톡 채팅창이 없습니다.')
    console.error('카카오톡에서 쓰려는 채팅방을 먼저 연 다음 다시 실행하세요.')
    process.exit(1)
  }

  let chosen = chats[0]!

  if (chats.length > 1) {
    console.log('열려 있는 채팅방:\n')
    chats.forEach((title, i) => console.log(`${String(i + 1).padStart(3)}. ${title}`))

    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question('\n연결할 채팅방 번호: ')
    rl.close()

    const picked = chats[Number(answer.trim()) - 1]
    if (!picked) {
      console.error('잘못된 번호입니다.')
      process.exit(1)
    }
    chosen = picked
  }

  const config: Config = {
    displayName: chosen,
    pollIntervalMs: DEFAULTS.pollIntervalMs,
    historyLimit: DEFAULTS.historyLimit,
  }
  const path = await saveConfig(config)
  console.log(`\n✓ "${chosen}" 채팅방에 연결했습니다.`)
  console.log(`  설정 저장 위치: ${path}\n`)
  return config
}

async function main() {
  // 진단은 보통 눈 깜짝할 새 끝난다. 오래 걸리면 헬퍼가 멈춘 것이므로, 빈 화면으로
  // 기다리게 두지 말고 어느 단계에서 걸렸는지 알려준다.
  const notice = setTimeout(() => {
    console.error('준비 상태를 확인하는 중입니다… (오래 걸리면 다른 터미널에서 `npm run doctor`)')
  }, 1_500)

  const missing = await missingTools().finally(() => clearTimeout(notice))
  if (missing.length > 0) {
    console.error('다음이 준비되지 않았습니다:\n')
    for (const item of missing) {
      // 안내가 여러 줄일 수 있다 (접근성 권한). 이어지는 줄은 들여써서 항목을 구분한다.
      const [head, ...rest] = item.split('\n')
      console.error(`  - ${head}`)
      for (const line of rest) console.error(`    ${line}`)
      console.error('')
    }
    process.exit(1)
  }

  const command = process.argv[2]

  if (command === '--help' || command === '-h') {
    console.log(`tkt — 터미널에서 카카오톡 채팅방 하나 주고받기

사용법:
  tkt           설정된 채팅방을 엽니다
  tkt setup     대상 채팅방을 다시 고릅니다

카카오톡에서 쓰려는 채팅방 창을 열어둔 상태여야 합니다.
설정 파일: ${configPath}`)
    return
  }

  if (command === 'setup') {
    await setup()
    console.log('이제 tkt 를 실행하세요.')
    return
  }

  let config = await loadConfig()
  if (!config) {
    console.log('설정이 없습니다. 대상 채팅방부터 고릅니다.\n')
    config = await setup()
  }

  const app = render(<App config={config} />)
  await app.waitUntilExit()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
