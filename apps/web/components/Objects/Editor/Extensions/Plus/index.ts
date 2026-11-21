// Single registration point for the Editor Plus blocks (EDITOR_PLUS_SPEC.md).
// Wired into Editor.tsx, EditorPreview.tsx, activityExtensions.ts and the slash
// menu; builders only edit their own sub-barrel.
import type { AnyExtension } from '@tiptap/core'
import { tableExtensions, tableSlashItems } from './tables'
import { layoutExtensions, layoutSlashItems } from './layout'
import { mediaExtensions, mediaSlashItems } from './media'
import { upgradesExtensions, upgradesSlashItems } from './upgrades'
import type { PlusContext, SlashCommandItem } from './types'

export type { PlusContext, PlusMode } from './types'

export function plusExtensions(ctx: PlusContext): AnyExtension[] {
  return [
    ...tableExtensions(ctx),
    ...layoutExtensions(ctx),
    ...mediaExtensions(ctx),
    ...upgradesExtensions(ctx),
  ]
}

export const plusSlashItems: SlashCommandItem[] = [
  ...tableSlashItems,
  ...layoutSlashItems,
  ...mediaSlashItems,
  ...upgradesSlashItems,
]
