import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'
import tippy, { Instance as TippyInstance } from 'tippy.js'
import { Z_INDEX } from '@/lib/z-index'
import { normalizeForSearch, searchMatchesAny } from '@/lib/search/normalize'
import { VARIABLES, VariableDef } from './dynamicRules'
import VariableSuggestionList, { VariableSuggestionListRef } from './VariableSuggestionList'

const variableSuggestionKey = new PluginKey('variableSuggestion')

export function filterVariables(query: string): VariableDef[] {
  const q = query.replace(/\}+$/, '').trim()
  if (!q) return VARIABLES
  return VARIABLES.filter(
    (v) => searchMatchesAny([v.label, v.path], q) || normalizeForSearch(v.path).includes(normalizeForSearch(q))
  )
}

// Typing "{{" opens a menu of variables; picking one inserts the chip.
const VariableSuggestion = Extension.create({
  name: 'variableSuggestion',

  addProseMirrorPlugins() {
    return [
      Suggestion<VariableDef>({
        editor: this.editor,
        char: '{{',
        startOfLine: false,
        pluginKey: variableSuggestionKey,
        allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== 'codeBlock',
        items: ({ query }) => filterVariables(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).insertDynamicVariable(props.path).run()
        },
        render: () => {
          let component: ReactRenderer<VariableSuggestionListRef> | null = null
          let popup: TippyInstance[] | null = null
          return {
            onStart: (props) => {
              component = new ReactRenderer(VariableSuggestionList, {
                props: { items: props.items, command: props.command },
                editor: props.editor,
              })
              if (!props.clientRect) return
              popup = tippy('body', {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
                // The slash menu's theme: no tooltip frame around the list.
                theme: 'slash-commands',
                zIndex: Z_INDEX.EDITOR_BUBBLE,
              })
            },
            onUpdate: (props) => {
              component?.updateProps({ items: props.items, command: props.command })
              if (props.clientRect) popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect })
            },
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') {
                popup?.[0]?.hide()
                return true
              }
              return component?.ref?.onKeyDown(props.event) ?? false
            },
            onExit: () => {
              popup?.[0]?.destroy()
              component?.destroy()
            },
          }
        },
      }),
    ]
  },
})

export default VariableSuggestion
