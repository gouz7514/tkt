import React, { useEffect, useRef, useState, type ReactElement } from 'react'
import { Box, Text } from 'ink'
import stringWidth from 'string-width'
import wrapAnsi from 'wrap-ansi'
import type { AppearanceSettings, Config } from './config.js'
import { displayChatTitle, readMessages, sendMessage, type Message } from './kakao.js'
import { OriginalHeader, OriginalMessage, originalBodyWidth } from './original-theme.js'
import ShellPrompt, { CommandText, promptText } from './prompt.js'
import TextInput from './text-input.js'

function visibleTranscript(
  messages: Message[],
  pending: Message | null,
  columns: number,
  height: number,
  appearance: AppearanceSettings,
) {
  const { selfName } = appearance
  const original = appearance.promptTheme === 'original'
  const bodyWidth = original ? originalBodyWidth(columns) : columns
  const ownPrompt = promptText(appearance, selfName)
  const peerPrompt = promptText(appearance, 'peer')
  let previousMine: boolean | undefined
  let previousAuthor: string | null = null

  const transcript = messages.map((message) => {
    // 이름이 생략된 받은 메시지는 직전 상대 메시지의 묶음을 이어간다.
    const startsRun = message.mine !== previousMine
      || (!message.mine && !!message.author && message.author !== previousAuthor)
    previousMine = message.mine
    if (startsRun) previousAuthor = message.author

    const timestamp = original || startsRun ? '' : `[${message.time || '--:--'}] `
    const sending = message === pending
    const body = message.body + (sending ? ' …' : '')
    const label = !original && startsRun ? (message.mine ? selfName : 'peer') : undefined
    const prefix = label === undefined ? '' : message.mine ? ownPrompt : peerPrompt
    const rows = wrapAnsi(timestamp + prefix + body, bodyWidth, { hard: true, trim: false }).split('\n').length
    return { ...message, timestamp, body, label, sending, rows }
  })

  let start = transcript.length
  let remaining = height
  while (start > 0 && remaining > 0) {
    start -= 1
    remaining -= transcript[start]!.rows
  }
  return { shown: transcript.slice(start), hiddenRows: Math.max(0, -remaining) }
}

function firstLine(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const stderr = (error as Error & { stderr?: string }).stderr
  return (stderr?.trim() || error.message).split('\n')[0]!
}

