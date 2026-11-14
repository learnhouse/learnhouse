/*
 Text marks added with the selection menu: superscript, subscript, text
 color, highlight (fill / marker / underline), effects (gradient, glow, wavy,
 dotted, small caps, larger sizes), keyboard key, spoiler and definition.

 Every mark renders to a plain <span>/<sup>/<sub>/<kbd> with data-* attrs and
 lh-* classes styled in blocks.css, so the learner canvas and the preview only
 need these extensions in their lists (no node views). Values are tokens from
 curated lists, never free CSS, and unknown tokens render as nothing special.
 Marks sync through Yjs like any mark; documents without them are untouched.

 Pure Tiptap (no React): imported by the editor, the learner canvas, the
 preview and the unit tests.
*/
import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const TEXT_COLORS = ['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'purple', 'pink'] as const
export const HIGHLIGHT_STYLES = ['fill', 'marker', 'underline'] as const
export const TEXT_EFFECTS = [
  'gradient-sunset',
  'gradient-ocean',
  'gradient-aurora',
  'glow',
  'wavy',
  'dotted',
  'smallcaps',
  'large',
  'xlarge',
] as const

export type TextColor = (typeof TEXT_COLORS)[number]
export type HighlightStyle = (typeof HIGHLIGHT_STYLES)[number]
export type TextEffect = (typeof TEXT_EFFECTS)[number]

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T | null = null): T | null =>
  typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lhTextMarks: {
      setTextColor: (color: TextColor) => ReturnType
      unsetTextColor: () => ReturnType
      setHighlight: (attrs: { color: TextColor; style?: HighlightStyle }) => ReturnType
      unsetHighlight: () => ReturnType
      setTextEffect: (effect: TextEffect) => ReturnType
      unsetTextEffect: () => ReturnType
      toggleSpoiler: () => ReturnType
      toggleKbd: () => ReturnType
      setDefinition: (note: string) => ReturnType
      unsetDefinition: () => ReturnType
      toggleSuperscript: () => ReturnType
      toggleSubscript: () => ReturnType
    }
  }
}

export const Superscript = Mark.create({
  name: 'superscript',
  excludes: 'subscript',
  parseHTML: () => [{ tag: 'sup' }],
  renderHTML: ({ HTMLAttributes }) => ['sup', mergeAttributes(HTMLAttributes), 0],
  addCommands() {
    return { toggleSuperscript: () => ({ commands }: any) => commands.toggleMark(this.name) } as any
  },
  addKeyboardShortcuts() {
    return { 'Mod-.': () => this.editor.commands.toggleMark(this.name) }
  },
})

export const Subscript = Mark.create({
  name: 'subscript',
  excludes: 'superscript',
  parseHTML: () => [{ tag: 'sub' }],
  renderHTML: ({ HTMLAttributes }) => ['sub', mergeAttributes(HTMLAttributes), 0],
  addCommands() {
    return { toggleSubscript: () => ({ commands }: any) => commands.toggleMark(this.name) } as any
  },
  addKeyboardShortcuts() {
    return { 'Mod-,': () => this.editor.commands.toggleMark(this.name) }
  },
})

export const TextColorMark = Mark.create({
  name: 'textColor',
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el: HTMLElement) => oneOf(TEXT_COLORS, el.getAttribute('data-text-color')),
        renderHTML: () => ({}),
      },
    }
  },
  parseHTML: () => [{ tag: 'span[data-text-color]' }],
  renderHTML({ mark, HTMLAttributes }) {
    const color = oneOf(TEXT_COLORS, mark.attrs.color)
    return ['span', mergeAttributes(HTMLAttributes, color ? { 'data-text-color': color, class: `lh-text-${color}` } : {}), 0]
  },
  addCommands() {
    return {
      setTextColor: (color: TextColor) => ({ commands }: any) => commands.setMark(this.name, { color }),
      unsetTextColor: () => ({ commands }: any) => commands.unsetMark(this.name),
    } as any
  },
})

export const HighlightMark = Mark.create({
  name: 'highlight',
  addAttributes() {
    return {
      color: {
        default: 'amber',
        parseHTML: (el: HTMLElement) => oneOf(TEXT_COLORS, el.getAttribute('data-highlight'), 'amber'),
        renderHTML: () => ({}),
      },
      style: {
        default: 'fill',
        parseHTML: (el: HTMLElement) => oneOf(HIGHLIGHT_STYLES, el.getAttribute('data-highlight-style'), 'fill'),
        renderHTML: () => ({}),
      },
    }
  },
  parseHTML: () => [{ tag: 'mark' }, { tag: 'span[data-highlight]' }],
  renderHTML({ mark, HTMLAttributes }) {
    const color = oneOf(TEXT_COLORS, mark.attrs.color, 'amber')
    const style = oneOf(HIGHLIGHT_STYLES, mark.attrs.style, 'fill')
    return [
      'mark',
      mergeAttributes(HTMLAttributes, {
        'data-highlight': color,
        'data-highlight-style': style,
        class: `lh-hl lh-hl-${style} lh-hl-${color}`,
      }),
      0,
    ]
  },
  addCommands() {
    return {
      setHighlight: (attrs: { color: TextColor; style?: HighlightStyle }) => ({ commands }: any) =>
        commands.setMark(this.name, { color: attrs.color, style: attrs.style ?? 'fill' }),
      unsetHighlight: () => ({ commands }: any) => commands.unsetMark(this.name),
    } as any
  },
})

