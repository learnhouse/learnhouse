import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { blockIdAttr, jsonAttr } from '../shared/attrs'

const EstimateView = dynamic(() => import('./EstimateView'), { ssr: false })

/*
 Estimate (expEstimate): guess a number on a slider, then see the answer.
 See estimateModel and EXPERIENCES_SPEC.md section 10.
*/
export default Node.create({
  name: 'expEstimate',
  group: 'block',
  draggable: true,
  atom: true,

  addOptions() {
    return { editable: true, activity: undefined as any }
  },

  addAttributes() {
    return {
      blockId: blockIdAttr(),
      question: jsonAttr('question', ''),
      min: jsonAttr('min', 0),
      max: jsonAttr('max', 100),
      step: jsonAttr('step', 1),
      answer: jsonAttr('answer', 50),
      unit: jsonAttr('unit', ''),
      tolerancePct: jsonAttr('tolerancePct', 10),
      explanation: jsonAttr('explanation', ''),
    }
  },

  parseHTML() {
    return [{ tag: 'exp-estimate-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['exp-estimate-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(EstimateView as any)
  },
})
