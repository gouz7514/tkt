import React from 'react'
import { Box, Text } from 'ink'
import { DEFAULTS, type AppearanceSettings } from './config.js'

const timeWidth = 6

function authorWidth(columns: number): number {
  return columns < 20 ? 4 : 6
}

export function originalBodyWidth(columns: number): number {
  return Math.max(1, columns - timeWidth - authorWidth(columns))
}

export function OriginalHeader({ title, status, arrived }: {
  title: string
  status: string
  arrived?: boolean
}) {
  return (
    <Box justifyContent="space-between" paddingX={1} height={1} flexShrink={0}>
      <Text bold color="yellow" wrap="truncate-end">{title}</Text>
      <Box marginLeft={1} width="50%" flexShrink={0} justifyContent="flex-end">
        <Text color={arrived ? 'green' : 'gray'} wrap="truncate-end">{status}</Text>
      </Box>
    </Box>
  )
}

export function OriginalMessage({ appearance, columns, time, mine, body, attachment, sending }: {
  appearance: AppearanceSettings
  columns: number
  time: string
  mine: boolean
  body: string
  attachment?: boolean
  sending?: boolean
}) {
  const legacyNameColor = appearance.nameColor === DEFAULTS.nameColor
  const name = mine ? (appearance.selfName === DEFAULTS.selfName ? '나' : appearance.selfName) : '상대'
  return (
    <Box>
      <Box width={timeWidth} flexShrink={0}>
        <Text color="gray" wrap="truncate-end">{time || '  :  '}</Text>
      </Box>
      <Box width={authorWidth(columns)} flexShrink={0}>
        <Text color={legacyNameColor ? (mine ? 'cyan' : 'magenta') : appearance.nameColor} wrap="truncate-end">
          {name}
        </Text>
      </Box>
      <Box width={originalBodyWidth(columns)} flexShrink={0}>
        <Text color={attachment ? appearance.attachmentColor : undefined} dimColor={sending}>{body}</Text>
      </Box>
    </Box>
  )
}