export default function ChatPane({
  room, focused, height, columns, config, appearance, children: picker,
}: {
  room: string | null
  focused: boolean
  height: number
  columns: number
  config: Config
  appearance: AppearanceSettings
  children?: ReactElement | false
}) {
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [input, setInput] = useState('')
  const [readError, setReadError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [pending, setPending] = useState<Message | null>(null)
  const [arrived, setArrived] = useState(false)
  const sending = useRef(false)
  const refresh = useRef<(() => void) | null>(null)
  const { historyLimit, pollIntervalMs } = config

  useEffect(() => {
    if (!room) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let arrivedTimer: ReturnType<typeof setTimeout> | undefined
    let previousTail: string | undefined

    const read = async () => {
      timer = undefined
      try {
        const next = await readMessages(room, historyLimit)
        if (!active) return
        const tail = JSON.stringify([next.length, next.at(-1)])
        if (previousTail !== undefined && tail !== previousTail && next.length > 0) {
          setArrived(true)
          clearTimeout(arrivedTimer)
          arrivedTimer = setTimeout(() => setArrived(false), 4_000)
        }
        previousTail = tail
        setMessages(next)
        setReadError(null)
        if (!sending.current) setPending(null)
      } catch (error) {
        if (active) setReadError(firstLine(error))
      } finally {
        if (active) timer = setTimeout(read, pollIntervalMs)
      }
    }

    refresh.current = () => {
      if (timer === undefined) return
      clearTimeout(timer)
      void read()
    }
    void read()
    return () => {
      active = false
      clearTimeout(timer)
      clearTimeout(arrivedTimer)
      refresh.current = null
    }
  }, [room, historyLimit, pollIntervalMs])

  const submit = async (value: string) => {
    const text = value.trim()
    if (!room || !focused || picker || !text || sending.current) return
    sending.current = true
    setSendError(null)
    setPending({
      time: new Date().toTimeString().slice(0, 5),
      author: null,
      body: text,
      mine: true,
    })

    try {
      await sendMessage(room, text)
      setInput((draft) => draft === value ? '' : draft)
      refresh.current?.()
    } catch (error) {
      setSendError(firstLine(error))
      setPending(null)
    } finally {
      sending.current = false
    }
  }

  if (picker) return picker

  const original = appearance.promptTheme === 'original'
  const framed = original && height >= 5 && columns >= 20
  const error = sendError ?? readError
  const messagesHeight = Math.max(0, height - (framed ? 3 : 0) - (error ? 2 : 1))
  const historyColumns = columns - (framed ? 4 : 0)
  const entries = pending ? [...(messages ?? []), pending] : messages ?? []
  const { shown, hiddenRows } = visibleTranscript(entries, pending, historyColumns, messagesHeight, appearance)
  const roomLabel = displayChatTitle(room ?? '방 미선택')
  const promptLabel = framed ? '' : roomLabel
  const composerPadding = framed ? 1 : 0
  const composerWidth = columns - 2 * composerPadding
  const minInputWidth = room ? Math.max(4, Math.floor(columns / 4)) : 0
  const promptWidth = Math.min(composerWidth - minInputWidth, stringWidth(promptText(appearance, promptLabel, focused)))
  const inputWidth = composerWidth - promptWidth
  const status = pending ? '전송 중…' : readError ? '연결 확인 필요' : !messages ? '대화 불러오는 중…'
    : arrived ? '● 새 메시지' : '대기 중'

  return (
    <>
      {framed && <OriginalHeader title={roomLabel} status={status} arrived={!pending && !readError && arrived} />}
      <Box
        flexDirection="column"
        height={messagesHeight + (framed ? 2 : 0)}
        flexShrink={0}
        borderStyle={framed ? 'round' : undefined}
        borderColor={framed ? 'gray' : undefined}
        paddingX={framed ? 1 : 0}
        justifyContent={original ? 'flex-start' : 'flex-end'}
        overflow="hidden"
      >
        {shown.length === 0 && (
          <Text dimColor wrap="truncate-end">
            {!room ? '카카오톡에서 채팅창을 열어주세요. / ↑ 방 선택'
              : messages || error ? '표시할 메시지 없음' : '불러오는 중…'}
          </Text>
        )}
        <Box flexDirection="column" flexShrink={0} marginTop={-hiddenRows}>
          {shown.map((entry, index) => original ? (
            <OriginalMessage key={index} appearance={appearance} columns={historyColumns} {...entry} />
          ) : (
            <Text key={index}>
              {entry.timestamp && <Text dimColor>{entry.timestamp}</Text>}
              {entry.label !== undefined && (
                <ShellPrompt appearance={appearance} label={entry.label} />
              )}
              <Text color={entry.attachment ? appearance.attachmentColor : undefined} dimColor={entry.sending}>
                <CommandText body={entry.body} highlight={entry.label !== undefined && !entry.attachment} />
              </Text>
            </Text>
          ))}
        </Box>
      </Box>
      <Box height={1} flexShrink={0} overflow="hidden" paddingX={composerPadding}>
        <Box width={promptWidth} flexShrink={0}>
          <Text wrap="truncate-middle">
            <ShellPrompt appearance={appearance} label={promptLabel} active={focused} />
          </Text>
        </Box>
        {room && (
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={submit}
              focus={focused}
              width={inputWidth}
              placeholder={original && focused ? '메시지를 입력하고 Enter' : undefined}
            />
        )}
      </Box>
      {error && (
        <Text color={original ? 'red' : undefined} wrap="truncate-end"><Text bold>오류 </Text>{error}</Text>
      )}
    </>
  )
}