export const TextEffectMark = Mark.create({
  name: 'textEffect',
  addAttributes() {
    return {
      effect: {
        default: null,
        parseHTML: (el: HTMLElement) => oneOf(TEXT_EFFECTS, el.getAttribute('data-effect')),
        renderHTML: () => ({}),
      },
    }
  },
  parseHTML: () => [{ tag: 'span[data-effect]' }],
  renderHTML({ mark, HTMLAttributes }) {
    const effect = oneOf(TEXT_EFFECTS, mark.attrs.effect)
    return ['span', mergeAttributes(HTMLAttributes, effect ? { 'data-effect': effect, class: `lh-fx lh-fx-${effect}` } : {}), 0]
  },
  addCommands() {
    return {
      setTextEffect: (effect: TextEffect) => ({ commands }: any) => commands.setMark(this.name, { effect }),
      unsetTextEffect: () => ({ commands }: any) => commands.unsetMark(this.name),
    } as any
  },
})

export const KbdMark = Mark.create({
  name: 'kbd',
  excludes: '_',
  code: true,
  parseHTML: () => [{ tag: 'kbd' }],
  renderHTML: ({ HTMLAttributes }) => ['kbd', mergeAttributes(HTMLAttributes, { class: 'lh-kbd' }), 0],
  addCommands() {
    return { toggleKbd: () => ({ commands }: any) => commands.toggleMark(this.name) } as any
  },
})

const spoilerKey = new PluginKey('lhSpoilerReveal')

/**
 * Spoiler: blurred until a learner clicks (or presses Enter/Space on) it.
 * Revealing is local DOM state on the reader's page, never a document change.
 * In the editor it shows as a dashed, readable box so authors can edit it.
 */
export const SpoilerMark = Mark.create({
  name: 'spoiler',
  inclusive: false,
  parseHTML: () => [{ tag: 'span[data-spoiler]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'span',
    mergeAttributes(HTMLAttributes, {
      'data-spoiler': '',
      class: 'lh-spoiler',
      tabindex: '0',
      role: 'button',
      'aria-pressed': 'false',
    }),
    0,
  ],
  addCommands() {
    return { toggleSpoiler: () => ({ commands }: any) => commands.toggleMark(this.name) } as any
  },
  addProseMirrorPlugins() {
    const reveal = (target: EventTarget | null) => {
      const el = (target as HTMLElement | null)?.closest?.('.lh-spoiler') as HTMLElement | null
      if (!el || el.closest('.activity-editor-content-wrapper')) return false
      el.classList.add('is-revealed')
      el.setAttribute('aria-pressed', 'true')
      return true
    }
    return [
      new Plugin({
        key: spoilerKey,
        props: {
          handleDOMEvents: {
            click: (_view, event) => reveal(event.target),
            keydown: (_view, event) => {
              if ((event as KeyboardEvent).key !== 'Enter' && (event as KeyboardEvent).key !== ' ') return false
              const done = reveal(event.target)
              if (done) event.preventDefault()
              return done
            },
          },
        },
      }),
    ]
  },
})

/** Glossary note: hover, focus or tap the term to read the author's note. */
export const DefinitionMark = Mark.create({
  name: 'definition',
  inclusive: false,
  addAttributes() {
    return {
      note: {
        default: '',
        parseHTML: (el: HTMLElement) => (el.getAttribute('data-note') || '').slice(0, 500),
        renderHTML: () => ({}),
      },
    }
  },
  parseHTML: () => [{ tag: 'span[data-definition]' }],
  renderHTML({ mark, HTMLAttributes }) {
    const note = String(mark.attrs.note || '').slice(0, 500)
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-definition': '',
        'data-note': note,
        'aria-label': note || undefined,
        class: 'lh-definition',
        tabindex: '0',
      }),
      0,
    ]
  },
  addCommands() {
    return {
      setDefinition: (note: string) => ({ commands }: any) => commands.setMark(this.name, { note: note.slice(0, 500) }),
      unsetDefinition: () => ({ commands }: any) => commands.unsetMark(this.name),
    } as any
  },
})

/** All the marks, in the order the editor, canvas and preview register them. */
export const TEXT_MARKS = [
  Superscript,
  Subscript,
  TextColorMark,
  HighlightMark,
  TextEffectMark,
  KbdMark,
  SpoilerMark,
  DefinitionMark,
]

export const TEXT_MARK_NAMES = TEXT_MARKS.map((m) => m.name)
