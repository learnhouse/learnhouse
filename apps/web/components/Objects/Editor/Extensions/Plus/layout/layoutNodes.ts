/*
 The layout and structure nodes (EDITOR_PLUS_SPEC.md, section B).

 Containers hold real ProseMirror content (`block+`), so their text is
 ordinary editable text that old clients still show (an unknown node keeps
 its children). Each node's renderHTML is meaningful without JS or CSS: tabs
 come out as titled sections, a timeline as a list, the table of contents as
 a link list (computed when an editor is at hand, else a placeholder that
 tocDom.hydrateTableOfContents fills).

 Node views: the container views are lazy chunks whose fallbacks draw the
 same learner markup with the content inside, so their text is in the server
 HTML and nothing moves when a view loads; the table of contents (an atom
 that needs the DOM) loads on the client only.
*/
import { Extension, mergeAttributes, Node } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import dynamic from 'next/dynamic'
import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { computeHeadingIds } from '@components/Objects/Activities/DynamicCanva/headingIds'
import type { PlusMode } from '../types'
import {
  ACCORDION_VARIANTS,
  COLUMN_GAPS,
  COLUMN_LAYOUTS,
  COLUMN_VALIGNS,
  TAB_VARIANTS,
  TIMELINE_ORIENTATIONS,
  TIMELINE_VARIANTS,
  TOC_LEVELS,
  columnTracks,
  effectiveLayout,
  iconOf,
  newBlockId,
  oneOf,
  outlineEntries,
  toneOf,
} from './layoutModel'
import { lazyView } from '../lazyView'
import { TabItemView } from './views/TabItemView'
import { ColumnView } from './views/ColumnView'
import {
  AccordionFallback,
  ChecklistFallback,
  ChecklistItemFallback,
  ColumnsFallback,
  KeyTakeawaysFallback,
  TabsFallback,
  TimelineFallback,
  TimelineItemFallback,
} from './views/fallbacks'

// The views (and their editing UI) are lazy chunks; the fallbacks draw the
// same learner markup, content included, until a chunk has loaded.
const TabsView = lazyView('TabsView', () => import('./views/TabsView'), TabsFallback)
const ColumnsView = lazyView('ColumnsView', () => import('./views/ColumnsView'), ColumnsFallback)
const AccordionView = lazyView('AccordionView', () => import('./views/AccordionView'), AccordionFallback)
const TimelineView = lazyView('TimelineView', () => import('./views/TimelineView'), TimelineFallback)
const TimelineItemView = lazyView('TimelineItemView', () => import('./views/TimelineView').then((m) => ({ default: m.TimelineItemView })), TimelineItemFallback)
const KeyTakeawaysView = lazyView('KeyTakeawaysView', () => import('./views/KeyTakeawaysView'), KeyTakeawaysFallback)
const ChecklistView = lazyView('ChecklistView', () => import('./views/ChecklistView'), ChecklistFallback)
const ChecklistItemView = lazyView('ChecklistItemView', () => import('./views/ChecklistView').then((m) => ({ default: m.ChecklistItemView })), ChecklistItemFallback)
const TocView = dynamic(() => import('./views/TocView'), { ssr: false })

export interface LayoutLabels {
  tab: string
  contents: string
  keyTakeaways: string
}

export const DEFAULT_LAYOUT_LABELS: LayoutLabels = { tab: 'Tab', contents: 'Contents', keyTakeaways: 'Key takeaways' }

export interface LayoutNodesOptions {
  mode: PlusMode
  activityId?: string | null
  labels?: () => LayoutLabels
}

/** An attr stored as `data-<html>`; values outside `allowed` fall back to the default. */
function enumAttr<T extends string>(name: string, html: string, allowed: readonly T[], fallback: T) {
  return {
    default: fallback,
    parseHTML: (el: HTMLElement) => oneOf(allowed, el.getAttribute(`data-${html}`), fallback),
    renderHTML: (attrs: Record<string, any>) => ({ [`data-${html}`]: oneOf(allowed, attrs[name], fallback) }),
  }
}

function textAttr(name: string, html: string, fallback: string | null = '') {
  return {
    default: fallback,
    parseHTML: (el: HTMLElement) => el.getAttribute(`data-${html}`) ?? fallback,
    renderHTML: (attrs: Record<string, any>) => (attrs[name] ? { [`data-${html}`]: String(attrs[name]) } : {}),
  }
}

