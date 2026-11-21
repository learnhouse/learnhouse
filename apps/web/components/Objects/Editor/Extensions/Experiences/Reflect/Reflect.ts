import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { blockIdAttr, jsonAttr } from '../shared/attrs'
import { exampleReflect } from './reflectModel'

const ReflectView = dynamic(() => import('./ReflectView'), { ssr: false })

/*
 "Reflection": learners write in their own words, then compare with a model
 answer and tick the key points they covered. Attrs are plain JSON (see
 reflectModel.ts) and round-trip through HTML as JSON data attributes. The
 learner's draft stays on their device (never in the document).
*/
const EXAMPLE = exampleReflect()

export default Node.create({
  name: 'expReflect',
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
      prompt: jsonAttr('prompt', EXAMPLE.prompt),
      guidingQuestions: jsonAttr('guidingQuestions', EXAMPLE.guidingQuestions),
      minWords: jsonAttr('minWords', EXAMPLE.minWords),
      modelAnswer: jsonAttr('modelAnswer', EXAMPLE.modelAnswer),
      checklist: jsonAttr('checklist', EXAMPLE.checklist),
    }
  },

  parseHTML() {
    return [{ tag: 'exp-reflect-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['exp-reflect-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(ReflectView as any)
  },
})
