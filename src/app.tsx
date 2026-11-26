import React, { useEffect, useState } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import ChatPane from './chat-pane.js'
import { ansiColors, DEFAULTS, saveConfig, type AppearanceSettings, type Config } from './config.js'
import { listOpenChats } from './kakao.js'
import AppearancePicker from './appearance-picker.js'

type Rooms = [string | null, string | null]

function RoomPicker({
  current, other, height, onSelect,
}: {
  current: string | null
  other: string | null
  height: number
  onSelect: (room: string) => void
}) {
  const [rooms, setRooms] = useState<string[] | null>(null)
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    let retry: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const chats = await listOpenChats()
        if (!active) return
        const choices = chats.filter((chat) => chat !== other)
        setRooms(choices)
        setSelected(Math.max(0, current ? choices.indexOf(current) : 0))
        if (!choices.length) retry = setTimeout(load, 1000)
      } catch {
        if (active) setError(true)
      }
    }
    void load()
    return () => {
      active = false
      clearTimeout(retry)
    }
  }, [current, other])

  useInput((_input, key) => {
    if (!rooms?.length) return
    if (key.upArrow) setSelected((index) => Math.max(0, index - 1))
    if (key.downArrow) setSelected((index) => Math.min(rooms.length - 1, index + 1))
    if (key.return) onSelect(rooms[selected]!)
  })

  if (error) return <Text>채팅창 목록을 읽지 못했습니다.</Text>
  if (!rooms) return <Text dimColor>채팅창 확인 중…</Text>
  if (rooms.length === 0) return <Text dimColor>카카오톡에서 다른 채팅창을 열어주세요.</Text>

  const limit = Math.max(1, height - 1)
  const start = Math.min(Math.max(0, selected - limit + 1), Math.max(0, rooms.length - limit))

  return (
    <Box flexDirection="column" overflow="hidden">
      <Text dimColor>방 선택</Text>
      {rooms.slice(start, start + limit).map((room, index) => (
        <Text key={room} bold={start + index === selected} wrap="truncate-end">
          {start + index === selected ? '> ' : '  '}
          {room}
          {room === current ? ' (현재)' : ''}
        </Text>
      ))}
    </Box>
  )
}

