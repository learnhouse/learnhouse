import { NodeViewWrapper } from '@tiptap/react'
import { v4 as uuidv4 } from 'uuid'
import { cn } from '@/lib/utils'
import React from 'react'
import {
  Question as QuestionIcon,
  Check,
  CheckCircle,
  Plus,
  ArrowCounterClockwise,
  Trash,
  X,
  Sparkle,
} from '@phosphor-icons/react'
import dynamic from 'next/dynamic'
const ReactConfetti = dynamic(() => import('react-confetti'), { ssr: false })
const AIQuizGeneratorModal = dynamic(() => import('@components/Objects/AI/AIQuizGeneratorModal'), { ssr: false })
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useTranslation } from 'react-i18next'
import {
  QUIZ_GRADING_ALL_OR_NOTHING,
  QUIZ_RESPONSE_MULTIPLE,
  QUIZ_RESPONSE_SINGLE,
  QuizResponseType,
  resolveQuizResponseType,
  scoreQuizQuestion,
} from '@/lib/quiz/modes'

interface Answer {
  answer_id: string
  answer: string
  correct: boolean
}
interface Question {
  question_id: string
  question: string
  // The kind of question. `custom_answer` is legacy and never rendered — HOW
  // MANY answers may be picked is a separate axis, carried by `response_type`
  // (same field name as the graded assignment quiz task).
  type: 'multiple_choice' | 'custom_answer'
  // 'single' = pick one, 'multiple' = select all that apply. Absent on blocks
  // authored before the mode existed — always read it through
  // `questionResponseType`, never directly.
  response_type?: QuizResponseType
  answers: Answer[]
}

