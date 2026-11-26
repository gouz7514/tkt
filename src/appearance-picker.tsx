import React, { useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import {
  ansiColors, DEFAULTS, parseHexColor, promptColors, promptThemes, singleLineName,
  type AppearanceSettings, type PromptTheme,
} from './config.js'
import ShellPrompt, { CommandText } from './prompt.js'

const themes = Object.keys(promptThemes) as PromptTheme[]
const fieldLabels: Record<keyof AppearanceSettings, string> = {
  promptTheme: '테마',
  selfName: '내 대화명',
  nameColor: '사용자명 색상',
  promptColor: '프롬프트 색상',
  attachmentColor: '첨부 강조색',
}

function nextChoice<T>(choices: readonly T[], current: T, step: number): T {
  return choices[(choices.indexOf(current) + step + choices.length) % choices.length]!
}

const fields = ['promptTheme', 'selfName', 'nameColor', 'promptColor', 'attachmentColor'] as const
const hexFields = ['nameColor', 'promptColor'] as const
type HexField = typeof hexFields[number]

export default function AppearancePicker({ appearance, onSave, onClose }: {
  appearance: AppearanceSettings
  onSave: (selection: AppearanceSettings) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState(appearance)
  const [focus, setFocus] = useState<keyof AppearanceSettings>('promptTheme')
  const [hexInputs, setHexInputs] = useState<Partial<Record<HexField, string>>>(() => ({
    nameColor: parseHexColor(appearance.nameColor),
    promptColor: parseHexColor(appearance.promptColor),
  }))
  const [error, setError] = useState<'hex' | 'save' | null>(null)
  const saving = useRef(false)
  const preview: AppearanceSettings = {
    ...draft,
    selfName: draft.selfName.trim() || DEFAULTS.selfName,
    nameColor: parseHexColor(hexInputs.nameColor) ?? draft.nameColor,
    promptColor: parseHexColor(hexInputs.promptColor) ?? draft.promptColor,
  }

  useInput((_input, key) => {
    if (saving.current) return
    if (key.escape) {
      onClose()
      return
    }
    if (key.tab && !key.shift) {
      setFocus((current) => nextChoice(fields, current, 1))
      return
    }
    if (key.return) {
      const invalid = hexFields.find((field) => hexInputs[field] !== undefined && !parseHexColor(hexInputs[field]))
      if (invalid) {
        setFocus(invalid)
        setError('hex')
        return
      }
      saving.current = true
      setError(null)
      void onSave(preview)
        .catch(() => setError('save'))
        .finally(() => { saving.current = false })
      return
    }
    if (focus === 'selfName' || !(key.upArrow || key.downArrow)) return

    const step = key.upArrow ? -1 : 1
    if (focus === 'promptTheme') {
      setDraft((current) => ({ ...current, promptTheme: nextChoice(themes, current.promptTheme, step) }))
      return
    }
    if (focus === 'attachmentColor') {
      const choices = ansiColors.filter((color) => color !== preview.nameColor)
      setDraft((current) => ({ ...current, attachmentColor: nextChoice(choices, current.attachmentColor, step) }))
      return
    }

    const presets = focus === 'promptColor' ? promptColors
      : ansiColors.filter((color) => color !== draft.attachmentColor)
    const choices = [...presets, 'custom' as const]
    const selected = hexInputs[focus] === undefined ? draft[focus] : 'custom'
    const next = nextChoice(choices, selected, step)
    setError(null)
    setHexInputs((current) => ({ ...current, [focus]: next === 'custom' ? '' : undefined }))
    if (next !== 'custom') setDraft((current) => ({ ...current, [focus]: next }))
  })

  return (
    <Box flexDirection="column">
      <Text bold>화면 설정</Text>
      {fields.map((field) => {
        const selected = focus === field
        const label = `${selected ? '> ' : '  '}${fieldLabels[field]} `
        if (field === 'selfName') {
          return (
            <Box key={field}>
              <Text bold={selected}>{label}</Text>
              <TextInput
                value={draft.selfName}
                onChange={(value) => setDraft((current) => ({ ...current, selfName: singleLineName(value) }))}
                placeholder={DEFAULTS.selfName}
                focus={selected}
                showCursor={selected}
              />
            </Box>
          )
        }
        if ((field === 'nameColor' || field === 'promptColor') && hexInputs[field] !== undefined) {
          return (
            <Box key={field}>
              <Text bold={selected}>{label}직접 입력 </Text>
              <TextInput
                value={hexInputs[field]}
                onChange={(value) => {
                  setError(null)
                  setHexInputs((current) => ({ ...current, [field]: singleLineName(value) }))
                }}
                placeholder="#RRGGBB"
                focus={selected}
                showCursor={selected}
              />
            </Box>
          )
        }
        return (
          <Text key={field} bold={selected}>
            {label}
            {field === 'promptTheme' ? promptThemes[draft.promptTheme] : (
              draft[field] === 'default' ? '테마 기본값' : (
                <Text color={draft[field] === 'black' ? 'gray' : draft[field]}>{draft[field]}</Text>
              )
            )}
          </Text>
        )
      })}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>미리 보기</Text>
        <Text>
          <ShellPrompt appearance={preview} label="peer" />
          <CommandText body="check the notes" highlight />
        </Text>
        <Text><Text dimColor>[09:42] </Text><Text color={preview.attachmentColor}>Image</Text></Text>
        <Text>
          <ShellPrompt appearance={preview} label={preview.selfName} />
          <CommandText body="open notes" highlight />
        </Text>
        <Text><ShellPrompt appearance={preview} label="room" active /></Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {error === 'hex' && <Text>색상 코드를 #RRGGBB 형식으로 입력해 주세요.</Text>}
        {error === 'save' && <Text>설정을 저장하지 못했습니다. Enter를 눌러 다시 시도해 주세요.</Text>}
        <Text dimColor>
          {focus === 'selfName' ? '대화명 입력'
            : (focus === 'nameColor' || focus === 'promptColor') && hexInputs[focus] !== undefined
              ? '#RRGGBB 입력 / ↑↓ 프리셋'
              : '↑↓ 값 변경'} / Tab 다음 설정 / Enter 저장 / Esc 닫기
        </Text>
      </Box>
    </Box>
  )
}
