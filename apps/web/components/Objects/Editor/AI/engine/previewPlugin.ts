/*
 In-document preview of AI proposals: the blocks a change would replace are
 tinted (struck through for deletions) and the new content is shown right
 after them, with Accept / Reject on it. Pure decorations: nothing is in the
 document (or the shared Yjs room) until the author accepts.

 Registered at runtime by the AI Editor (editor.registerPlugin), so the
 editor's extension list stays untouched. Hunks are located again on every
 document change (see proposals.ts), so the preview follows other people's
 edits and disappears when its blocks are gone.
*/
import { DOMSerializer, Fragment, Node as PMNode, Schema } from '@tiptap/pm/model'
import { EditorState, Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { AIEditorHunk } from '@services/ai/aiEditor'
import { Aliases, locateHunk, nodesFromJSON } from './proposals'

export interface PreviewItem {
  /** `${proposalId}:${hunkId}` */
  key: string
  hunk: AIEditorHunk
  label: string
  aliases?: Aliases
}

export interface PreviewLabels {
  accept: string
  reject: string
  ai: string
  generate: (_credits: number) => string
  imageSuggestion: string
  quiz: (_count: number) => string
  cards: (_count: number) => string
  block: (_type: string) => string
  imageCredits: number
}

export interface PreviewState {
  items: PreviewItem[]
  focus: string | null
  version: number
}

export const aiPreviewKey = new PluginKey<PreviewState>('lhAIPreview')

export type PreviewAction = (_key: string, _action: 'accept' | 'reject') => void

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function atomSummary(node: PMNode, labels: PreviewLabels): HTMLElement {
  const box = el('div', 'lh-ai-atom')
  const type = node.type.name
  if (type === 'blockQuiz') {
    const questions: any[] = Array.isArray(node.attrs.questions) ? node.attrs.questions : []
    box.appendChild(el('div', 'lh-ai-atom__title', labels.quiz(questions.length)))
    const list = el('ol', 'lh-ai-atom__list')
    for (const q of questions.slice(0, 6)) {
      const li = el('li')
      li.appendChild(el('span', 'lh-ai-atom__q', String(q?.question ?? '')))
      const right = (Array.isArray(q?.answers) ? q.answers : []).filter((a: any) => a?.correct).map((a: any) => a.answer)
      if (right.length) li.appendChild(el('span', 'lh-ai-atom__a', right.join(', ')))
      list.appendChild(li)
    }
    box.appendChild(list)
    return box
  }
  if (type === 'flipcard' || type === 'flipcardGrid') {
    const cards: PMNode[] = type === 'flipcard' ? [node] : (node.content.content as PMNode[])
    box.appendChild(el('div', 'lh-ai-atom__title', labels.cards(cards.length)))
    const list = el('ul', 'lh-ai-atom__list')
    for (const c of cards.slice(0, 8)) {
      const li = el('li')
      li.appendChild(el('span', 'lh-ai-atom__q', String(c.attrs.question ?? '')))
      li.appendChild(el('span', 'lh-ai-atom__a', String(c.attrs.answer ?? '')))
      list.appendChild(li)
    }
    box.appendChild(list)
    return box
  }
  box.appendChild(el('div', 'lh-ai-atom__title', labels.block(type)))
  const text = node.textContent.trim()
  if (text) box.appendChild(el('div', 'lh-ai-atom__a', text.slice(0, 280)))
  return box
}

const SUMMARY_TYPES = new Set(['blockQuiz', 'flipcard', 'flipcardGrid', 'scenarios', 'blockMagic', 'codePlayground'])

export function renderNodes(nodes: PMNode[], schema: Schema, labels: PreviewLabels): HTMLElement {
  const body = el('div', 'lh-ai-new__body')
  let serializer: DOMSerializer | null = null
  try {
    serializer = DOMSerializer.fromSchema(schema)
  } catch {
    serializer = null
  }
  for (const node of nodes) {
    if (node.isAtom || SUMMARY_TYPES.has(node.type.name) || !serializer) {
      body.appendChild(atomSummary(node, labels))
      continue
    }
    try {
      body.appendChild(serializer.serializeFragment(Fragment.from(node)))
    } catch {
      body.appendChild(el('p', undefined, node.textContent))
    }
  }
  return body
}

function bar(item: PreviewItem, labels: PreviewLabels, onAction: { current: PreviewAction }): HTMLElement {
  const row = el('div', 'lh-ai-new__bar')
  row.appendChild(el('span', 'lh-ai-new__chip', labels.ai))
  row.appendChild(el('span', 'lh-ai-new__label', item.label))
  row.appendChild(el('span', 'lh-ai-new__spacer'))
  const reject = el('button', 'lh-ai-new__btn', labels.reject) as HTMLButtonElement
  reject.type = 'button'
  reject.dataset.act = 'reject'
  const accept = el(
    'button',
    'lh-ai-new__btn lh-ai-new__btn--accept',
    item.hunk.kind === 'image' ? labels.generate(labels.imageCredits) : labels.accept
  ) as HTMLButtonElement
  accept.type = 'button'
  accept.dataset.act = 'accept'
  for (const b of [reject, accept]) {
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      onAction.current(item.key, b.dataset.act as 'accept' | 'reject')
    })
  }
  row.appendChild(reject)
  row.appendChild(accept)
  return row
}

