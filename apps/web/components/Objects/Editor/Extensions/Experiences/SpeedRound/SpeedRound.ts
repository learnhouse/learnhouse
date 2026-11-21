import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { blockIdAttr, jsonAttr } from '../shared/attrs'

const SpeedRoundView = dynamic(() => import('./SpeedRoundView'), { ssr: false })

/*
 Speed round (expSpeedRound): timed multiple choice with lives and combos.
 See speedRoundModel and EXPERIENCES_SPEC.md section 9.
*/
export default Node.create({
  name: 'expSpeedRound',
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
      questions: jsonAttr('questions', []),
      secondsPerQuestion: jsonAttr('secondsPerQuestion', 10),
      lives: jsonAttr('lives', 3),
    }
  },

  parseHTML() {
    return [{ tag: 'exp-speed-round-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['exp-speed-round-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(SpeedRoundView as any)
  },
})
