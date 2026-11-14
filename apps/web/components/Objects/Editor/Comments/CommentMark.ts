import { Mark, mergeAttributes } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { AddMarkStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { COMMENT_MARK } from './commentContent'

// The `comment` mark anchors an editor comment thread on text:
// { type: 'comment', attrs: { threadId } }.
//
// - It is stored in the document like any mark, so it follows the text through
//   edits, survives saves, and syncs through Yjs in collaborative mode.
// - `excludes: ''` lets several threads cover the same text; y-prosemirror
//   stores such marks under a hashed key, so they stay distinct in the Y doc.
// - `inclusive: false`: typing at the edge of a comment doesn't extend it.
// - The mark itself renders an unstyled span. Highlights are decorations
//   driven from the comments UI, so resolved threads, threads still loading
//   and threads of other activities (pasted text) show nothing.
//
// Learners never see it: every non-editor renderer strips the mark
// (commentContent.ts) and the API drops it for anyone who can't edit.

export type CommentHighlightMeta = {
  /** Thread ids to highlight (open threads). */
  visible?: string[]
  /** The focused thread, drawn darker. */
  active?: string | null
  /** The range a comment is being written for, kept highlighted meanwhile. */
  pending?: { from: number; to: number } | null
}

type HighlightState = {
  visible: Set<string>
  active: string | null
  pending: { from: number; to: number } | null
  deco: DecorationSet
}

export type CommentMarkStorage = {
  /** ⌘⌥M / Ctrl+Alt+M: the comments UI opens its composer. */
  onShortcut: (() => void) | null
  /** Click in the text: the highlighted threads under the pointer (may be []). */
  onClickThreads: ((_threadIds: string[]) => void) | null
  /** Threads of this activity; pasted comment marks of other threads are dropped. */
  knownThreadIds: Set<string> | null
}

export const commentHighlightKey = new PluginKey<HighlightState>('commentHighlights')

export const HIGHLIGHT_CLASS = 'lh-comment-hl bg-amber-100/80 border-b-2 border-amber-300/90 cursor-pointer rounded-[2px] transition-colors'
export const OVERLAP_CLASS = 'lh-comment-hl--overlap !bg-amber-200/80 !border-amber-400'
export const ACTIVE_CLASS = 'lh-comment-hl--active !bg-amber-200 !border-amber-500'
export const PENDING_CLASS = 'lh-comment-pending bg-amber-100 border-b-2 border-dashed border-amber-400'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      /** Anchor a thread on the selection (or the given range). */
      setComment: (_threadId: string, _range?: { from: number; to: number }) => ReturnType
      /** Remove one thread's anchors everywhere in the document. */
      unsetComment: (_threadId: string) => ReturnType
      /** Update highlights (no document change, never synced or saved). */
      setCommentHighlights: (_meta: CommentHighlightMeta) => ReturnType
    }
  }
}

function buildDecorations(
  doc: PMNode,
  visible: Set<string>,
  active: string | null,
  pending: { from: number; to: number } | null
): DecorationSet {
  const decos: Decoration[] = []
  if (visible.size) {
    doc.descendants((node, pos) => {
      if (!node.isText || !node.marks.length) return
      const ids: string[] = []
      for (const mark of node.marks) {
        const id = mark.attrs.threadId
        if (mark.type.name === COMMENT_MARK && visible.has(id) && !ids.includes(id)) ids.push(id)
      }
      if (!ids.length) return
      // ProseMirror merges decorations on the same text into one span, so
      // overlap is drawn with its own, darker class rather than by nesting.
      let cls = HIGHLIGHT_CLASS
      if (ids.length > 1) cls += ` ${OVERLAP_CLASS}`
      if (active && ids.includes(active)) cls += ` ${ACTIVE_CLASS}`
      decos.push(
        Decoration.inline(pos, pos + node.nodeSize, {
          class: cls,
          'data-comment-thread': active && ids.includes(active) ? active : ids[0],
          'data-comment-threads': ids.join(' '),
        })
      )
    })
  }
  if (pending && pending.from < pending.to && pending.to <= doc.content.size) {
    decos.push(Decoration.inline(pending.from, pending.to, { class: PENDING_CLASS }))
  }
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty
}

function sliceHasCommentMark(slice: Slice): boolean {
  let found = false
  slice.content.descendants((node) => {
    if (found) return false
    if (node.marks.some((m) => m.type.name === COMMENT_MARK)) found = true
    return !found
  })
  return found
}

/** Whether a transaction may have added, removed or moved comment marks. */
export function touchesCommentMarks(tr: Transaction): boolean {
  return tr.steps.some((step) => {
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      return step.mark.type.name === COMMENT_MARK
    }
    if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
      return sliceHasCommentMark((step as any).slice as Slice)
    }
    return false
  })
}