function widget(item: PreviewItem, schema: Schema, labels: PreviewLabels, onAction: { current: PreviewAction }, focused: boolean) {
  return () => {
    const box = el('div', `lh-ai-new${focused ? ' lh-ai-new--focus' : ''}${item.hunk.kind === 'delete' ? ' lh-ai-new--del' : ''}`)
    box.setAttribute('contenteditable', 'false')
    box.dataset.aiHunk = item.key
    box.appendChild(bar(item, labels, onAction))
    if (item.hunk.kind === 'image') {
      const body = el('div', 'lh-ai-new__body')
      const img = el('div', 'lh-ai-image')
      img.appendChild(el('div', 'lh-ai-image__title', labels.imageSuggestion))
      img.appendChild(el('div', 'lh-ai-image__prompt', item.hunk.prompt || ''))
      body.appendChild(img)
      box.appendChild(body)
    } else if (item.hunk.after.length) {
      box.appendChild(renderNodes(nodesFromJSON(item.hunk.after, schema), schema, labels))
    }
    return box
  }
}

export function buildDecorations(
  state: EditorState,
  items: PreviewItem[],
  focus: string | null,
  labels: PreviewLabels,
  onAction: { current: PreviewAction }
): DecorationSet {
  const decos: Decoration[] = []
  const { doc, schema } = state
  // Items come newest first: an older change to the same blocks is not drawn
  // over a newer one (it stays reviewable in the panel).
  const taken: [number, number][] = []
  for (const item of items) {
    const located = locateHunk(doc, item.hunk, schema, { aliases: item.aliases })
    if (!located) continue
    const overlaps = taken.some(([a, b]) => (located.from === located.to ? located.from > a && located.from < b : located.from < b && located.to > a) || (a === located.from && b === located.to))
    if (overlaps) continue
    taken.push([located.from, located.to])
    const focused = focus === item.key
    if (located.to > located.from) {
      let pos = located.from
      while (pos < located.to) {
        const node = doc.nodeAt(pos)
        if (!node) break
        decos.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: `lh-ai-old${item.hunk.kind === 'delete' ? ' lh-ai-old--del' : ''}${focused ? ' lh-ai-old--focus' : ''}`,
            'data-ai-hunk-old': item.key,
          })
        )
        pos += node.nodeSize
      }
    }
    decos.push(
      Decoration.widget(located.to, widget(item, schema, labels, onAction, focused), {
        side: 1,
        key: `${item.key}:${focused ? 'f' : ''}`,
        ignoreSelection: true,
        stopEvent: () => true,
      })
    )
  }
  return DecorationSet.create(doc, decos)
}

export function createPreviewPlugin(labels: { current: PreviewLabels }, onAction: { current: PreviewAction }): Plugin<PreviewState> {
  let cache: { doc: PMNode; version: number; set: DecorationSet } | null = null
  return new Plugin<PreviewState>({
    key: aiPreviewKey,
    state: {
      init: () => ({ items: [], focus: null, version: 0 }),
      apply(tr, value) {
        const meta = tr.getMeta(aiPreviewKey) as Partial<PreviewState> | undefined
        if (!meta) return value
        return { items: meta.items ?? value.items, focus: meta.focus !== undefined ? meta.focus : value.focus, version: value.version + 1 }
      },
    },
    props: {
      decorations(state) {
        const ps = aiPreviewKey.getState(state)
        if (!ps || !ps.items.length) return DecorationSet.empty
        if (cache && cache.doc === state.doc && cache.version === ps.version) return cache.set
        const set = buildDecorations(state, ps.items, ps.focus, labels.current, onAction)
        cache = { doc: state.doc, version: ps.version, set }
        return set
      },
    },
  })
}
