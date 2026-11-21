import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { blockIdAttr, jsonAttr } from '../shared/attrs'
import { exampleSequence } from './sequenceModel'

const SequenceView = dynamic(() => import('./SequenceView'), { ssr: false })

/*
 "Sequence": learners put steps or events in order. `items` are stored in the
 CORRECT order (see sequenceModel.ts). Attrs round-trip through HTML as JSON
 data attributes; the defaults are the English example.
*/
const EXAMPLE = exampleSequence()

export default Node.create({
  name: 'expSequence',
  group: 'block',
  draggable: true,
  atom: true,

  addOptions() {
    return { editable: true, activity: undefined as any }
  },

  addAttributes() {
    return {
      blockId: blockIdAttr(),
      title: jsonAttr('title', EXAMPLE.title),
      instructions: jsonAttr('instructions', EXAMPLE.instructions),
      items: jsonAttr('items', EXAMPLE.items),
      variant: jsonAttr('variant', 'list'),
    }
  },

  parseHTML() {
    return [{ tag: 'exp-sequence-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['exp-sequence-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(SequenceView as any)
  },
})
