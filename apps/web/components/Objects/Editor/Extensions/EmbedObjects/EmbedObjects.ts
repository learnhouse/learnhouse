import { mergeAttributes, Node } from '@tiptap/core'
import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import dynamic from 'next/dynamic'
import { EMBED_EXTRA_ATTRS } from '../../Blocks/schema/blockAttrs'

const EmbedObjectsComponent = dynamic(() => import('./EmbedObjectsComponent'), {
  ssr: false,
})


export default Node.create({
  name: 'blockEmbed',
  group: 'block',
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      embedUrl: {
        default: null,
      },
      embedCode: {
        default: null,
      },
      embedType: {
        default: null,
      },
      embedHeight: {
        default: 300,
      },
      embedAspectRatio: {
        default: null,
      },
      embedWidth: {
        default: '100%',
      },
      alignment: {
        default: 'left',
      },
      // Added by the blocks redesign; optional, defaults keep old content as-is.
      ...EMBED_EXTRA_ATTRS,
    }
  },

  parseHTML() {
    return [
      {
        tag: 'block-embed',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['block-embed', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(EmbedObjectsComponent as any)
  },
  
})