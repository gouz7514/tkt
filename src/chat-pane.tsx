import React, { useEffect, useRef, useState, type ReactElement } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import wrapAnsi from 'wrap-ansi'
import type { AppearanceSettings, Config } from './config.js'
import { readMessages, sendMessage, type Message } from './kakao.js'
import ShellPrompt, { CommandText, promptText } from './prompt.js'

function visibleTranscript(
  messages: Message[],
  pending: Message | null,
  columns: number,
  height: number,
  appearance: AppearanceSettings,
) {
  const { selfName } = appearance
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

    const timestamp = startsRun ? '' : `[${message.time || '--:--'}] `
    const sending = message === pending
    const body = message.body + (sending ? ' …' : '')
    const label = startsRun ? (message.mine ? selfName : 'peer') : undefined
    const prefix = startsRun ? (message.mine ? ownPrompt : peerPrompt) : ''
    const rows = wrapAnsi(timestamp + prefix + body, columns, { hard: true, trim: false }).split('\n').length
    return { timestamp, body, label, attachment: message.attachment, sending, rows }
  })

  let start = transcript.length
  let remaining = height
  while (start > 0 && remaining > 0) {
    const rows = transcript[start - 1]!.rows
    if (rows > remaining && start < transcript.length) break
    start -= 1
    remaining -= rows
  }
  return transcript.slice(start)
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
  const sending = useRef(false)
  const refresh = useRef<(() => void) | null>(null)
  const { historyLimit, pollIntervalMs } = config

  useEffect(() => {
    if (!room) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined

    const read = async () => {
      timer = undefined
      try {
        const next = await readMessages(room, historyLimit)
        if (!active) return
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
      refresh.current = null
    }
  }, [room, historyLimit, pollIntervalMs])

  const submit = async (value: string) => {
    const text = value.trim()
    if (!room || !focused || picker || !text || sending.current) return
    sending.current = true
    setInput('')
    setSendError(null)
    setPending({
      time: new Date().toTimeString().slice(0, 5),
      author: null,
      body: text,
      mine: true,
    })

    try {
      await sendMessage(room, text)
      refresh.current?.()
    } catch (error) {
      setSendError(firstLine(error))
      setPending(null)
      setInput((draft) => draft || value)
    } finally {
      sending.current = false
    }
  }

  if (picker) return picker

  const error = sendError ?? readError
  const messagesHeight = Math.max(0, height - (error ? 2 : 1))
  const entries = pending ? [...(messages ?? []), pending] : messages ?? []
  const shown = visibleTranscript(entries, pending, columns, messagesHeight, appearance)

  return (
    <>
      <Box
        flexDirection="column"
        flexBasis={0}
        flexGrow={1}
        minHeight={1}
        justifyContent="flex-end"
        overflow="hidden"
      >
        {shown.length === 0 && (
          <Text dimColor wrap="truncate-end">
            {!room ? '카카오톡에서 채팅창을 열어주세요. / ↑ 방 선택'
              : messages || error ? '표시할 메시지 없음' : '불러오는 중…'}
          </Text>
        )}
        {shown.map((entry, index) => (
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
      <Box minHeight={1} flexShrink={1} overflow="hidden">
        <Box minWidth={0} flexShrink={1}>
          <Text wrap="truncate-middle">
            <ShellPrompt appearance={appearance} label={room ?? '방 미선택'} active={focused} />
          </Text>
        </Box>
        {room && (
          <Box flexGrow={1} flexShrink={0} flexBasis="24%">
            <TextInput value={input} onChange={setInput} onSubmit={submit} focus={focused} />
          </Box>
        )}
      </Box>
      {error && (
        <Text wrap="truncate-end"><Text bold>오류 </Text>{error}</Text>
      )}
    </>
  )
}
