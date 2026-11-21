/**
 * How each block type is edited from the learner page ("light edit").
 *
 * - `text`: edited in place in the inline editor, with the formatting bar
 *   (marks, headings, lists, links). Several text blocks can be edited at
 *   once (a selection across paragraphs).
 * - `block`: a focused mini editor holding just that block, where the block
 *   shows its own editing UI (the same node view the full editor uses), so
 *   quizzes, callouts, images, code, embeds, tables… need no form of their
 *   own.
 * - `none`: shown but not editable from the learner page (personalized
 *   content, and blocks that carry raw HTML or third-party code).
 *
 * New block types plug in with `registerContributionBlock`. Types nobody
 * registered are edited as `block`, which works for any node the learner
 * schema knows; register a type only to change its label or mode. Pure data,
 * no React, so tests import it.
 */

export type ContributionEditMode = 'text' | 'block' | 'none'

export type ContributionBlockConfig = {
  mode: ContributionEditMode
  /** i18n key under `contributions.blocks.` naming the block in the UI. */
  label: string
}

const registry = new Map<string, ContributionBlockConfig>()

export function registerContributionBlock(type: string, config: ContributionBlockConfig): void {
  registry.set(type, config)
}

export function blockConfig(type: string | undefined | null): ContributionBlockConfig {
  return registry.get(String(type)) ?? { mode: 'block', label: 'block' }
}

export function textBlockTypes(): Set<string> {
  return new Set([...registry.entries()].filter(([, c]) => c.mode === 'text').map(([t]) => t))
}

// ── core blocks ──
const TEXT: [string, string][] = [
  ['paragraph', 'paragraph'],
  ['heading', 'heading'],
  ['bulletList', 'list'],
  ['orderedList', 'list'],
  ['taskList', 'list'],
  ['blockquote', 'quote'],
]
for (const [type, label] of TEXT) registerContributionBlock(type, { mode: 'text', label })

const BLOCKS: [string, string][] = [
  ['codeBlock', 'code'],
  ['calloutInfo', 'callout'],
  ['calloutWarning', 'callout'],
  ['callout', 'callout'],
  ['blockImage', 'image'],
  ['blockVideo', 'video'],
  ['blockAudio', 'audio'],
  ['blockPDF', 'pdf'],
  ['blockMathEquation', 'math'],
  ['blockCode', 'code_playground'],
  ['blockQuiz', 'quiz'],
  ['youtube', 'video'],
  ['table', 'table'],
  ['blockWebPreview', 'link_preview'],
  ['badge', 'badge'],
  ['button', 'button'],
  ['flipcard', 'flashcard'],
  ['flipcardGrid', 'flashcards'],
  ['scenarios', 'scenario'],
  ['toggleBlock', 'toggle'],
  ['horizontalRule', 'divider'],
  ['blockLibrary', 'library'],
  ['blockUser', 'user'],
]
for (const [type, label] of BLOCKS) registerContributionBlock(type, { mode: 'block', label })

// Personalized for each learner by the API: what one learner sees is not the
// page others see, so it can't be suggested on.
registerContributionBlock('conditionalBlock', { mode: 'none', label: 'personalized' })

// Raw HTML or third-party code: only the course team changes these (the API
// refuses a suggestion that creates or changes one). Feedback still works.
registerContributionBlock('blockEmbed', { mode: 'none', label: 'embed' })
registerContributionBlock('blockMagic', { mode: 'none', label: 'magic_block' })
registerContributionBlock('blockH5P', { mode: 'none', label: 'h5p' })