/** A boolean stored only when it differs from its default. */
function boolAttr(name: string, html: string, fallback: boolean) {
  return {
    default: fallback,
    parseHTML: (el: HTMLElement) => {
      const v = el.getAttribute(`data-${html}`)
      return v === null ? fallback : v === 'true'
    },
    renderHTML: (attrs: Record<string, any>) => ((attrs[name] !== false) !== fallback ? { [`data-${html}`]: String(attrs[name] !== false) } : {}),
  }
}

/** The direct child carrying `marker`, which holds the node's content in its HTML. */
const contentChild = (marker: string) => (el: HTMLElement) =>
  (Array.from(el.children).find((c) => c.hasAttribute(marker)) as HTMLElement | undefined) ?? el

export function createLayoutNodes({ mode, activityId = null, labels = () => DEFAULT_LAYOUT_LABELS }: LayoutNodesOptions) {
  const Tabs = Node.create({
    name: 'tabs',
    group: 'block',
    content: 'tabItem{2,8}',
    defining: true,
    draggable: true,
    addAttributes() {
      return {
        blockId: textAttr('blockId', 'block-id', null),
        variant: enumAttr('variant', 'variant', TAB_VARIANTS, 'line'),
      }
    },
    parseHTML() {
      return [{ tag: 'div[data-type="tabs"]' }]
    },
    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'tabs', class: 'lh-tabs-static' }), 0]
    },
    addNodeView() {
      return lhNodeView(TabsView)
    },
  })

  const TabItem = Node.create({
    name: 'tabItem',
    content: 'block+',
    defining: true,
    isolating: true,
    addAttributes() {
      return {
        title: textAttr('title', 'title'),
        icon: textAttr('icon', 'icon', null),
      }
    },
    parseHTML() {
      return [{ tag: 'section[data-type="tab-item"]', contentElement: contentChild('data-tab-body') }]
    },
    renderHTML({ node, HTMLAttributes }) {
      const title = String(node.attrs.title || '').trim() || labels().tab
      return ['section', mergeAttributes(HTMLAttributes, { 'data-type': 'tab-item' }), ['h3', { class: 'lh-tab-heading' }, title], ['div', { 'data-tab-body': '' }, 0]]
    },
    addNodeView() {
      return lhNodeView(TabItemView)
    },
  })

  const Columns = Node.create({
    name: 'columns',
    group: 'block',
    content: 'column{2,4}',
    defining: true,
    draggable: true,
    addAttributes() {
      return {
        layout: enumAttr('layout', 'layout', COLUMN_LAYOUTS, '1-1'),
        gap: enumAttr('gap', 'gap', COLUMN_GAPS, 'md'),
        stackOnMobile: boolAttr('stackOnMobile', 'stack', true),
        verticalAlign: enumAttr('verticalAlign', 'valign', COLUMN_VALIGNS, 'top'),
      }
    },
    parseHTML() {
      return [{ tag: 'div[data-type="columns"]' }]
    },
    renderHTML({ node, HTMLAttributes }) {
      return [
        'div',
        mergeAttributes(HTMLAttributes, { 'data-type': 'columns', class: 'lh-columns-static', style: `--lh-cols:${columnTracks(effectiveLayout(node.attrs.layout, node.childCount))}` }),
        0,
      ]
    },
    addNodeView() {
      return lhNodeView(ColumnsView)
    },
  })

  const Column = Node.create({
    name: 'column',
    content: 'block+',
    isolating: true,
    parseHTML() {
      return [{ tag: 'div[data-type="column"]' }]
    },
    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column' }), 0]
    },
    addNodeView() {
      return lhNodeView(ColumnView)
    },
  })

  const Accordion = Node.create({
    name: 'accordion',
    group: 'block',
    content: 'toggleBlock+',
    defining: true,
    draggable: true,
    addAttributes() {
      return {
        single: boolAttr('single', 'single', true),
        variant: enumAttr('variant', 'variant', ACCORDION_VARIANTS, 'default'),
      }
    },
    parseHTML() {
      return [{ tag: 'div[data-type="accordion"]' }]
    },
    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'accordion' }), 0]
    },
    addNodeView() {
      return lhNodeView(AccordionView)
    },
  })

  const Timeline = Node.create({
    name: 'timeline',
    group: 'block',
    content: 'timelineItem+',
    defining: true,
    draggable: true,
    addAttributes() {
      return {
        variant: enumAttr('variant', 'variant', TIMELINE_VARIANTS, 'steps'),
        numbered: boolAttr('numbered', 'numbered', true),
        orientation: enumAttr('orientation', 'orientation', TIMELINE_ORIENTATIONS, 'vertical'),
      }
    },
    parseHTML() {
      return [
        { tag: 'ol[data-type="timeline"]', priority: 60 },
        { tag: 'ul[data-type="timeline"]', priority: 60 },
      ]
    },
    renderHTML({ node, HTMLAttributes }) {
      return [node.attrs.numbered === false ? 'ul' : 'ol', mergeAttributes(HTMLAttributes, { 'data-type': 'timeline' }), 0]
    },
    addNodeView() {
      return lhNodeView(TimelineView)
    },
  })

  const TimelineItem = Node.create({
    name: 'timelineItem',
    content: 'block+',
    defining: true,
    isolating: true,
    addAttributes() {
      return {
        title: textAttr('title', 'title'),
        label: textAttr('label', 'label'),
        icon: {
          default: null,
          parseHTML: (el: HTMLElement) => iconOf(el.getAttribute('data-icon')),
          renderHTML: (attrs: Record<string, any>) => (iconOf(attrs.icon) ? { 'data-icon': attrs.icon } : {}),
        },
        tone: {
          default: null,
          parseHTML: (el: HTMLElement) => toneOf(el.getAttribute('data-tone')),
          renderHTML: (attrs: Record<string, any>) => (toneOf(attrs.tone) ? { 'data-tone': attrs.tone } : {}),
        },
      }
    },
    parseHTML() {
      return [{ tag: 'li[data-type="timeline-item"]', priority: 60, contentElement: contentChild('data-tl-body') }]
    },
    renderHTML({ node, HTMLAttributes }) {
      const title = String(node.attrs.title || '').trim()
      const label = String(node.attrs.label || '').trim()
      const head: any[] = []
      if (label) head.push(['span', { class: 'lh-tl-label' }, label])
      if (label && title) head.push(' ')
      if (title) head.push(['strong', {}, title])
      const attrs = mergeAttributes(HTMLAttributes, { 'data-type': 'timeline-item' })
      const body = ['div', { 'data-tl-body': '' }, 0]
      return (head.length ? ['li', attrs, ['p', { class: 'lh-tl-heading' }, ...head], body] : ['li', attrs, body]) as DOMOutputSpec
    },
    addNodeView() {
      return lhNodeView(TimelineItemView)
    },
  })

  const TableOfContents = Node.create({
    name: 'tableOfContents',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return {
        title: textAttr('title', 'title'),
        maxLevel: {
          default: 3,
          parseHTML: (el: HTMLElement) => oneOf(TOC_LEVELS, Number(el.getAttribute('data-max-level')), 3),
          renderHTML: (attrs: Record<string, any>) => ({ 'data-max-level': String(oneOf(TOC_LEVELS, Number(attrs.maxLevel), 3)) }),
        },
        numbered: boolAttr('numbered', 'numbered', false),
      }
    },
    parseHTML() {
      return [{ tag: 'nav[data-type="table-of-contents"]' }]
    },
    renderHTML({ node, HTMLAttributes }) {
      const title = String(node.attrs.title || '').trim() || labels().contents
      const attrs = mergeAttributes(HTMLAttributes, { 'data-type': 'table-of-contents', 'aria-label': title })
      // With an editor (getHTML, copy) the list is computed now; a static
      // string render leaves a placeholder for hydrateTableOfContents.
      const doc = (this as any).editor?.state?.doc
      const tag = node.attrs.numbered ? 'ol' : 'ul'
      if (!doc) return ['nav', attrs, ['p', { class: 'lh-toc-title' }, title], [tag, { 'data-lh-toc-pending': '' }]]
      const entries = outlineEntries(computeHeadingIds(doc), node.attrs.maxLevel)
      const items = entries.map((e) => ['li', { 'data-depth': String(e.depth) }, ['a', { href: `#${e.id}` }, e.text]])
      return ['nav', attrs, ['p', { class: 'lh-toc-title' }, title], [tag, {}, ...items]] as DOMOutputSpec
    },
    addNodeView() {
      return lhNodeView(TocView as any)
    },
  })

  const KeyTakeaways = Node.create({
    name: 'keyTakeaways',
    group: 'block',
    content: 'block+',
    defining: true,
    draggable: true,
    addAttributes() {
      return {
        title: textAttr('title', 'title'),
        tone: {
          default: 'amber',
          parseHTML: (el: HTMLElement) => toneOf(el.getAttribute('data-tone')) ?? 'amber',
          renderHTML: (attrs: Record<string, any>) => ({ 'data-tone': toneOf(attrs.tone) ?? 'amber' }),
        },
        icon: {
          default: null,
          parseHTML: (el: HTMLElement) => iconOf(el.getAttribute('data-icon')),
          renderHTML: (attrs: Record<string, any>) => (iconOf(attrs.icon) ? { 'data-icon': attrs.icon } : {}),
        },
      }
    },
    parseHTML() {
      return [{ tag: 'aside[data-type="key-takeaways"]', contentElement: contentChild('data-kt-body') }]
    },
    renderHTML({ node, HTMLAttributes }) {
      const title = String(node.attrs.title || '').trim() || labels().keyTakeaways
      return ['aside', mergeAttributes(HTMLAttributes, { 'data-type': 'key-takeaways' }), ['p', { class: 'lh-kt-title' }, ['strong', {}, title]], ['div', { 'data-kt-body': '' }, 0]]
    },
    addNodeView() {
      return lhNodeView(KeyTakeawaysView)
    },
  })

  // Checklist: the stock task nodes (same names as in the notes editor), plus
  // a block id for the learner's ticks and an author switch.
  const Checklist = TaskList.extend({
    addOptions() {
      return { ...this.parent?.(), activityId } as any
    },
    addAttributes() {
      return {
        ...this.parent?.(),
        blockId: textAttr('blockId', 'block-id', null),
        learnerCanCheck: boolAttr('learnerCanCheck', 'learner-can-check', true),
      }
    },
    addNodeView() {
      return lhNodeView(ChecklistView)
    },
  })

  const ChecklistItem = (
    mode === 'editor'
      ? TaskItem.extend({
          addOptions() {
            return { ...this.parent?.(), activityId } as any
          },
        })
      : TaskItem.extend({
          addOptions() {
            return { ...this.parent?.(), activityId } as any
          },
          addNodeView() {
            return lhNodeView(ChecklistItemView)
          },
        })
  ).configure({ nested: false })

  const out = [Tabs, TabItem, Columns, Column, Accordion, Timeline, TimelineItem, TableOfContents, KeyTakeaways, Checklist, ChecklistItem]
  return mode === 'editor' ? [...out, LayoutBlockIds] : out
}

