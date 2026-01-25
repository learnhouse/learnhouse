import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import tippy, { Instance as TippyInstance } from 'tippy.js'
import { filterCommands } from './slashCommandsConfig'
import SlashCommandsList from './SlashCommandsList'
import { SlashCommandItem, SlashCommandsListRef } from './types'
import { PluginKey } from '@tiptap/pm/state'

const slashCommandsPluginKey = new PluginKey('slashCommands')

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        pluginKey: slashCommandsPluginKey,
        command: ({ editor, range, props }: { editor: any; range: any; props: SlashCommandItem }) => {
          // Delete the "/" trigger and any typed query
          editor.chain().focus().deleteRange(range).run()
          // Execute the command
          props.command(editor)
        },
        allow: ({ state, range }: { state: any; range: any }) => {
          const $from = state.doc.resolve(range.from)
          const isInCodeBlock = $from.parent.type.name === 'codeBlock'

          // Don't show in code blocks
          return !isInCodeBlock
        },
        items: ({ query }: { query: string }) => {
          return filterCommands(query)
        },
        render: () => {
          let component: ReactRenderer<SlashCommandsListRef> | null = null
          let popup: TippyInstance[] | null = null

          return {
            onStart: (props: any) => {
              component = new ReactRenderer(SlashCommandsList, {
                props: {
                  items: props.items,
                  command: (item: SlashCommandItem) => {
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
                zIndex: 9999,
              })
            },

            onUpdate: (props: any) => {
              component?.updateProps({
                items: props.items,
                command: (item: SlashCommandItem) => {
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
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})

export default SlashCommands
