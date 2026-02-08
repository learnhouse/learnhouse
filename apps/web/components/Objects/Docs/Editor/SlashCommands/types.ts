import { Editor, Range } from '@tiptap/react'
import { ReactNode } from 'react'

export interface DocSlashCommandItem {
  id: string
  title: string
  description: string
  icon: ReactNode
  category: DocSlashCommandCategory
  keywords: string[]
  command: (editor: Editor) => void
}

export type DocSlashCommandCategory =
  | 'text'
  | 'blocks'
  | 'insert'
  | 'media'

export interface DocSlashCommandsListProps {
  items: DocSlashCommandItem[]
  command: (item: DocSlashCommandItem) => void
  editor: Editor
}

export interface DocSlashCommandsListRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

export interface DocSuggestionProps {
  editor: Editor
  range: Range
  query: string
  text: string
  items: DocSlashCommandItem[]
  command: (item: DocSlashCommandItem) => void
  decorationNode: Element | null
  clientRect: (() => DOMRect | null) | null
}
