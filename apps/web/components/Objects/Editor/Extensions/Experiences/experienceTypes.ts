/*
 The Experiences family as plain data: node names, i18n keys and tones, plus
 a short text summary of a block's content. No React and no TipTap imports,
 so the AI engine, tests and the registry can all read it.
*/
import type { BlockTone } from '../../Blocks/ui/BlockChrome'

export interface ExperienceType {
  /** Registry id, also the i18n key segment (editor.experiences.<i18n>.*). */
  id: string
  nodeName: string
  i18n: string
  tone: BlockTone
}

/** The 10 new nodes (Scenarios and Flashcards are older nodes, see registry). */
export const NEW_EXPERIENCE_TYPES: readonly ExperienceType[] = [
  { id: 'sort', nodeName: 'expSort', i18n: 'sort', tone: 'interactive' },
  { id: 'sequence', nodeName: 'expSequence', i18n: 'sequence', tone: 'info' },
  { id: 'match', nodeName: 'expMatch', i18n: 'match', tone: 'media' },
  { id: 'hotspot', nodeName: 'expHotspot', i18n: 'hotspot', tone: 'embed' },
  { id: 'gaps', nodeName: 'expGaps', i18n: 'gaps', tone: 'link' },
  { id: 'mythFact', nodeName: 'expMythFact', i18n: 'myth_fact', tone: 'document' },
  { id: 'speedRound', nodeName: 'expSpeedRound', i18n: 'speed_round', tone: 'math' },
  { id: 'estimate', nodeName: 'expEstimate', i18n: 'estimate', tone: 'people' },
  { id: 'spotMistake', nodeName: 'expSpotMistake', i18n: 'spot_mistake', tone: 'dynamic' },
  { id: 'codeLock', nodeName: 'expCodeLock', i18n: 'code_lock', tone: 'code' },
]

export const EXPERIENCE_NODE_NAMES: readonly string[] = NEW_EXPERIENCE_TYPES.map((x) => x.nodeName)

const BY_NODE = new Map(NEW_EXPERIENCE_TYPES.map((x) => [x.nodeName, x]))

export function isExperienceNode(type: string | null | undefined): boolean {
  return !!type && BY_NODE.has(type)
}

export function experienceTypeOf(type: string | null | undefined): ExperienceType | undefined {
  return type ? BY_NODE.get(type) : undefined
}

/** `editor.experiences.<block>.title` for a node name, or null. */
export function experienceTitleKey(type: string | null | undefined): string | null {
  const x = experienceTypeOf(type)
  return x ? `editor.experiences.${x.i18n}.title` : null
}

function list(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

/**
 * A heading and up to `max` short lines describing a block's content, for
 * previews where the interactive view can't run (AI proposals, summaries).
 */
export function experienceSummary(type: string, attrs: Record<string, any> | null | undefined, max = 8): { title: string; lines: string[] } {
  const a = attrs || {}
  const title = str(a.title || a.question)
  let lines: string[] = []
  switch (type) {
    case 'expSort': {
      const cats = new Map(list(a.categories).map((c) => [str(c?.id), str(c?.label)]))
      lines = list(a.items).map((i) => `${str(i?.text)} → ${cats.get(str(i?.categoryId)) ?? ''}`.trim())
      break
    }
    case 'expSequence':
      lines = list(a.items).map((i, n) => `${n + 1}. ${str(i?.text)}`)
      break
    case 'expMatch':
      lines = list(a.pairs).map((p) => `${str(p?.left)} ↔ ${str(p?.right)}`)
      break
    case 'expHotspot':
      lines = list(a.spots).map((s) => str(s?.label))
      break
    case 'expGaps':
      lines = [str(a.text).replace(/\[\[([^\]|]*)(\|[^\]]*)?\]\]/g, '[$1]')]
      break
    case 'expMythFact':
      lines = list(a.statements).map((s) => `${s?.isTrue ? '✓' : '✗'} ${str(s?.text)}`)
      break
    case 'expSpeedRound':
      lines = list(a.questions).map((q) => {
        const opts = list(q?.options)
        const right = opts[Number(q?.answer)]
        return right !== undefined ? `${str(q?.prompt)} → ${str(right)}` : str(q?.prompt)
      })
      break
    case 'expEstimate':
      lines = [`${str(a.answer)} ${str(a.unit)}`.trim()]
      break
    case 'expSpotMistake':
      lines = list(a.segments)
        .filter((s) => s?.isMistake)
        .map((s) => (s?.correction ? `${str(s?.text)} → ${str(s.correction)}` : str(s?.text)))
      break
    case 'expCodeLock':
      lines = list(a.clues).map((c) => `${str(c?.question)} → ${str(c?.answer)}`)
      break
    default:
      lines = []
  }
  return { title, lines: lines.filter(Boolean).slice(0, max) }
}
