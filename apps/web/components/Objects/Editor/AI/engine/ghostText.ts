/*
 Inline "continue writing" suggestions (ghost text). Off by default.

 When the caret rests at the end of a paragraph with enough text, a short
 continuation is fetched and shown greyed out after the caret: Tab accepts
 it (one transaction, `lh-origin: ai`), Escape or any edit dismisses it.
 Nothing is in the document until Tab, so collaborators never see it.
*/
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { AI_ORIGIN, AI_ORIGIN_META } from './proposals'

export interface GhostState {
  text: string
  pos: number
}

export const aiGhostKey = new PluginKey<GhostState>('lhAIGhost')

export type FetchSuggestion = (_before: string, _after: string, _signal: AbortSignal) => Promise<string>

export interface GhostOptions {
  fetchSuggestion: FetchSuggestion
  /** Idle time before asking, ms. */
  delay?: number
  /** Minimum characters in the paragraph before suggesting. */
  minChars?: number
  hint?: string
}

const EMPTY: GhostState = { text: '', pos: -1 }

/** Where a suggestion may show: an empty selection at the end of a long enough text block. */
export function suggestionSpot(state: EditorState, minChars: number): number | null {
  const { selection } = state
  if (!selection.empty) return null
  const $from = selection.$from
  const parent = $from.parent
  if (!parent.isTextblock || parent.type.spec.code) return null
  if ($from.parentOffset !== parent.content.size) return null
  if (parent.textContent.trim().length < minChars) return null
  return selection.from
}

/** Accept the shown suggestion: insert it at its position. */
export function acceptGhost(view: EditorView): boolean {
  const ghost = aiGhostKey.getState(view.state)
  if (!ghost || !ghost.text || ghost.pos < 0) return false
  const text = /\s$/.test(view.state.doc.textBetween(Math.max(0, ghost.pos - 1), ghost.pos)) || /^\s/.test(ghost.text) ? ghost.text : ` ${ghost.text}`
  const tr = view.state.tr.insertText(text, ghost.pos)
  tr.setMeta(AI_ORIGIN_META, AI_ORIGIN)
  tr.setMeta(aiGhostKey, EMPTY)
  view.dispatch(tr)
  return true
}

export function createGhostPlugin(options: GhostOptions): Plugin<GhostState> {
  const delay = options.delay ?? 1100
  const minChars = options.minChars ?? 24
  return new Plugin<GhostState>({
    key: aiGhostKey,
    state: {
      init: () => EMPTY,
      apply(tr, value) {
        const meta = tr.getMeta(aiGhostKey) as GhostState | undefined
        if (meta) return meta
        if (tr.docChanged || tr.selectionSet) return value.text ? EMPTY : value
        return value
      },
    },
    props: {
      decorations(state) {
        const ghost = aiGhostKey.getState(state)
        if (!ghost?.text || ghost.pos < 0 || ghost.pos > state.doc.content.size) return DecorationSet.empty
        return DecorationSet.create(state.doc, [
          Decoration.widget(
            ghost.pos,
            () => {
              const span = document.createElement('span')
              span.className = 'lh-ai-ghost'
              span.textContent = ghost.text
              if (options.hint) {
                const kbd = document.createElement('kbd')
                kbd.className = 'lh-ai-ghost__kbd'
                kbd.textContent = options.hint
                span.appendChild(kbd)
              }
              return span
            },
            { side: 1, key: `ghost:${ghost.pos}:${ghost.text.length}` }
          ),
        ])
      },
      handleKeyDown(view, event) {
        const ghost = aiGhostKey.getState(view.state)
        if (!ghost?.text) return false
        if (event.key === 'Tab' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault()
          return acceptGhost(view)
        }
        if (event.key === 'Escape') {
          view.dispatch(view.state.tr.setMeta(aiGhostKey, EMPTY))
          return true
        }
        return false
      },
    },
    view() {
      let timer: ReturnType<typeof setTimeout> | null = null
      let controller: AbortController | null = null
      const cancel = () => {
        if (timer) clearTimeout(timer)
        timer = null
        controller?.abort()
        controller = null
      }
      return {
        update(view, prev) {
          if (prev && prev.doc.eq(view.state.doc) && prev.selection.eq(view.state.selection)) return
          cancel()
          if (!view.editable || !view.hasFocus()) return
          const pos = suggestionSpot(view.state, minChars)
          if (pos === null) return
          timer = setTimeout(async () => {
            const state = view.state
            if (suggestionSpot(state, minChars) !== pos) return
            controller = new AbortController()
            const before = state.doc.textBetween(Math.max(0, pos - 6000), pos, '\n', ' ')
            const after = state.doc.textBetween(pos, Math.min(state.doc.content.size, pos + 1200), '\n', ' ')
            try {
              const text = (await options.fetchSuggestion(before, after, controller.signal)).trim()
              if (!text || view.isDestroyed) return
              // Still where it was asked for: show it.
              if (view.state.doc.eq(state.doc) && view.state.selection.from === pos) {
                view.dispatch(view.state.tr.setMeta(aiGhostKey, { text, pos }))
              }
            } catch {
              // aborted or failed: no suggestion
            }
          }, delay)
        },
        destroy: cancel,
      }
    },
  })
}
