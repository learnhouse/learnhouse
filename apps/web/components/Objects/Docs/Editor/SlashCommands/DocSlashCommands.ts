import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import tippy, { Instance as TippyInstance } from 'tippy.js'
import { filterDocCommands } from './docSlashCommandsConfig'
import DocSlashCommandsList from './DocSlashCommandsList'
import { DocSlashCommandItem, DocSlashCommandsListRef } from './types'
import { PluginKey } from '@tiptap/pm/state'
import { Z_INDEX } from '@/lib/z-index'

const docSlashCommandsPluginKey = new PluginKey('docSlashCommands')

export const DocSlashCommands = Extension.create({
  name: 'docSlashCommands',

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        pluginKey: docSlashCommandsPluginKey,
        command: ({
          editor,
          range,
          props,
        }: {
          editor: any
          range: any
          props: DocSlashCommandItem
        }) => {
          editor.chain().focus().deleteRange(range).run()
          props.command(editor)
        },
        allow: ({ state, range }: { state: any; range: any }) => {
          const $from = state.doc.resolve(range.from)
          const isInCodeBlock = $from.parent.type.name === 'codeBlock'
          return !isInCodeBlock
        },
        items: ({ query }: { query: string }) => {
          return filterDocCommands(query)
        },
        render: () => {
          let component: ReactRenderer<DocSlashCommandsListRef> | null = null
          let popup: TippyInstance[] | null = null

          return {
            onStart: (props: any) => {
              component = new ReactRenderer(DocSlashCommandsList, {
                props: {
                  items: props.items,
                  command: (item: DocSlashCommandItem) => {
                    props.command(item)
                  },
                  editor: props.editor,
                },
                editor: props.editor,
              })

              if (!props.clientRect) {
                return
              }

              popup = tippy('body', {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
                animation: 'shift-away',
                maxWidth: 'none',
                theme: 'slash-commands',
                zIndex: Z_INDEX.EDITOR_BUBBLE,
              })
            },

            onUpdate: (props: any) => {
              component?.updateProps({
                items: props.items,
                command: (item: DocSlashCommandItem) => {
                  props.command(item)
                },
                editor: props.editor,
              })

              if (!props.clientRect) {
                return
              }

              popup?.[0]?.setProps({
                getReferenceClientRect: props.clientRect,
              })
            },

            onKeyDown: (props: any) => {
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

export default DocSlashCommands
