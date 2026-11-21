import type { AnyExtension } from '@tiptap/core'
import type { SlashCommandItem } from '../SlashCommands/types'

/**
 * Where the extensions run. 'editor' is the authoring editor, 'preview' the
 * read-only editor preview, 'learner' the activity renderer shared by
 * DynamicCanva, StaticCanva and @learnhouse/react.
 */
export type PlusMode = 'editor' | 'preview' | 'learner'

export interface PlusContext {
  mode: PlusMode
  activity?: any
}

export type PlusExtensionFactory = (ctx: PlusContext) => AnyExtension[]
export type { SlashCommandItem }