export const layoutBlockIdsKey = new PluginKey('lhLayoutBlockIds')
const ID_NODES = new Set(['tabs', 'taskList'])

/**
 * Gives every tabs / checklist block its own id (the learner's checklist
 * ticks are stored under it). Runs in the editor only, after local edits:
 * blocks typed with an input rule start without one, and a duplicated block
 * would otherwise share its original's id.
 */
export const LayoutBlockIds = Extension.create({
  name: 'lhLayoutBlockIds',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: layoutBlockIdsKey,
        appendTransaction(transactions, oldState, state) {
          if (!transactions.some((tr) => tr.docChanged) || transactions.some((tr) => tr.getMeta('y-sync$'))) return null
          const byId = new Map<string, number[]>()
          const fix: number[] = []
          state.doc.descendants((node, pos) => {
            if (node.isTextblock) return false
            if (!ID_NODES.has(node.type.name)) return true
            const id = node.attrs.blockId
            if (typeof id !== 'string' || !id) fix.push(pos)
            else byId.set(id, [...(byId.get(id) ?? []), pos])
            return true
          })
          // A copy shares its original's id: the block that was already there
          // (followed through this change) keeps it, the copy gets a new one.
          for (const [id, positions] of byId) {
            if (positions.length < 2) continue
            let keep = positions[0]
            oldState.doc.descendants((node, pos) => {
              if (node.isTextblock) return false
              if (ID_NODES.has(node.type.name) && node.attrs.blockId === id) {
                const mapped = transactions.reduce((at, tr) => tr.mapping.map(at), pos)
                if (positions.includes(mapped)) keep = mapped
              }
              return true
            })
            fix.push(...positions.filter((at) => at !== keep))
          }
          if (!fix.length) return null
          const tr = state.tr
          for (const pos of fix) tr.setNodeMarkup(pos, undefined, { ...state.doc.nodeAt(pos)!.attrs, blockId: newBlockId() })
          return tr.setMeta('addToHistory', false)
        },
      }),
    ]
  },
})
