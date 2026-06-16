'use client'

import { NodeViewWrapper } from '@tiptap/react'

interface QuizQuestion {
  question?: string
  options?: { text?: string; correct?: boolean }[]
  type?: string
}

/**
 * Read-only quiz preview: lists the questions and options so a reader sees
 * the structure, but doesn't score answers. Interactive submission lives in
 * the LearnHouse app itself.
 */
export default function QuizBlockComponent(props: any) {
  const questions: QuizQuestion[] = props.node.attrs.questions ?? []
  if (questions.length === 0) {
    return (
      <NodeViewWrapper className="block-quiz w-full">
        <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-500">
          Empty quiz.
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="block-quiz w-full">
      <div className="rounded-xl bg-gray-50 px-5 py-4 my-4">
        <div className="text-xs uppercase tracking-wider text-gray-400 mb-3">Quiz</div>
        <ol className="space-y-4 list-decimal pl-5">
          {questions.map((q, i) => (
            <li key={i} className="text-sm text-gray-800">
              <p className="font-medium mb-2">{q.question ?? 'Question'}</p>
              {q.options && q.options.length > 0 && (
                <ul className="space-y-1.5">
                  {q.options.map((opt, j) => (
                    <li key={j} className="flex items-start gap-2 text-gray-600">
                      <span className="inline-block w-4 h-4 rounded-full border border-gray-300 mt-0.5 shrink-0" />
                      <span>{opt.text ?? ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </div>
    </NodeViewWrapper>
  )
}
