import { Extension, Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import tippy, { Instance as TippyInstance } from 'tippy.js'
import React from 'react'
import { Z_INDEX } from '@/lib/z-index'
import CommunityTagChip from './CommunityTagChip'
import CommunityTagList, { CommunityTagListRef } from './CommunityTagList'
import { TaggableCommunity, filterCommunities } from './communityTags'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    communityTag: {
      insertCommunityTag: (community: TaggableCommunity) => ReturnType
    }
  }
}

function CommunityTagView({ node }: { node: any }) {
  return React.createElement(
    NodeViewWrapper,
    { as: 'span' },
    React.createElement(CommunityTagChip, { communityUuid: node.attrs.communityUuid, name: node.attrs.name })
  )
}

// "#Community" inside text. Stores the community's uuid and name; readers
// hover it to read and join the community's discussions in place.
export const CommunityTag = Node.create({
  name: 'communityTag',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      communityUuid: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-community'),
        renderHTML: (attrs) => ({ 'data-community': attrs.communityUuid }),
      },
      name: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-name') || '',
        renderHTML: (attrs) => ({ 'data-name': attrs.name }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'community-tag' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['community-tag', mergeAttributes(HTMLAttributes), `#${node.attrs.name}`]
  },

  renderText({ node }) {
    return `#${node.attrs.name}`
  },

  addCommands() {
    return {
      insertCommunityTag:
        (community) =>
        ({ commands }) =>
          commands.insertContent([
            { type: this.name, attrs: { communityUuid: community.community_uuid, name: community.name } },
            { type: 'text', text: ' ' },
          ]),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(CommunityTagView)
  },
})

const communityTagSuggestionKey = new PluginKey('communityTagSuggestion')

// Typing "#" opens the org's communities; picking one inserts its tag.
// `communities` is kept current by whoever hosts the editor.
export const CommunityTagSuggestion = Extension.create({
  name: 'communityTagSuggestion',

  addStorage() {
    return { communities: [] as TaggableCommunity[] }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<TaggableCommunity>({
        editor: this.editor,
        char: '#',
        startOfLine: false,
        pluginKey: communityTagSuggestionKey,
        // Not in code, and not "# " at the start of a line (a heading).
        allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== 'codeBlock',
        items: ({ query }) => filterCommunities(query, this.storage.communities),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).insertCommunityTag(props).run()
        },
        render: () => {
          let component: ReactRenderer<CommunityTagListRef> | null = null
          let popup: TippyInstance[] | null = null
          return {
            onStart: (props) => {
              component = new ReactRenderer(CommunityTagList, {
                props: { items: props.items, command: props.command },
                editor: props.editor,
              })
              // Nothing to suggest: stay out of the way of headings and prose.
              if (!props.clientRect || !props.items.length) return
              popup = tippy('body', {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
                theme: 'slash-commands',
                zIndex: Z_INDEX.EDITOR_BUBBLE,
              })
            },
            onUpdate: (props) => {
              component?.updateProps({ items: props.items, command: props.command })
              if (!props.items.length) {
                popup?.[0]?.hide()
                return
              }
              if (!popup && props.clientRect && component) {
                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                  theme: 'slash-commands',
                  zIndex: Z_INDEX.EDITOR_BUBBLE,
                })
                return
              }
              popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect })
              popup?.[0]?.show()
            },
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') {
                popup?.[0]?.hide()
                return true
              }
              if (!popup?.[0]?.state.isVisible) return false
              return component?.ref?.onKeyDown(props.event) ?? false
            },
            onExit: () => {
              popup?.[0]?.destroy()
              popup = null
              component?.destroy()
            },
          }
        },
      }),
    ]
  },
})