export default function App({ config }: { config: Config }) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [rooms, setRooms] = useState<Rooms | null>(null)
  const [focused, setFocused] = useState<0 | 1>(0)
  const [stacked, setStacked] = useState(false)
  const [picking, setPicking] = useState<0 | 1 | null>(null)
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => {
    const attachmentColor = config.attachmentColor ?? ansiColors[0]
    const defaultNameColor = attachmentColor === 'blue' ? 'magenta' : DEFAULTS.nameColor
    return {
      promptTheme: config.promptTheme ?? 'agnoster',
      attachmentColor,
      selfName: config.selfName ?? DEFAULTS.selfName,
      nameColor: config.nameColor && config.nameColor !== attachmentColor ? config.nameColor : defaultNameColor,
      promptColor: config.promptColor ?? DEFAULTS.promptColor,
    }
  })
  const [appearanceOpen, setAppearanceOpen] = useState(config.promptTheme === undefined)
  const [size, setSize] = useState(() => ({ rows: stdout.rows || 24, columns: stdout.columns || 80 }))

  useEffect(() => {
    const resize = () => setSize({ rows: stdout.rows || 24, columns: stdout.columns || 80 })
    stdout.on('resize', resize)
    return () => { stdout.off('resize', resize) }
  }, [stdout])

  useEffect(() => {
    let active = true
    listOpenChats()
      .then((chats) => {
        if (!active) return
        const first = chats.includes(config.displayName)
          ? config.displayName
          : chats[0] ?? null
        setRooms([first, null])
      })
      .catch(() => { if (active) setRooms([null, null]) })
    return () => { active = false }
  }, [config.displayName])

  const split = rooms?.[1] != null || picking === 1
  const addingSecond = picking === 1 && rooms?.[1] == null
  const bodyHeight = size.rows - 2
  const fits = bodyHeight >= 5 && size.columns >= 30

  useInput((_input, key) => {
    if (appearanceOpen) return

    if (key.tab) {
      if (key.shift) {
        setPicking(null)
        setAppearanceOpen(true)
      } else if (!addingSecond) {
        setPicking(null)
        if (split) setFocused((index) => index === 0 ? 1 : 0)
      }
      return
    }

    if (key.escape) {
      if (picking !== null) setPicking(null)
      else exit()
      return
    }

    if (picking !== null || !rooms || !fits) return
    if (key.upArrow) setPicking(focused)
    if (key.downArrow) {
      if (split) setStacked((value) => !value)
      else setPicking(1)
    }
  })

  const horizontal = split && !stacked
  const vertical = split && stacked
  const firstHeight = vertical ? Math.floor((bodyHeight - 1) / 2) : bodyHeight
  const firstWidth = horizontal ? Math.floor((size.columns - 1) / 2) : size.columns

  return (
    <>
      {appearanceOpen && (
        <AppearancePicker
          appearance={appearance}
          onClose={() => setAppearanceOpen(false)}
          onSave={async (selection) => {
            await saveConfig(selection)
            setAppearance(selection)
            setAppearanceOpen(false)
          }}
        />
      )}
      {rooms && fits ? (
        <Box flexDirection="column" display={appearanceOpen ? 'none' : 'flex'}>
          <Box height={bodyHeight} flexDirection={vertical ? 'column' : 'row'}>
            {rooms.slice(0, split ? 2 : 1).map((room, index) => {
              const active = index === (picking ?? focused)
              const paneHeight = vertical && index === 1 ? bodyHeight - firstHeight - 1 : firstHeight
              const paneWidth = horizontal && index === 1 ? size.columns - firstWidth - 1 : firstWidth
              return (
                <React.Fragment key={index}>
                  {index === 1 && (
                    <Box
                      height={vertical ? 1 : bodyHeight}
                      width={vertical ? size.columns : 1}
                      flexShrink={0}
                      borderStyle="single"
                      borderTop={false}
                      borderLeft={false}
                      borderRight={horizontal}
                      borderBottom={vertical}
                      borderDimColor
                    />
                  )}
                  <Box
                    height={paneHeight}
                    width={paneWidth}
                    flexDirection="column"
                    flexShrink={0}
                    paddingLeft={index === 1 && horizontal ? 1 : 0}
                    paddingRight={index === 0 && horizontal ? 1 : 0}
                    overflow="hidden"
                  >
                    <ChatPane
                      key={room}
                      room={room}
                      focused={active && !appearanceOpen}
                      height={paneHeight}
                      columns={paneWidth - (horizontal ? 1 : 0)}
                      config={config}
                      appearance={appearance}
                    >
                      {picking === index && (
                        <RoomPicker
                          current={room}
                          other={rooms[index === 0 ? 1 : 0]}
                          height={paneHeight}
                          onSelect={(next) => {
                            setRooms(index === 0 ? [next, rooms[1]] : [rooms[0], next])
                            setFocused(picking)
                            setPicking(null)
                          }}
                        />
                      )}
                    </ChatPane>
                  </Box>
                </React.Fragment>
              )
            })}
          </Box>
          {picking !== null ? (
            <Text dimColor>↑↓ 방 이동 / Enter 선택 / Esc 취소</Text>
          ) : (
            <Text dimColor wrap="truncate-end">
              {split && 'Tab 칸 이동 / '}Shift+Tab 설정 / ↑ 방 선택 / ↓ {split
                ? stacked ? '좌우 분할' : '상하 분할'
                : '분할 후 방 선택'} / Enter 전송 / Esc 종료
            </Text>
          )}
        </Box>
      ) : !appearanceOpen && (
        <Text dimColor>{rooms ? '터미널 창을 넓혀 주세요. / Esc 종료' : '채팅창 확인 중…'}</Text>
      )}
    </>
  )
}
