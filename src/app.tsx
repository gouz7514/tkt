import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import TextInput from 'ink-text-input'
import type { Config } from './config.js'
import { listOpenChats, readMessages, sendMessage, type Message } from './kakao.js'

type Row = {
  key: string
  time: string
  author: string
  body: string
  mine: boolean
  pending?: boolean
}

function toRow(m: Message, index: number): Row {
  return {
    key: `${index}:${m.time}|${m.author ?? ''}|${m.body}`,
    time: m.time || '  :  ',
    author: m.mine ? '나' : (m.author ?? '상대'),
    body: m.body,
    mine: m.mine,
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function App({ config }: { config: Config }) {
  const { exit } = useApp()
  const { stdout } = useStdout()

  // 지금 보고 있는 채팅방. 설정값으로 시작하지만 Tab 으로 다른 열린 창으로 옮길 수 있다.
  const [chatName, setChatName] = useState(config.displayName)
  const [openChats, setOpenChats] = useState<string[]>([])
  const [pickerIndex, setPickerIndex] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)

  const [rows, setRows] = useState<Row[]>([])
  const [pending, setPending] = useState<Row[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState('연결 중…')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [arrived, setArrived] = useState(false)

  const lastKey = useRef<string | null>(null)
  // 폴링 루프를 깨워 즉시 한 번 더 읽게 하는 신호.
  const wake = useRef<(() => void) | null>(null)

  const refreshNow = useCallback(() => {
    wake.current?.()
  }, [])

  // 시작할 때, 설정된 방의 창이 닫혀 있으면 지금 열려 있는 창으로 붙는다.
  useEffect(() => {
    let cancelled = false
    listOpenChats()
      .then((chats) => {
        if (cancelled) return
        setOpenChats(chats)
        if (chats.length === 0) return
        if (!chats.some((c) => c.includes(config.displayName))) {
          setChatName(chats[0]!)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [config.displayName])

  useEffect(() => {
    // 이 플래그는 반드시 이펙트 안의 지역 변수여야 한다. ref 로 공유하면 방을 바꿀 때
    // 정리 함수가 false 로 내려놓은 값을 곧바로 새 이펙트가 true 로 되돌려서, 이전 루프가
    // 죽지 않고 계속 돈다. 그러면 두 루프가 번갈아 setRows 를 호출해 화면이 두 채팅방을
    // 오간다.
    let active = true

    const loop = async () => {
      let first = true
      while (active) {
        try {
          setStatus(first ? '대화 불러오는 중…' : '새 메시지 확인 중…')
          const messages = await readMessages(
            chatName,
            config.historyLimit,
            // 재열기는 chat_id 를 아는 기본 채팅방일 때만 가능하다.
            chatName === config.displayName ? config.chatId : undefined,
          )
          if (!active) return

          const next = messages.map(toRow)
          const tail = next.at(-1)?.key ?? null
          if (!first && tail && tail !== lastKey.current) {
            setArrived(true)
            setTimeout(() => setArrived(false), 4000)
          }
          lastKey.current = tail

          setRows(next)
          // 스냅샷이 갱신됐으니 낙관적으로 띄워둔 줄은 정리한다.
          setPending([])
          setError(null)
          first = false
        } catch (e) {
          if (!active) return
          setError(e instanceof Error ? e.message.split('\n')[0] : String(e))
        }

        setStatus('대기 중')
        // 전송 직후에는 즉시 깨어나 다시 읽는다.
        await Promise.race([
          sleep(config.pollIntervalMs),
          new Promise<void>((resolve) => {
            wake.current = resolve
          }),
        ])
        wake.current = null
      }
    }

    void loop()
    return () => {
      active = false
      wake.current?.()
      // 방을 옮기면 이전 대화는 버린다.
      lastKey.current = null
      setRows([])
      setPending([])
    }
  }, [chatName, config.chatId, config.displayName, config.historyLimit, config.pollIntervalMs])

  useInput((_input, key) => {
    if (pickerOpen) {
      if (key.escape) {
        setPickerOpen(false)
        return
      }
      if (key.upArrow) {
        setPickerIndex((i) => Math.max(0, i - 1))
        return
      }
      if (key.downArrow) {
        setPickerIndex((i) => Math.min(openChats.length - 1, i + 1))
        return
      }
      if (key.return) {
        const chosen = openChats[pickerIndex]
        setPickerOpen(false)
        if (chosen && chosen !== chatName) {
          // 이전 방 내용은 여기서 같이 비운다. 이펙트 뒷정리에만 맡기면 방 이름이 먼저
          // 바뀌고 목록이 나중에 지워져, 한 프레임 동안 새 방 이름 아래 이전 대화가 남는다.
          setRows([])
          setPending([])
          lastKey.current = null
          setChatName(chosen)
        }
      }
      return
    }

    if (key.tab) {
      // 목록은 열 때마다 새로 읽는다. 그 사이 창이 열리거나 닫혔을 수 있다.
      listOpenChats()
        .then((chats) => {
          if (chats.length === 0) {
            setError('열려 있는 카카오톡 채팅창이 없습니다')
            return
          }
          setOpenChats(chats)
          setPickerIndex(Math.max(0, chats.indexOf(chatName)))
          setPickerOpen(true)
        })
        .catch(() => setError('채팅창 목록을 읽지 못했습니다'))
      return
    }

    if (key.escape) {
      exit()
    }
  })

  const handleSubmit = async (value: string) => {
    const text = value.trim()
    if (!text || busy) return

    setInput('')
    setBusy(true)
    setStatus('전송 중…')

    const optimistic: Row = {
      key: `pending:${Date.now()}`,
      time: new Date().toTimeString().slice(0, 5),
      author: '나',
      body: text,
      mine: true,
      pending: true,
    }
    setPending((prev) => [...prev, optimistic])

    try {
      // 전송은 chat_id 가 아니라 화면에 보이는 채팅방 이름으로 대상을 찾는다.
      await sendMessage(chatName, text)
      setError(null)
      refreshNow()
    } catch (e) {
      setError(e instanceof Error ? e.message.split('\n')[0] : String(e))
      setPending((prev) => prev.filter((r) => r.key !== optimistic.key))
    } finally {
      setBusy(false)
    }
  }

  const terminalRows = stdout?.rows ?? 24
  const visible = Math.max(5, terminalRows - 8)
  const all = [...rows, ...pending]
  const shown = all.slice(-visible)

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" paddingX={1}>
        <Text bold color="yellow">
          {chatName}
        </Text>
        <Text color={arrived ? 'green' : 'gray'}>
          {arrived ? '● 새 메시지' : status}
        </Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        minHeight={visible + 2}
      >
        {shown.length === 0 ? (
          <Text color="gray">아직 표시할 메시지가 없습니다.</Text>
        ) : (
          shown.map((row) => (
            <Box key={row.key} flexDirection="row">
              <Text color="gray">{row.time.padEnd(6)}</Text>
              <Text color={row.mine ? 'cyan' : 'magenta'}>
                {row.author.padEnd(6).slice(0, 6)}
              </Text>
              <Box flexGrow={1}>
                <Text dimColor={row.pending} wrap="wrap">
                  {row.body}
                  {row.pending ? ' …' : ''}
                </Text>
              </Box>
            </Box>
          ))
        )}
      </Box>

      {pickerOpen ? (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text bold color="yellow">
            채팅방 전환 (↑↓ 이동, Enter 선택, Esc 취소)
          </Text>
          {openChats.map((name, i) => (
            <Text key={name} color={i === pickerIndex ? 'yellow' : undefined}>
              {i === pickerIndex ? '\u276f ' : '  '}
              {name}
              {name === chatName ? ' (현재)' : ''}
            </Text>
          ))}
        </Box>
      ) : (
        <Box paddingX={1}>
          <Text color={busy ? 'gray' : 'green'}>{busy ? '⋯ ' : '> '}</Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder={busy ? '전송 중…' : '메시지를 입력하고 Enter'}
            focus={!pickerOpen}
          />
        </Box>
      )}

      {error ? (
        <Box paddingX={1}>
          <Text color="red">오류: {error}</Text>
        </Box>
      ) : (
        <Box paddingX={1}>
          <Text color="gray">Tab 채팅방 전환 · Esc 종료</Text>
        </Box>
      )}
    </Box>
  )
}
