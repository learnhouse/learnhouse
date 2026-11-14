/* Shared pieces of the AI Editor's actions: icons, the message each sends. */
import type React from 'react'
import {
  Article,
  ArrowsInSimple,
  ArrowsOutSimple,
  Cards,
  FastForward,
  Feather,
  GitBranch,
  GraduationCap,
  ImageSquare,
  Info,
  Lightbulb,
  ListChecks,
  MagnifyingGlass,
  SealQuestion,
  Smiley,
  Table,
  TextAa,
  Translate,
  Wheelchair,
} from '@phosphor-icons/react'
import type { QuickActionId } from '../engine/actions'

export const ACTION_ICONS: Record<QuickActionId, React.ComponentType<any>> = {
  continue: FastForward,
  draft_section: Article,
  examples: Lightbulb,
  improve: Feather,
  shorten: ArrowsInSimple,
  expand: ArrowsOutSimple,
  grammar: TextAa,
  tone: Smiley,
  reading_level: GraduationCap,
  translate: Translate,
  table: Table,
  callouts: Info,
  takeaways: ListChecks,
  quiz: SealQuestion,
  flashcards: Cards,
  scenario: GitBranch,
  images: ImageSquare,
  accessibility: Wheelchair,
  seo: MagnifyingGlass,
  explain: Info,
}

export interface Heading {
  index: number
  level: number
  text: string
}

export interface ActionRun {
  action: QuickActionId
  message: string
  /** Block the action is about (the section to draft). */
  path?: number[]
  /** Translate into a new page instead of in place. */
  asCopy?: boolean
}

export function actionMessage(
  t: (_k: string, _o?: any) => string,
  id: QuickActionId,
  opts: { param?: string; hasSelection?: boolean; heading?: string; asCopy?: boolean } = {}
): string {
  const scope = opts.hasSelection ? t('editor.ai_editor_v2.scope.selection') : t('editor.ai_editor_v2.scope.page')
  switch (id) {
    case 'tone':
      return t('editor.ai_editor_v2.messages.tone', { scope, tone: t(`editor.ai_editor_v2.tones.${opts.param || 'friendly'}`) })
    case 'reading_level':
      return t('editor.ai_editor_v2.messages.reading_level', { level: t(`editor.ai_editor_v2.levels.${opts.param || 'beginner'}`) })
    case 'translate':
      return opts.asCopy
        ? t('editor.ai_editor_v2.messages.translate_copy', { language: opts.param || 'English' })
        : t('editor.ai_editor_v2.messages.translate', { scope, language: opts.param || 'English' })
    case 'draft_section':
      return t('editor.ai_editor_v2.messages.draft_section', { section: opts.heading || '' })
    default:
      return t(`editor.ai_editor_v2.messages.${id}`, { scope })
  }
}
