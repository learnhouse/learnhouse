import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { blockIdAttr, jsonAttr } from '../shared/attrs'

const GapsView = dynamic(() => import('./GapsView'), { ssr: false })

// English fallback example; inserts from the slash menu / gallery use the
// translated `defaultGapsContent(t)`.
const DEFAULT_TEXT =
  'Plants use [[sunlight|light]] to make their food. They take in [[carbon dioxide|CO2]] from the air and release [[oxygen]].'

export default Node.create({
  name: 'expGaps',
  group: 'block',
  draggable: true,
  atom: true,

  addOptions() {
    return { editable: true, activity: undefined as any }
  },

  addAttributes() {
    return {
      blockId: blockIdAttr(),
      title: jsonAttr('title', 'Photosynthesis'),
      text: jsonAttr('text', DEFAULT_TEXT),
      mode: jsonAttr('mode', 'type'),
      caseSensitive: jsonAttr('caseSensitive', false),
    }
  },

  parseHTML() {
    return [{ tag: 'exp-gaps-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['exp-gaps-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(GapsView as any)
  },
})
