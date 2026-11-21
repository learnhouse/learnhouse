import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { blockIdAttr, jsonAttr } from '../shared/attrs'
import { DEFAULT_LABELS } from './mythFactModel'

const MythFactView = dynamic(() => import('./MythFactView'), { ssr: false })

/*
 Myth or fact (expMythFact): a swipeable true/false deck. Attrs are plain
 JSON; see mythFactModel for the shape and EXPERIENCES_SPEC.md section 8.
*/
export default Node.create({
  name: 'expMythFact',
  group: 'block',
  draggable: true,
  atom: true,

  addOptions() {
    return { editable: true, activity: undefined as any }
  },

  addAttributes() {
    return {
      blockId: blockIdAttr(),
      title: jsonAttr('title', ''),
      statements: jsonAttr('statements', []),
      labels: jsonAttr('labels', { ...DEFAULT_LABELS }),
    }
  },

  parseHTML() {
    return [{ tag: 'exp-myth-fact-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['exp-myth-fact-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(MythFactView as any)
  },
})
