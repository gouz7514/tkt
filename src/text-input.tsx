import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import stringWidth from 'string-width'

const segmenter = new Intl.Segmenter()

function displaySegment(segment: string): string {
  return segment.replace(/\r\n|[\r\n\u2028\u2029]/gu, '↵').replace(/\p{Cc}/gu, ' ')
}

export default function TextInput({ value, onChange, onSubmit, focus, width, placeholder = '' }: {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  focus: boolean
  width: number
  placeholder?: string
}) {
  // A null offset keeps the cursor at the end when the parent changes the value.
  const [offset, setOffset] = useState<number | null>(null)
  const segments = Array.from(segmenter.segment(value))
  const cursorIndex = segments.findIndex(({ index }) => index >= (offset ?? value.length))
  const beforeCursor = cursorIndex === -1 ? segments.length : cursorIndex
  const cursor = segments[beforeCursor]?.index ?? value.length

  useInput((input, key) => {
    if (key.return) {
      onSubmit?.(value)
      return
    }

    const previous = segments[beforeCursor - 1]?.index ?? 0
    const next = segments[beforeCursor + 1]?.index ?? value.length
    if (key.ctrl && input === 'a') setOffset(0)
    else if (key.ctrl && input === 'e') setOffset(null)
    else if (key.leftArrow) setOffset(previous)
    else if (key.rightArrow) setOffset(next === value.length ? null : next)
    else if (key.backspace || key.delete) {
      if (cursor === 0) return
      onChange(value.slice(0, previous) + value.slice(cursor))
      setOffset(cursor === value.length ? null : previous)
    } else if (input && !key.ctrl && !key.meta && !key.tab) {
      onChange(value.slice(0, cursor) + input + value.slice(cursor))
      setOffset(cursor === value.length ? null : cursor + input.length)
    }
  }, { isActive: focus })

  const visible = value ? segments.map(({ segment }) => displaySegment(segment))
    : Array.from(segmenter.segment(placeholder), ({ segment }) => segment)
  const index = focus ? (value ? beforeCursor : 0) : visible.length
  const cursorSegment = visible[index] ?? ' '
  const cursorText = focus ? (stringWidth(cursorSegment) > width ? ' ' : cursorSegment) : ''
  let remaining = width - stringWidth(cursorText)
  let start = index
  let end = index + 1

  // Favor the text immediately left of the caret, then show any room to its right.
  while (start > 0 && stringWidth(visible[start - 1]!) <= remaining) {
    remaining -= stringWidth(visible[--start]!)
  }
  while (end < visible.length && stringWidth(visible[end]!) <= remaining) {
    remaining -= stringWidth(visible[end++]!)
  }

  return (
    <Box width={width} height={1} flexDirection="column" flexShrink={0} overflow="hidden">
      <Text dimColor={!value && !!placeholder} wrap="truncate-end">
        {visible.slice(start, index).join('')}
        {focus && <Text inverse>{cursorText}</Text>}
        {visible.slice(index + 1, end).join('')}
      </Text>
    </Box>
  )
}