function filterFragment(fragment: Fragment, keep: (_id: string) => boolean): Fragment {
  const nodes: PMNode[] = []
  fragment.forEach((node) => {
    if (node.isText) {
      const marks = node.marks.filter((m) => m.type.name !== COMMENT_MARK || keep(m.attrs.threadId))
      nodes.push(marks.length === node.marks.length ? node : node.mark(marks))
    } else {
      nodes.push(node.copy(filterFragment(node.content, keep)))
    }
  })
  return Fragment.fromArray(nodes)
}

/** Drop comment marks of threads that aren't this activity's from pasted content. */
export function filterPastedCommentMarks(slice: Slice, known: Set<string> | null): Slice {
  if (!sliceHasCommentMark(slice)) return slice
  const keep = (id: string) => !!known && known.has(id)
  return new Slice(filterFragment(slice.content, keep), slice.openStart, slice.openEnd)
}

const CommentMark = Mark.create<Record<string, never>, CommentMarkStorage>({
  name: COMMENT_MARK,
  inclusive: false,
  excludes: '',
  spanning: true,

  addStorage() {
    return { onShortcut: null, onClickThreads: null, knownThreadIds: null }
  },

  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-comment-thread'),
        renderHTML: (attrs: { threadId?: string | null }) =>
          attrs.threadId ? { 'data-comment-thread': attrs.threadId } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-thread]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'lh-comment-anchor' }), 0]
  },

  addCommands() {
    return {
      setComment:
        (threadId, range) =>
        ({ tr, state, dispatch }) => {
          const from = range ? range.from : state.selection.from
          const to = range ? range.to : state.selection.to
          if (!threadId || from >= to || to > state.doc.content.size) return false
          if (dispatch) tr.addMark(from, to, state.schema.marks[COMMENT_MARK].create({ threadId }))
          return true
        },
      unsetComment:
        (threadId) =>
        ({ tr, state, dispatch }) => {
          let found = false
          state.doc.descendants((node, pos) => {
            if (!node.isText) return
            for (const mark of node.marks) {
              if (mark.type.name === COMMENT_MARK && mark.attrs.threadId === threadId) {
                found = true
                if (dispatch) tr.removeMark(pos, pos + node.nodeSize, mark)
              }
            }
          })
          return found
        },
      setCommentHighlights:
        (meta) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(commentHighlightKey, meta)
            tr.setMeta('addToHistory', false)
          }
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-m': () => {
        const open = this.storage.onShortcut
        if (!open) return false
        open()
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      new Plugin<HighlightState>({
        key: commentHighlightKey,
        state: {
          init: () => ({ visible: new Set(), active: null, pending: null, deco: DecorationSet.empty }),
          apply(tr, prev, _old, newState) {
            const meta = tr.getMeta(commentHighlightKey) as CommentHighlightMeta | undefined
            let { visible, active, pending } = prev
            if (pending && tr.docChanged) {
              const from = tr.mapping.map(pending.from, 1)
              const to = tr.mapping.map(pending.to, -1)
              pending = from < to ? { from, to } : null
            }
            if (meta) {
              if (meta.visible) visible = new Set(meta.visible)
              if (meta.active !== undefined) active = meta.active
              if (meta.pending !== undefined) pending = meta.pending
              return { visible, active, pending, deco: buildDecorations(newState.doc, visible, active, pending) }
            }
            if (!tr.docChanged) return prev
            if (touchesCommentMarks(tr)) {
              return { visible, active, pending, deco: buildDecorations(newState.doc, visible, active, pending) }
            }
            // Plain typing: move the existing highlights instead of re-walking the doc.
            return { visible, active, pending, deco: prev.deco.map(tr.mapping, tr.doc) }
          },
        },
        props: {
          decorations(state) {
            return commentHighlightKey.getState(state)?.deco
          },
          handleClick(view, pos) {
            const notify = storage.onClickThreads
            if (!notify) return false
            const hl = commentHighlightKey.getState(view.state)
            const ids: string[] = []
            const $pos = view.state.doc.resolve(pos)
            const nodes = [$pos.nodeAfter, $pos.nodeBefore]
            for (const node of nodes) {
              for (const mark of node?.marks ?? []) {
                const id = mark.attrs.threadId
                if (mark.type.name === COMMENT_MARK && hl?.visible.has(id) && !ids.includes(id)) ids.push(id)
              }
              if (ids.length) break
            }
            notify(ids)
            return false
          },
          transformPasted(slice) {
            return filterPastedCommentMarks(slice, storage.knownThreadIds)
          },
        },
      }),
    ]
  },
})

export default CommentMark
