import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import {
  isTerminalApp, loadTerminalApp, saveConfig, terminalApps, type TerminalApp,
} from './config.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))

const openWindow = {
  terminal: `
    tell application id "com.apple.Terminal"
      do script commandLine
      activate
    end tell`,
  iterm2: `
    tell application id "com.googlecode.iterm2"
      create window with default profile command commandLine
      activate
    end tell`,
}

async function configure(option?: string) {
  let selection: string | undefined = option
  if (selection === undefined) {
    const current = await loadTerminalApp()
    const choices = Object.entries(terminalApps)
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
      choices.forEach(([id, label], index) => {
        console.log(`${index + 1}. ${label}${id === current ? ' (현재)' : ''}`)
      })
      const answer = (await rl.question('기본 터미널 번호 (Enter로 현재 설정 유지): ')).trim()
      selection = answer === '' ? current : choices[Number(answer) - 1]?.[0]
    } finally {
      rl.close()
    }
  }

  if (!isTerminalApp(selection)) throw new Error('current, terminal, iterm2 중 하나를 선택하세요.')
  await saveConfig({ terminal: selection })
  console.log(`tkt 기본 터미널: ${terminalApps[selection]}`)
}

function run(command: string, args: string[]): number {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  return result.status ?? 1
}

function launchInApp(terminal: Exclude<TerminalApp, 'current'>) {
  // Node와 진입점 경로를 AppleScript에 인수로 전달하고 셸에서 쓸 때 각각 인용한다.
  const script = `
on run argv
    set commandLine to (quoted form of item 1 of argv) & " " & (quoted form of item 2 of argv)
    ${openWindow[terminal]}
    return
end run
`
  const result = spawnSync('/usr/bin/osascript', ['-', process.execPath, cli], {
    input: script,
    stdio: ['pipe', 'ignore', 'inherit'],
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${terminalApps[terminal]}에서 열지 못했어요. 해당 앱을 열고 npm run dev로 직접 실행할 수 있어요.`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log('npm run launch [-- --setup [current|terminal|iterm2]]')
    return
  }
  if (args[0] === '--setup' && args.length <= 2) {
    await configure(args[1])
    return
  }
  if (args.length) throw new Error('사용법: npm run launch [-- --setup [current|terminal|iterm2]]')

  const terminal = await loadTerminalApp()
  const build = run('npm', ['run', 'build'])
  if (build !== 0) {
    process.exitCode = build
    return
  }

  if (terminal === 'current') {
    process.exitCode = run(process.execPath, [cli])
  } else {
    launchInApp(terminal)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
