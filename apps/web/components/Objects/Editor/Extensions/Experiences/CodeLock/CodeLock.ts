import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { blockIdAttr, jsonAttr } from '../shared/attrs'

const CodeLockView = dynamic(() => import('./CodeLockView'), { ssr: false })

/*
 Code lock (expCodeLock): clues fill the dials of a padlock; the reward shows
 when it opens. Answers stay in these attrs only. See codeLockModel and
 EXPERIENCES_SPEC.md section 12.
*/
export default Node.create({
  name: 'expCodeLock',
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
      story: jsonAttr('story', ''),
      clues: jsonAttr('clues', []),
      reward: jsonAttr('reward', ''),
    }
  },

  parseHTML() {
    return [{ tag: 'exp-code-lock-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['exp-code-lock-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(CodeLockView as any)
  },
})
