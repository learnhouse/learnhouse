import { lhNodeView } from '@components/Objects/Editor/core/nodeView'
import { mergeAttributes, Node } from '@tiptap/core'
import dynamic from 'next/dynamic'
import { blockIdAttr, jsonAttr } from '../shared/attrs'
import { exampleWordGuess } from './wordGuessModel'

const WordGuessView = dynamic(() => import('./WordGuessView'), { ssr: false })

/*
 "Word guess": learners guess a key term from its clue, with letter feedback
 after each try (in place, in the word, not in the word). Attrs are plain
 JSON (see wordGuessModel.ts) and round-trip through HTML as JSON data
 attributes, so copy/paste keeps the content and the blockId. The defaults
 are the English example; inserting from the slash menu or the gallery fills
 a translated one.
*/
const EXAMPLE = exampleWordGuess()

export default Node.create({
  name: 'expWordGuess',
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
      words: jsonAttr('words', EXAMPLE.words),
      maxGuesses: jsonAttr('maxGuesses', 6),
    }
  },

  parseHTML() {
    return [{ tag: 'exp-word-guess-block' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['exp-word-guess-block', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return lhNodeView(WordGuessView as any)
  },
})
