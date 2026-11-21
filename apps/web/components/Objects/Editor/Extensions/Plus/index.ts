// Single registration point for the Editor Plus blocks (EDITOR_PLUS_SPEC.md).
// Wired into Editor.tsx, EditorPreview.tsx and activityExtensions.ts; the
// slash menu items live in ./slashItems (editor only). Builders only edit
// their own sub-barrel.
import type { AnyExtension } from '@tiptap/core'
import { tableExtensions } from './tables'
import { layoutExtensions } from './layout'
import { mediaExtensions } from './media'
import { upgradesExtensions } from './upgrades'
import type { PlusContext } from './types'

export type { PlusContext, PlusMode } from './types'

export function plusExtensions(ctx: PlusContext): AnyExtension[] {
  return [
    ...tableExtensions(ctx),
    ...layoutExtensions(ctx),
    ...mediaExtensions(ctx),
    ...upgradesExtensions(ctx),
  ]
}
