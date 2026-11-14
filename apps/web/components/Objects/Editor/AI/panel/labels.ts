import type { AIEditorHunk } from '@services/ai/aiEditor'

type T = (_key: string, _opts?: any) => string

const BLOCK_KEYS: Record<string, string> = {
  paragraph: 'paragraph',
  heading: 'heading',
  bulletList: 'list',
  orderedList: 'list',
  taskList: 'list',
  blockquote: 'quote',
  codeBlock: 'code',
  table: 'table',
  callout: 'callout',
  calloutInfo: 'callout',
  calloutWarning: 'callout',
  blockQuiz: 'quiz',
  flipcard: 'flashcards',
  flipcardGrid: 'flashcards',
  scenarios: 'scenario',
  blockImage: 'image',
  blockVideo: 'video',
  blockEmbed: 'embed',
  horizontalRule: 'divider',
  blockMathEquation: 'math',
  toggleBlock: 'toggle',
}

export function blockName(type: string | undefined, t: T): string {
  const key = BLOCK_KEYS[type || ''] || 'block'
  return t(`editor.ai_editor_v2.blocks.${key}`)
}

/** "Rewrite paragraph", "Add quiz", "Remove heading", "Suggested image". */
export function hunkLabel(h: AIEditorHunk, t: T): string {
  if (h.kind === 'image') return t('editor.ai_editor_v2.hunk.image')
  const first = (h.after[0] || h.before[0])?.type
  const name = blockName(first, t)
  if (h.kind === 'insert') {
    return h.after.length > 1 ? t('editor.ai_editor_v2.hunk.add_many', { count: h.after.length }) : t('editor.ai_editor_v2.hunk.add', { block: name })
  }
  if (h.kind === 'delete') {
    const quiz = h.before[0]?.type === 'blockQuiz' ? h.before[0] : null
    if (quiz) return t('editor.ai_editor_v2.hunk.remove_quiz', { count: Array.isArray(quiz.attrs?.questions) ? quiz.attrs.questions.length : 0 })
    return t('editor.ai_editor_v2.hunk.remove', { block: name })
  }
  const sameType = h.before[0]?.type === h.after[0]?.type
  return sameType ? t('editor.ai_editor_v2.hunk.rewrite', { block: name }) : t('editor.ai_editor_v2.hunk.change_to', { block: name })
}

const TOOL_KEYS: Record<string, string> = {
  get_activity_content: 'read_page',
  propose_page_edits: 'propose',
  fetch: 'fetch',
  read_file: 'read_file',
  search: 'search',
  browse_library: 'library',
  get_course: 'read_course',
  list_activities: 'read_course',
  create_activity: 'create_page',
  write_activity_content: 'write_page',
  edit_activity_content: 'write_page',
  update_plan: 'plan',
}

export function toolLabel(raw: string, done: boolean, t: T): string {
  const name = typeof raw === 'string' ? raw : String((raw as any)?.name ?? '')
  const key = TOOL_KEYS[name]
  if (key) return t(`editor.ai_editor_v2.tools.${key}${done ? '_done' : ''}`)
  const human = name.replace(/_/g, ' ')
  return done ? t('editor.ai_editor_v2.tools.generic_done', { name: human }) : t('editor.ai_editor_v2.tools.generic', { name: human })
}