/** The response mode of a question: explicit when set, inferred from the key. */
function questionResponseType(question: Question): QuizResponseType {
  const correctCount = (question.answers ?? []).filter((a) => a.correct).length
  return resolveQuizResponseType(question.response_type, correctCount)
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
  const [showAIGenerator, setShowAIGenerator] = React.useState(false)
  const activityUuid = props.extension?.options?.activity?.activity_uuid

  const applyGeneratedQuiz = (quiz: { quizId: string; questions: Question[] }) => {
    // Append the generated questions to whatever is already in the block.
    const merged = [...questions, ...quiz.questions]
    props.updateAttributes({
      quizId: props.node.attrs.quizId || quiz.quizId,
      questions: merged,
    })
    setQuestions(merged)
  }

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
      return
    }

    const question = questions.find((q: Question) => q.question_id === question_id)
    // Radio semantics on a pick-one question: the new choice replaces the old.
    const kept =
      question && questionResponseType(question) === QUIZ_RESPONSE_SINGLE
        ? userAnswers.filter((answer: any) => answer.question_id !== question_id)
        : userAnswers
    setUserAnswers([...kept, { question_id, answer_id }])
  }

  const refreshUserSubmission = () => {
    setUserAnswers([])
    setSubmitted(false)
    setSubmissionMessage('')
  }

  const handleUserSubmission = () => {
    setSubmitted(true)

    // This block is an ungraded client-side self-check, so it stays
    // all-or-nothing (no partial credit here) — but pass/fail now runs through
    // the same scoring helper as the graded quiz task, so single- and
    // multiple-response questions are judged the same way in both places.
    // A question with no correct answer marked can't be judged at all; it is
    // skipped rather than failing the whole quiz.
    const gradable = questions.filter((question: Question) =>
      (question.answers ?? []).some((answer: Answer) => answer.correct)
    )

    const allCorrect = gradable.every((question: Question) => {
      const outcomes = question.answers.map((answer: Answer) => ({
        correct: !!answer.correct,
        selected: userAnswers.some(
          (userAnswer: any) =>
            userAnswer.question_id === question.question_id &&
            userAnswer.answer_id === answer.answer_id
        ),
      }))
      return (
        scoreQuizQuestion(
          outcomes,
          questionResponseType(question),
          QUIZ_GRADING_ALL_OR_NOTHING
        ) === 1
      )
    })

    setSubmissionMessage(allCorrect ? 'correct' : 'incorrect')
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
      response_type: QUIZ_RESPONSE_SINGLE,
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
    const newQuestions = questions.map((question: Question) => {
      if (question.question_id !== question_id) return question
      const wasCorrect = !!question.answers.find(
        (answer: Answer) => answer.answer_id === answer_id
      )?.correct
      // On a pick-one question the key is a radio group: marking an answer
      // correct un-marks whatever was correct before.
      const isSingle = questionResponseType(question) === QUIZ_RESPONSE_SINGLE
      return {
        ...question,
        answers: question.answers.map((answer: Answer) => {
          if (answer.answer_id === answer_id) {
            return { ...answer, correct: !wasCorrect }
          }
          if (isSingle && !wasCorrect) return { ...answer, correct: false }
          return answer
        }),
      }
    })
    saveQuestions(newQuestions)
  }

  const setQuestionResponseType = (
    question_id: string,
    responseType: QuizResponseType
  ) => {
    const newQuestions = questions.map((question: Question) => {
      if (question.question_id !== question_id) return question
      if (responseType !== QUIZ_RESPONSE_SINGLE) {
        return { ...question, response_type: responseType }
      }
      // Switching a multi-correct question to pick-one would otherwise leave a
      // key the learner cannot satisfy: keep the first correct answer only.
      let kept = false
      return {
        ...question,
        response_type: responseType,
        answers: question.answers.map((answer: Answer) => {
          if (!answer.correct) return answer
          if (!kept) {
            kept = true
            return answer
          }
          return { ...answer, correct: false }
        }),
      }
    })
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
            <QuestionIcon weight="duotone" className="text-neutral-400" size={15} />
            <span className="uppercase tracking-widest text-[11px] font-bold text-neutral-400">
              {t('editor.blocks.quiz')}
            </span>
          </div>

          {isEditable ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowAIGenerator(true)}
                className="bg-neutral-900 hover:bg-neutral-800 text-white font-medium py-1.5 px-3 rounded-lg text-xs transition-colors outline-none flex items-center gap-1.5 nice-shadow"
              >
                <Sparkle weight="duotone" size={13} />
                {t('editor.blocks.quiz_block.generate_with_ai', 'Generate with AI')}
              </button>
              <button
                onClick={addSampleQuestion}
                className="flex items-center gap-1 bg-neutral-200 hover:bg-neutral-300 text-neutral-700 text-xs font-medium px-2.5 py-1 rounded-md transition-colors outline-none"
              >
                <Plus weight="duotone" size={12} />
                {t('editor.blocks.quiz_block.add_question')}
              </button>
            </div>
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
            <QuestionIcon weight="duotone" className="text-neutral-300" size={20} />
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
            {questions.map((question: Question, qIndex: number) => {
              const responseType = questionResponseType(question)
              const isSingleResponse = responseType === QUIZ_RESPONSE_SINGLE
              const hasNoCorrectAnswer = !(question.answers ?? []).some(
                (answer: Answer) => answer.correct
              )
              return (
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

                {/* Response mode — switch in edit mode, hint in take mode */}
                {isEditable ? (
                  <div className="flex flex-wrap items-center gap-1 mb-1.5 px-1">
                    {([QUIZ_RESPONSE_SINGLE, QUIZ_RESPONSE_MULTIPLE] as QuizResponseType[]).map(
                      (mode) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={responseType === mode}
                          onClick={() =>
                            setQuestionResponseType(question.question_id, mode)
                          }
                          className={cn(
                            'text-[10px] font-medium px-2 py-0.5 rounded-md transition-colors outline-none',
                            responseType === mode
                              ? 'bg-neutral-800 text-white'
                              : 'bg-neutral-200 text-neutral-600 hover:bg-neutral-300'
                          )}
                        >
                          {mode === QUIZ_RESPONSE_SINGLE
                            ? t('editor.blocks.quiz_block.response_type_single')
                            : t('editor.blocks.quiz_block.response_type_multiple')}
                        </button>
                      )
                    )}
                    {hasNoCorrectAnswer && (
                      // Non-blocking: a question with no correct answer can't be
                      // judged, so it is skipped when the learner submits.
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-amber-100 text-amber-700">
                        {t('editor.blocks.quiz_block.no_correct_answer_warning')}
                      </span>
                    )}
                  </div>
                ) : (
                  !isSingleResponse && (
                    <p className="mb-1.5 px-1 text-[10px] font-medium text-neutral-500">
                      {t('editor.blocks.quiz_block.select_all_that_apply')}
                    </p>
                  )
                )}

                {/* Answers */}
                <div
                  className="space-y-1"
                  role={isEditable ? undefined : isSingleResponse ? 'radiogroup' : 'group'}
                  aria-label={
                    isEditable
                      ? undefined
                      : `${question.question || t('editor.blocks.quiz_block.question_label', { defaultValue: 'Question' })} — ${
                          isSingleResponse
                            ? t('editor.blocks.quiz_block.select_one')
                            : t('editor.blocks.quiz_block.select_all_that_apply')
                        }`
                  }
                >
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
                      'shrink-0 w-6 h-6 flex items-center justify-center text-[11px] font-bold transition-colors',
                      // Shape is the affordance: a circle means pick one, a
                      // square means select all that apply.
                      isSingleResponse ? 'rounded-full' : 'rounded-md',
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
                        // The rows stay divs (native inputs are out of scope
                        // here), so they carry the radio/checkbox roles and
                        // keyboard activation by hand.
                        role={
                          isEditable
                            ? undefined
                            : isSingleResponse
                            ? 'radio'
                            : 'checkbox'
                        }
                        aria-checked={isEditable ? undefined : isSelected}
                        aria-disabled={!isEditable && submitted ? true : undefined}
                        tabIndex={!isEditable && !submitted ? 0 : undefined}
                        onKeyDown={(e) => {
                          if (isEditable || submitted) return
                          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                            e.preventDefault()
                            handleAnswerClick(
                              question.question_id,
                              answer.answer_id
                            )
                          }
                        }}
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
              )
            })}
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
      {showAIGenerator && (
        <AIQuizGeneratorModal
          isOpen={showAIGenerator}
          onClose={() => setShowAIGenerator(false)}
          onInsert={applyGeneratedQuiz}
          activityUuid={activityUuid}
        />
      )}
    </NodeViewWrapper>
  )
}

export default QuizBlockComponent
