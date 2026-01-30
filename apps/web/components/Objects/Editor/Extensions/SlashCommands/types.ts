import { Editor, Range } from '@tiptap/react'
import { ReactNode } from 'react'
import { PlanLevel } from '@services/plans/plans'

export interface SlashCommandItem {
  id: string
  title: string
  description: string
  icon: ReactNode
  category: SlashCommandCategory
  keywords: string[]
  command: (editor: Editor) => void
  requiredPlan?: PlanLevel
}

export type SlashCommandCategory =
  | 'text'
  | 'media'
  | 'interactive'
  | 'callouts'
  | 'ui'
  | 'tables'

export interface SlashCommandsListProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
  editor: Editor
  currentPlan?: PlanLevel
}

export interface SlashCommandsListRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

export interface SuggestionProps {
  editor: Editor
  range: Range
  query: string
  text: string
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
  decorationNode: Element | null
  clientRect: (() => DOMRect | null) | null
}
