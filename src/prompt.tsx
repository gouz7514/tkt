import React, { type ComponentProps } from 'react'
import { Text } from 'ink'
import type { AppearanceSettings } from './config.js'

type Segment = { text: string } & Pick<ComponentProps<typeof Text>, 'color' | 'backgroundColor' | 'bold'>

function agnosterForeground(background: Exclude<AppearanceSettings['promptColor'], 'default'>) {
  if (background.startsWith('#')) {
    const [red, green, blue] = [1, 3, 5].map((offset) => {
      const channel = Number.parseInt(background.slice(offset, offset + 2), 16) / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    const luminance = 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
    return luminance > 0.2 ? '#161616' : '#FFFFFF'
  }
  return background === 'black' || background === 'red' || background === 'magenta' ? 'whiteBright' : '#161616'
}

function promptSegments(appearance: AppearanceSettings, label: string, active?: boolean): Segment[] {
  const { promptTheme, nameColor, promptColor } = appearance
  const customColor = promptColor === 'default' ? undefined : promptColor
  const foregroundColor = customColor === 'black' ? 'gray' : customColor
  const marker = active === undefined ? '' : active ? '> ' : '  '
  switch (promptTheme) {
    case 'original':
      return [
        { text: marker, color: customColor && customColor !== 'black' ? customColor : 'green' },
        { text: label ? `${label} ` : '', color: 'yellow' },
      ]
    case 'agnoster': {
      const contextColor = customColor ?? 'black'
      return [
        { text: ` ${marker}tkt `, color: agnosterForeground(contextColor), backgroundColor: contextColor },
        { text: '\uE0B0', color: contextColor, backgroundColor: nameColor },
        { text: ` ${label} `, color: agnosterForeground(nameColor), backgroundColor: nameColor },
        { text: '\uE0B0 ', color: nameColor },
      ]
    }
    case 'robbyrussell':
      return [
        { text: marker },
        { text: '➜  ', color: foregroundColor ?? 'green', bold: true },
        { text: `${label} `, color: nameColor },
      ]
    case 'minimal':
      return [
        { text: `${marker}tkt/`, color: foregroundColor },
        { text: label, color: nameColor },
        { text: ' » ', color: foregroundColor },
      ]
  }
}

export function promptText(appearance: AppearanceSettings, label: string, active?: boolean): string {
  return promptSegments(appearance, label, active).map(({ text }) => text).join('')
}

export function CommandText({ body, highlight }: { body: string; highlight: boolean }) {
  const first = highlight ? /^([^\S\r\n]*)(\S+)/u.exec(body) : null
  if (!first) return <>{body}</>

  return (
    <>
      {first[1]}<Text color="green">{first[2]}</Text>{body.slice(first[0].length)}
    </>
  )
}

export default function ShellPrompt({ appearance, label, active }: {
  appearance: AppearanceSettings
  label: string
  active?: boolean
}) {
  return (
    <>
      {promptSegments(appearance, label, active).map(({ text, ...style }, index) => (
        <Text key={index} {...style}>{text}</Text>
      ))}
    </>
  )
}
