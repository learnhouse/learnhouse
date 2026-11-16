import { NodeViewWrapper } from '@tiptap/react'
import React from 'react'
import dynamic from 'next/dynamic'
import EditorBlockFrame from '../../Blocks/ui/EditorBlockFrame'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { compactSettings, normalizeQuestions, normalizeSettings, type QuizQuestion, type QuizSettings } from './quizModel'
import { QuizEditor } from './QuizEditor'
import { QuizPlayer } from './QuizPlayer'

const AIQuizGeneratorModal = dynamic(() => import('@components/Objects/AI/AIQuizGeneratorModal'), { ssr: false })

/*
 Quiz block (blockQuiz). Authors get the inline editor (QuizEditor), learners
 the self-check (QuizPlayer), both in the block's original look.

 Every stored value is read from node attrs on each render (no local copy),
 so undo, redo and collaborators' edits show up at once. Writes go through
 `commit`, which applies the change to the LATEST stored questions.
*/

// Opening a modal can remount every React node view (see NOTES.md, [blocks]),
// which would drop a local "AI dialog open" flag and close the dialog at once.
// The flag lives outside the component, keyed by the block's quizId/position.
const aiOpen = new Set<string>()
const aiListeners = new Set<() => void>()
const setAiOpen = (key: string, open: boolean) => {
  if (open) aiOpen.add(key)
  else aiOpen.delete(key)
  aiListeners.forEach((l) => l())
}
function useAiOpen(key: string) {
  return React.useSyncExternalStore(
    (l) => {
      aiListeners.add(l)
      return () => aiListeners.delete(l)
    },
    () => aiOpen.has(key),
    () => false,
  )
}

function QuizBlockComponent(props: any) {
  const editorState = useEditorProvider() as any
  const isEditable = !!editorState?.isEditable
  const activityUuid = props.extension?.options?.activity?.activity_uuid

  const rawQuestions = props.node.attrs.questions
  const rawSettings = props.node.attrs.settings
  const questions = React.useMemo(() => normalizeQuestions(rawQuestions), [rawQuestions])
  const settings = React.useMemo(() => normalizeSettings(rawSettings), [rawSettings])

  // The node as it is in the document NOW. React may not have re-rendered
  // between two quick commits (a blur followed by a click), so props.node can
  // be one edit behind; building on it would drop the first edit.
  const liveNode = () => {
    const pos = typeof props.getPos === 'function' ? props.getPos() : null
    const node = typeof pos === 'number' ? props.editor.state.doc.nodeAt(pos) : null
    return node?.type.name === 'blockQuiz' ? node : props.node
  }

  const commit = (fn: (_qs: QuizQuestion[]) => QuizQuestion[]) => {
    const current = normalizeQuestions(liveNode().attrs.questions)
    const next = fn(current)
    if (JSON.stringify(next) === JSON.stringify(current)) return
    props.updateAttributes({ questions: next })
  }

  const commitSettings = (next: QuizSettings) => props.updateAttributes({ settings: compactSettings(next) })

  const pos = typeof props.getPos === 'function' ? props.getPos() : null
  const aiKey = `${props.node.attrs.quizId || 'quiz'}@${pos ?? ''}`
  const showAI = useAiOpen(aiKey)

  const applyGeneratedQuiz = (quiz: { quizId: string; questions: QuizQuestion[] }) => {
    // Append the generated questions to whatever is already in the block.
    const node = liveNode()
    const current = normalizeQuestions(node.attrs.questions)
    props.updateAttributes({
      quizId: node.attrs.quizId || quiz.quizId,
      questions: [...current, ...normalizeQuestions(quiz.questions)],
    })
  }

  return (
    <NodeViewWrapper className="block-quiz">
      <EditorBlockFrame
        editable={isEditable}
        node={props.node}
        editor={props.editor}
        getPos={props.getPos}
        selected={props.selected}
        tone="interactive"
      >
        {isEditable ? (
          <QuizEditor
            questions={questions}
            settings={settings}
            commit={commit}
            commitSettings={commitSettings}
            onGenerate={() => setAiOpen(aiKey, true)}
          />
        ) : (
          <QuizPlayer questions={questions} settings={settings} />
        )}
        {isEditable && showAI && (
          <AIQuizGeneratorModal
            isOpen={showAI}
            onClose={() => setAiOpen(aiKey, false)}
            onInsert={applyGeneratedQuiz}
            activityUuid={activityUuid}
          />
        )}
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

export default QuizBlockComponent
