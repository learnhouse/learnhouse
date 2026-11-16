/*
 Divider styles: an optional `variant` attr on the existing horizontalRule
 node (line, dashed, dotted, thick, dots, space). No variant = the original
 line, so every stored divider looks the same as before.

 When a divider is selected in the editor, a small floating picker appears
 above it. The attr is rendered as data-variant and styled in blocks.css, so
 the learner view needs nothing but this extension in its list.
*/
import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import i18n from '@/lib/i18n'
import { DIVIDER_EXTRA_ATTRS, DIVIDER_VARIANTS, dividerVariantOf } from '../schema/blockAttrs'
import '../blocks.css'

const LABELS: Record<string, [string, string]> = {
  line: ['editor.blocks_v2.divider.line', 'Line'],
  dashed: ['editor.blocks_v2.divider.dashed', 'Dashed'],
  dotted: ['editor.blocks_v2.divider.dotted', 'Dotted'],
  thick: ['editor.blocks_v2.divider.thick', 'Thick'],
  dots: ['editor.blocks_v2.divider.dots', 'Dots'],
  space: ['editor.blocks_v2.divider.space', 'Space'],
}

const PREVIEW: Record<string, string> = {
  line: '<span style="display:block;width:22px;border-top:1.5px solid currentColor"></span>',
  dashed: '<span style="display:block;width:22px;border-top:1.5px dashed currentColor"></span>',
  dotted: '<span style="display:block;width:22px;border-top:2px dotted currentColor"></span>',
  thick: '<span style="display:block;width:22px;border-top:3.5px solid currentColor;border-radius:9px"></span>',
  dots: '<span style="font-size:11px;letter-spacing:2px;line-height:1">•••</span>',
  space: '<span style="display:block;width:22px;height:8px;border:1px dashed currentColor;border-radius:3px;opacity:.6"></span>',
}

const pickerKey = new PluginKey('lhDividerPicker')

function dividerPicker() {
  return new Plugin({
    key: pickerKey,
    view(view: EditorView) {
      const bar = document.createElement('div')
      bar.className = 'lh-divider-picker'
      bar.setAttribute('role', 'toolbar')
      Object.assign(bar.style, {
        position: 'fixed', zIndex: '150', display: 'none', gap: '2px', padding: '2px', borderRadius: '10px',
        background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.06), 0 0 0 1px rgba(0,0,0,.08)',
      } as CSSStyleDeclaration)
      document.body.appendChild(bar)

      const render = (current: string) => {
        bar.replaceChildren(
          ...DIVIDER_VARIANTS.map((variant) => {
            const b = document.createElement('button')
            b.type = 'button'
            const [key, fallback] = LABELS[variant]
            const label = i18n.t(key, fallback)
            b.title = label
            b.setAttribute('aria-label', label)
            b.setAttribute('aria-pressed', String(variant === current))
            b.innerHTML = PREVIEW[variant]
            Object.assign(b.style, {
              width: '30px', height: '28px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '8px', cursor: 'pointer', color: variant === current ? '#fff' : '#525252',
              background: variant === current ? '#171717' : 'transparent',
            } as CSSStyleDeclaration)
            b.addEventListener('mousedown', (e) => e.preventDefault())
            b.addEventListener('click', () => {
              const sel = view.state.selection
              if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'horizontalRule') return
              const tr = view.state.tr.setNodeMarkup(sel.from, undefined, {
                ...sel.node.attrs,
                variant: variant === 'line' ? null : variant,
              })
              tr.setSelection(NodeSelection.create(tr.doc, sel.from))
              view.dispatch(tr)
            })
            return b
          }),
        )
      }

      const update = () => {
        const sel = view.state.selection
        // The learner canvas is technically editable (for selection), so only
        // offer the picker inside the activity editor.
        const inEditor = !!view.dom.closest('.activity-editor-content-wrapper')
        if (!inEditor || !view.editable || !(sel instanceof NodeSelection) || sel.node.type.name !== 'horizontalRule') {
          bar.style.display = 'none'
          return
        }
        const dom = view.nodeDOM(sel.from) as HTMLElement | null
        if (!dom) return
        render(dividerVariantOf(sel.node.attrs))
        const rect = dom.getBoundingClientRect()
        bar.style.display = 'flex'
        const width = bar.offsetWidth || 200
        bar.style.top = `${Math.max(8, rect.top - 40)}px`
        bar.style.left = `${rect.left + rect.width / 2 - width / 2}px`
      }
      update()
      const onScroll = () => update()
      window.addEventListener('scroll', onScroll, true)
      return {
        update,
        destroy() {
          window.removeEventListener('scroll', onScroll, true)
          bar.remove()
        },
      }
    },
  })
}

export const DividerStyle = Extension.create({
  name: 'lhDividerStyle',

  addGlobalAttributes() {
    return [
      {
        types: ['horizontalRule'],
        attributes: DIVIDER_EXTRA_ATTRS,
      },
    ]
  },

  addProseMirrorPlugins() {
    return [dividerPicker()]
  },
})

export default DividerStyle
