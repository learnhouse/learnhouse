import { NodeViewWrapper } from '@tiptap/react'
import { v4 as uuidv4 } from 'uuid'
import { cn } from '@/lib/utils'
import React from 'react'
import {
  Question,
  Check,
  CheckCircle,
  Plus,
  ArrowCounterClockwise,
  Trash,
  X,
} from '@phosphor-icons/react'
import dynamic from 'next/dynamic'
const ReactConfetti = dynamic(() => import('react-confetti'), { ssr: false })
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useTranslation } from 'react-i18next'

interface Answer {
  answer_id: string
  answer: string
  correct: boolean
}
interface Question {
  question_id: string
  question: string
  type: 'multiple_choice' | 'custom_answer'
  answers: Answer[]
}

function QuizBlockComponent(props: any) {
  const { t } = useTranslation()
  const [questions, setQuestions] = React.useState(
    props.node.attrs.questions
  ) as [Question[], any]
  const [userAnswers, setUserAnswers] = React.useState([]) as [any[], any]
  const [submitted, setSubmitted] = React.useState(false) as [boolean, any]
  const [submissionMessage, setSubmissionMessage] = React.useState('') as [
    string,
    any,
  ]
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable

  const handleAnswerClick = (question_id: string, answer_id: string) => {
    if (isEditable || submitted) return

    const existingAnswerIndex = userAnswers.findIndex(
      (answer: any) =>
        answer.question_id === question_id && answer.answer_id === answer_id
    )

    if (existingAnswerIndex !== -1) {
      setUserAnswers(
        userAnswers.filter((_, index) => index !== existingAnswerIndex)
      )
    } else {
      setUserAnswers([...userAnswers, { question_id, answer_id }])
    }
  }

  const refreshUserSubmission = () => {
    setUserAnswers([])
    setSubmitted(false)
    setSubmissionMessage('')
  }

  const handleUserSubmission = () => {
    setSubmitted(true)

    const correctAnswers = questions.every((question: Question) => {
      const correctAnswers = question.answers.filter(
        (answer: Answer) => answer.correct
      )
      const userAnswersForQuestion = userAnswers.filter(
        (userAnswer: any) => userAnswer.question_id === question.question_id
      )

      if (correctAnswers.length === 0 && userAnswersForQuestion.length === 0) {
        return true
      }

      return (
        correctAnswers.length === userAnswersForQuestion.length &&
        correctAnswers.every((correctAnswer: Answer) =>
          userAnswersForQuestion.some(
            (userAnswer: any) =>
              userAnswer.answer_id === correctAnswer.answer_id
          )
        )
      )
    })

    setSubmissionMessage(correctAnswers ? 'correct' : 'incorrect')
  }

  const getAnswerLetter = (answerIndex: number) => {
    const alphabet = Array.from({ length: 26 }, (_, i) =>
      String.fromCharCode('A'.charCodeAt(0) + i)
    )
    return alphabet[answerIndex] ?? '?'
  }

  const saveQuestions = (newQuestions: Question[]) => {
    props.updateAttributes({ questions: newQuestions })
    setQuestions(newQuestions)
  }

  const addSampleQuestion = () => {
    const newQuestion: Question = {
      question_id: uuidv4(),
      question: '',
      type: 'multiple_choice',
      answers: [{ answer_id: uuidv4(), answer: '', correct: false }],
    }
    saveQuestions([...questions, newQuestion])
  }

  const addAnswer = (question_id: string) => {
    const question: any = questions.find(
      (q: Question) => q.question_id === question_id
    )
    if (!question || question.answers.length >= 5) return

    const newAnswer: Answer = {
      answer_id: uuidv4(),
      answer: '',
      correct: false,
    }

    const newQuestions = questions.map((q: Question) =>
      q.question_id === question_id
        ? { ...q, answers: [...q.answers, newAnswer] }
        : q
    )

    saveQuestions(newQuestions)
  }

  const changeAnswerValue = (
    question_id: string,
    answer_id: string,
    value: string
  ) => {
    const newQuestions = questions.map((question: Question) =>
      question.question_id === question_id
        ? {
            ...question,
            answers: question.answers.map((answer: Answer) =>
              answer.answer_id === answer_id
                ? { ...answer, answer: value }
                : answer
            ),
          }
        : question
    )
    saveQuestions(newQuestions)
  }

  const changeQuestionValue = (question_id: string, value: string) => {
    const newQuestions = questions.map((question: Question) =>
      question.question_id === question_id
        ? { ...question, question: value }
        : question
    )
    saveQuestions(newQuestions)
  }

  const deleteQuestion = (question_id: string) => {
    saveQuestions(
      questions.filter((q: Question) => q.question_id !== question_id)
    )
  }

  const deleteAnswer = (question_id: string, answer_id: string) => {
    const newQuestions = questions.map((question: Question) =>
      question.question_id === question_id
        ? {
            ...question,
            answers: question.answers.filter(
              (answer: Answer) => answer.answer_id !== answer_id
            ),
          }
        : question
    )
    saveQuestions(newQuestions)
  }

  const markAnswerCorrect = (question_id: string, answer_id: string) => {
    const newQuestions = questions.map((question: Question) =>
      question.question_id === question_id
        ? {
            ...question,
            answers: question.answers.map((answer: Answer) => ({
              ...answer,
              correct:
                answer.answer_id === answer_id
                  ? !answer.correct
                  : answer.correct,
            })),
          }
        : question
    )
    saveQuestions(newQuestions)
  }

  const totalQuestions = questions.length
  const hasAnyAnswer = userAnswers.length > 0

  return (
    <NodeViewWrapper className="block-quiz">
      <div className="bg-neutral-50 rounded-xl px-4 py-3 nice-shadow transition-all ease-linear">
        {submitted && submissionMessage === 'correct' && (
          <ReactConfetti
            numberOfPieces={1400}
            recycle={false}
            className="w-full h-screen"
          />
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Question weight="duotone" className="text-neutral-400" size={15} />
            <span className="uppercase tracking-widest text-[11px] font-bold text-neutral-400">
              {t('editor.blocks.quiz')}
            </span>
          </div>

          {isEditable ? (
            <button
              onClick={addSampleQuestion}
              className="flex items-center gap-1 bg-neutral-200 hover:bg-neutral-300 text-neutral-700 text-xs font-medium px-2.5 py-1 rounded-md transition-colors outline-none"
            >
              <Plus weight="duotone" size={12} />
              {t('editor.blocks.quiz_block.add_question')}
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={refreshUserSubmission}
                disabled={!hasAnyAnswer && !submitted}
                className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-400 disabled:cursor-not-allowed outline-none"
                title={t('editor.blocks.quiz_block.reset_answers')}
              >
                <ArrowCounterClockwise weight="duotone" size={13} />
              </button>
              <button
                onClick={handleUserSubmission}
                disabled={submitted || !hasAnyAnswer || totalQuestions === 0}
                className={cn(
                  'text-xs font-medium px-2.5 py-1 rounded-md transition-colors outline-none',
                  submitted || !hasAnyAnswer || totalQuestions === 0
                    ? 'bg-neutral-200/60 text-neutral-400 cursor-not-allowed'
                    : 'bg-neutral-700 hover:bg-neutral-800 text-white'
                )}
              >
                {t('editor.blocks.quiz_block.submit')}
              </button>
            </div>
          )}
        </div>

        {/* Empty state */}
        {totalQuestions === 0 && (
          <div className="bg-white rounded-lg nice-shadow flex items-center justify-center gap-2 py-6">
            <Question weight="duotone" className="text-neutral-300" size={20} />
            <p className="text-xs text-neutral-500">
              {isEditable
                ? t('editor.blocks.quiz_block.empty_editable', {
                    defaultValue:
                      'No questions yet. Add your first one to get started.',
                  })
                : t('editor.blocks.quiz_block.empty_readonly', {
                    defaultValue: 'This quiz has no questions yet.',
                  })}
            </p>
          </div>
        )}

        {/* Questions */}
        {totalQuestions > 0 && (
          <div className="space-y-3">
            {questions.map((question: Question, qIndex: number) => (
              <div key={question.question_id}>
                {/* Question header */}
                <div className="flex items-start justify-between gap-2 mb-1.5 px-1">
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-400 mb-0.5">
                      {t('editor.blocks.quiz_block.question_label', {
                        defaultValue: 'Question',
                      })}{' '}
                      {qIndex + 1}
                    </div>
                    {isEditable ? (
                      <input
                        value={question.question}
                        placeholder={t(
                          'editor.blocks.quiz_block.question_placeholder'
                        )}
                        onChange={(e) =>
                          changeQuestionValue(
                            question.question_id,
                            e.target.value
                          )
                        }
                        className="w-full text-neutral-800 bg-transparent text-sm font-semibold outline-none placeholder:text-neutral-300"
                      />
                    ) : (
                      <p className="text-neutral-800 text-sm font-semibold break-words leading-snug">
                        {question.question || (
                          <span className="text-neutral-300 italic font-normal">
                            {t(
                              'editor.blocks.quiz_block.question_placeholder'
                            )}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  {isEditable && (
                    <button
                      onClick={() => deleteQuestion(question.question_id)}
                      className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-neutral-400 hover:text-red-500 hover:bg-red-50 transition-colors outline-none"
                      title={t('editor.blocks.quiz_block.delete_question', {
                        defaultValue: 'Delete question',
                      })}
                    >
                      <Trash weight="duotone" size={12} />
                    </button>
                  )}
                </div>

                {/* Answers */}
                <div className="space-y-1">
                  {question.answers.map((answer: Answer, aIndex: number) => {
                    const isSelected = userAnswers.some(
                      (userAnswer: any) =>
                        userAnswer.question_id === question.question_id &&
                        userAnswer.answer_id === answer.answer_id
                    )
                    const isMarkedCorrect = answer.correct
                    const isCorrectReveal = submitted && isMarkedCorrect
                    const isWrongSelection =
                      submitted && isSelected && !isMarkedCorrect
                    const letter = getAnswerLetter(aIndex)

                    const row = cn(
                      'group flex items-center gap-2 rounded-lg nice-shadow px-2 py-1.5 transition-colors',
                      // Take mode — default
                      !isEditable &&
                        !submitted &&
                        !isSelected &&
                        'bg-white hover:bg-neutral-50 cursor-pointer',
                      // Take mode — selected
                      !isEditable &&
                        !submitted &&
                        isSelected &&
                        'bg-blue-50 cursor-pointer',
                      // Submitted — correct
                      isCorrectReveal && 'bg-emerald-50',
                      // Submitted — wrong selection
                      isWrongSelection && 'bg-red-50',
                      // Submitted — neutral (not selected, not correct)
                      submitted &&
                        !isMarkedCorrect &&
                        !isSelected &&
                        'bg-white opacity-60',
                      // Edit — marked correct
                      isEditable && isMarkedCorrect && 'bg-emerald-50',
                      // Edit — not marked
                      isEditable &&
                        !isMarkedCorrect &&
                        'bg-white hover:bg-neutral-50'
                    )

                    const chip = cn(
                      'shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold transition-colors',
                      // Take mode — default
                      !isEditable &&
                        !submitted &&
                        !isSelected &&
                        'bg-neutral-100 text-neutral-500',
                      // Take mode — selected
                      !isEditable &&
                        !submitted &&
                        isSelected &&
                        'bg-blue-500 text-white',
                      // Submitted — correct
                      isCorrectReveal && 'bg-emerald-500 text-white',
                      // Submitted — wrong selection
                      isWrongSelection && 'bg-red-500 text-white',
                      // Submitted — neutral
                      submitted &&
                        !isMarkedCorrect &&
                        !isSelected &&
                        'bg-neutral-100 text-neutral-400',
                      // Edit — correct
                      isEditable &&
                        isMarkedCorrect &&
                        'bg-emerald-500 text-white',
                      // Edit — not correct
                      isEditable &&
                        !isMarkedCorrect &&
                        'bg-neutral-100 text-neutral-500'
                    )

                    return (
                      <div
                        key={answer.answer_id}
                        onClick={() =>
                          handleAnswerClick(
                            question.question_id,
                            answer.answer_id
                          )
                        }
                        className={row}
                      >
                        {/* Letter chip — clickable in edit mode to toggle correct */}
                        {isEditable ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              markAnswerCorrect(
                                question.question_id,
                                answer.answer_id
                              )
                            }}
                            className={cn(chip, 'cursor-pointer outline-none')}
                            title={
                              answer.correct
                                ? t('editor.blocks.quiz_block.mark_incorrect')
                                : t('editor.blocks.quiz_block.mark_correct')
                            }
                          >
                            {answer.correct ? <Check weight="duotone" size={12} /> : letter}
                          </button>
                        ) : (
                          <div className={chip}>{letter}</div>
                        )}

                        {/* Answer text */}
                        <div className="flex-1 min-w-0">
                          {isEditable ? (
                            <input
                              value={answer.answer}
                              onChange={(e) =>
                                changeAnswerValue(
                                  question.question_id,
                                  answer.answer_id,
                                  e.target.value
                                )
                              }
                              placeholder={t(
                                'editor.blocks.quiz_block.answer_placeholder'
                              )}
                              className="w-full bg-transparent border-0 text-sm text-neutral-700 placeholder:text-neutral-400 outline-none"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span
                              className={cn(
                                'text-sm break-words',
                                isCorrectReveal
                                  ? 'text-emerald-900 font-medium'
                                  : isWrongSelection
                                  ? 'text-red-900 font-medium'
                                  : 'text-neutral-700'
                              )}
                            >
                              {answer.answer || (
                                <span className="text-neutral-300 italic">
                                  {t(
                                    'editor.blocks.quiz_block.answer_placeholder'
                                  )}
                                </span>
                              )}
                            </span>
                          )}
                        </div>

                        {/* Trailing — status icon (take mode) or delete (edit) */}
                        {isEditable ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteAnswer(
                                question.question_id,
                                answer.answer_id
                              )
                            }}
                            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-neutral-400 hover:text-red-500 hover:bg-neutral-100 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 outline-none"
                            title={t('editor.blocks.quiz_block.delete_answer')}
                          >
                            <Trash weight="duotone" size={12} />
                          </button>
                        ) : isCorrectReveal ? (
                          <CheckCircle
                            weight="duotone"
                            className="shrink-0 text-emerald-500"
                            size={14}
                          />
                        ) : isWrongSelection ? (
                          <X weight="duotone" className="shrink-0 text-red-500" size={14} />
                        ) : null}
                      </div>
                    )
                  })}

                  {/* Add answer */}
                  {isEditable && question.answers.length < 5 && (
                    <button
                      onClick={() => addAnswer(question.question_id)}
                      className="w-full flex items-center justify-center gap-1 h-7 rounded-lg text-[11px] font-medium text-neutral-500 hover:text-neutral-700 border border-dashed border-neutral-200 hover:border-neutral-300 hover:bg-white transition-colors outline-none"
                    >
                      <Plus weight="duotone" size={11} />
                      {t('editor.blocks.quiz_block.add_answer')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Submission message */}
        {submitted && (
          <div className="mt-2.5">
            <div
              className={cn(
                'inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md',
                submissionMessage === 'correct'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-red-50 text-red-700'
              )}
            >
              {submissionMessage === 'correct' ? (
                <CheckCircle weight="duotone" size={12} />
              ) : (
                <X weight="duotone" size={12} />
              )}
              {submissionMessage === 'correct'
                ? t('editor.blocks.quiz_block.all_correct')
                : t('editor.blocks.quiz_block.some_incorrect')}
            </div>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export default QuizBlockComponent
