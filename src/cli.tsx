#!/usr/bin/env node
import React from 'react'
import { render } from 'ink'
import { createInterface } from 'node:readline/promises'
import App from './app.js'
import { DEFAULTS, configPath, loadConfig, saveConfig, type Config } from './config.js'
import { listChats, missingTools } from './kakao.js'

async function setup(): Promise<Config> {
  console.log('채팅방 목록을 불러오는 중… (20초 정도 걸립니다)\n')
  const chats = await listChats()

  if (chats.length === 0) {
    console.error('채팅방을 찾지 못했습니다. 카카오톡이 실행되어 로그인돼 있는지 확인하세요.')
    process.exit(1)
  }

  chats.forEach((c, i) => {
    const preview = (c.last_message ?? '').replace(/\s+/g, ' ').slice(0, 40)
    console.log(`${String(i + 1).padStart(3)}. ${c.title}`)
    if (preview) console.log(`     ${preview}`)
  })

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('\n연결할 채팅방 번호: ')
  rl.close()

  const index = Number(answer.trim()) - 1
  const chosen = chats[index]
  if (!chosen) {
    console.error('잘못된 번호입니다.')
    process.exit(1)
  }

  const config: Config = {
    chatId: chosen.chat_id,
    displayName: chosen.title,
    pollIntervalMs: DEFAULTS.pollIntervalMs,
    historyLimit: DEFAULTS.historyLimit,
  }
  const path = await saveConfig(config)
  console.log(`\n✓ "${chosen.title}" 채팅방에 연결했습니다.`)
  console.log(`  설정 저장 위치: ${path}\n`)
  return config
}

async function main() {
  const missing = await missingTools()
  if (missing.length > 0) {
    console.error('다음이 준비되지 않았습니다:')
    for (const item of missing) console.error(`  - ${item}`)
    process.exit(1)
  }

  const command = process.argv[2]

  if (command === 'setup') {
    await setup()
    console.log('이제 tkt 를 실행하세요.')
    return
  }

  if (command === '--help' || command === '-h') {
    console.log(`tkt — 터미널에서 카카오톡 채팅방 하나 주고받기

사용법:
  tkt           설정된 채팅방을 엽니다
  tkt setup     대상 채팅방을 다시 고릅니다

설정 파일: ${configPath}`)
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
