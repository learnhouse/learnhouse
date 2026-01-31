import { NodeViewWrapper } from '@tiptap/react'
import { v4 as uuidv4 } from 'uuid'
import { cn } from '@/lib/utils'
import React from 'react'
import { BadgeHelp, Check, Minus, Plus, RefreshCcw } from 'lucide-react'
import ReactConfetti from 'react-confetti'
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
    if (submitted) return;

    const existingAnswerIndex = userAnswers.findIndex(
      (answer: any) => answer.question_id === question_id && answer.answer_id === answer_id
    );

    if (existingAnswerIndex !== -1) {
      setUserAnswers(userAnswers.filter((_, index) => index !== existingAnswerIndex));
    } else {
      setUserAnswers([...userAnswers, { question_id, answer_id }]);
    }
  }

  const refreshUserSubmission = () => {
    setUserAnswers([])
    setSubmitted(false)
    setSubmissionMessage('')
  }

  const handleUserSubmission = () => {
    setSubmitted(true);

    const correctAnswers = questions.every((question: Question) => {
      const correctAnswers = question.answers.filter((answer: Answer) => answer.correct);
      const userAnswersForQuestion = userAnswers.filter(
        (userAnswer: any) => userAnswer.question_id === question.question_id
      );

      if (correctAnswers.length === 0 && userAnswersForQuestion.length === 0) {
        return true;
      }

      return (
        correctAnswers.length === userAnswersForQuestion.length &&
        correctAnswers.every((correctAnswer: Answer) =>
          userAnswersForQuestion.some(
            (userAnswer: any) => userAnswer.answer_id === correctAnswer.answer_id
          )
        )
      );
    });

    setSubmissionMessage(correctAnswers ? 'correct' : 'incorrect');
  }

  const getAnswerID = (answerIndex: number, questionId: string) => {
    const alphabet = Array.from({ length: 26 }, (_, i) =>
      String.fromCharCode('A'.charCodeAt(0) + i)
    )
    let alphabetID = alphabet[answerIndex]
    return `${alphabetID}`
  }

  const saveQuestions = (questions: any) => {
    props.updateAttributes({
      questions: questions,
    })
    setQuestions(questions)
  }

  const addSampleQuestion = () => {
    const newQuestion = {
      question_id: uuidv4(),
      question: '',
      type: 'multiple_choice',
      answers: [
        {
          answer_id: uuidv4(),
          answer: '',
          correct: false,
        },
      ],
    }
    setQuestions([...questions, newQuestion])
  }

  const addAnswer = (question_id: string) => {
    const newAnswer = {
      answer_id: uuidv4(),
      answer: '',
      correct: false,
    }

    const question: any = questions.find(
      (question: Question) => question.question_id === question_id
    )
    if (question.answers.length >= 5) {
      return
    }

    const newQuestions = questions.map((question: Question) => {
      if (question.question_id === question_id) {
        question.answers.push(newAnswer)
      }
      return question
    })

    saveQuestions(newQuestions)
  }

  const changeAnswerValue = (
    question_id: string,
    answer_id: string,
    value: string
  ) => {
    const newQuestions = questions.map((question: Question) => {
      if (question.question_id === question_id) {
        question.answers.map((answer: Answer) => {
          if (answer.answer_id === answer_id) {
            answer.answer = value
          }
          return answer
        })
      }
      return question
    })
    saveQuestions(newQuestions)
  }

  const changeQuestionValue = (question_id: string, value: string) => {
    const newQuestions = questions.map((question: Question) => {
      if (question.question_id === question_id) {
        question.question = value
      }
      return question
    })
    saveQuestions(newQuestions)
  }

  const deleteQuestion = (question_id: string) => {
    const newQuestions = questions.filter(
      (question: Question) => question.question_id !== question_id
    )
    saveQuestions(newQuestions)
  }

  const deleteAnswer = (question_id: string, answer_id: string) => {
    const newQuestions = questions.map((question: Question) => {
      if (question.question_id === question_id) {
        question.answers = question.answers.filter(
          (answer: Answer) => answer.answer_id !== answer_id
        )
      }
      return question
    })
    saveQuestions(newQuestions)
  }

  const markAnswerCorrect = (question_id: string, answer_id: string) => {
    const newQuestions = questions.map((question: Question) => {
      if (question.question_id === question_id) {
        question.answers = question.answers.map((answer: Answer) => ({
          ...answer,
          correct: answer.answer_id === answer_id ? !answer.correct : answer.correct,
        }));
      }
      return question;
    });
    saveQuestions(newQuestions);
  }

  return (
    <NodeViewWrapper className="block-quiz">
      <div className="bg-neutral-50 rounded-xl px-5 py-4 nice-shadow transition-all ease-linear">
        {/* Header section */}
        <div className="flex flex-wrap gap-2 items-center text-sm mb-3">
          {submitted && submissionMessage === 'correct' && (
            <ReactConfetti
              numberOfPieces={submitted ? 1400 : 0}
              recycle={false}
              className="w-full h-screen"
            />
          )}
          <div className="flex items-center gap-2">
            <BadgeHelp className="text-neutral-400" size={16} />
            <span className="uppercase tracking-widest text-xs font-bold text-neutral-400">
              {t('editor.blocks.quiz')}
            </span>
          </div>

          {/* Submission message */}
          {submitted && (
            <div className={cn(
              "text-xs font-medium px-2 py-1 rounded-md",
              submissionMessage === 'correct'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-red-100 text-red-700'
            )}>
              {submissionMessage === 'correct'
                ? t('editor.blocks.quiz_block.all_correct')
                : t('editor.blocks.quiz_block.some_incorrect')}
            </div>
          )}

          <div className="grow"></div>

          {/* Action buttons */}
          {isEditable ? (
            <button
              onClick={addSampleQuestion}
              className="bg-neutral-200 hover:bg-neutral-300 text-neutral-700 font-medium py-1.5 px-3 rounded-lg text-xs transition-colors outline-none"
            >
              {t('editor.blocks.quiz_block.add_question')}
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => refreshUserSubmission()}
                className="p-1.5 rounded-md hover:bg-neutral-200 transition-colors"
                title={t('editor.blocks.quiz_block.reset_answers')}
              >
                <RefreshCcw className="text-neutral-500" size={15} />
              </button>
              <button
                onClick={() => handleUserSubmission()}
                className="bg-neutral-200 hover:bg-neutral-300 text-neutral-700 font-medium py-1.5 px-3 rounded-lg text-xs transition-colors outline-none"
              >
                {t('editor.blocks.quiz_block.submit')}
              </button>
            </div>
          )}
        </div>

        {/* Questions section */}
        <div className="space-y-4">
          {questions.map((question: Question) => (
            <div key={question.question_id} className="bg-white rounded-lg p-4 nice-shadow">
              {/* Question */}
              <div className="flex items-start gap-2 mb-3">
                <div className="flex-1">
                  {isEditable ? (
                    <input
                      value={question.question}
                      placeholder={t('editor.blocks.quiz_block.question_placeholder')}
                      onChange={(e) =>
                        changeQuestionValue(
                          question.question_id,
                          e.target.value
                        )
                      }
                      className="text-neutral-800 bg-transparent border-2 border-dashed border-neutral-200 rounded-lg text-base font-semibold w-full p-2 focus:border-neutral-300 outline-none transition-colors"
                    />
                  ) : (
                    <p className="text-neutral-800 text-base font-semibold p-2 break-words">
                      {question.question}
                    </p>
                  )}
                </div>
                {isEditable && (
                  <button
                    onClick={() => deleteQuestion(question.question_id)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-neutral-100 hover:bg-neutral-200 transition-colors"
                  >
                    <Minus className="text-neutral-500" size={14} />
                  </button>
                )}
              </div>

              {/* Answers */}
              <div className="space-y-2">
                {question.answers.map((answer: Answer) => {
                  const isSelected = userAnswers.some(
                    (userAnswer: any) =>
                      userAnswer.question_id === question.question_id &&
                      userAnswer.answer_id === answer.answer_id
                  );
                  const isCorrectAnswer = answer.correct;
                  const isIncorrectSelection = submitted && isSelected && !isCorrectAnswer;
                  const isCorrectSelection = submitted && isCorrectAnswer;

                  return (
                    <div
                      key={answer.answer_id}
                      onClick={() => handleAnswerClick(question.question_id, answer.answer_id)}
                      className={cn(
                        "flex items-stretch rounded-lg border-2 transition-all cursor-pointer min-h-[44px]",
                        // Default state
                        !isEditable && !submitted && !isSelected && "border-neutral-200 bg-neutral-50 hover:border-neutral-300 hover:bg-neutral-100",
                        // Selected (not submitted)
                        !isEditable && !submitted && isSelected && "border-blue-400 bg-blue-50",
                        // Correct answer (submitted)
                        submitted && isCorrectAnswer && "border-emerald-400 bg-emerald-50",
                        // Incorrect selection (submitted)
                        isIncorrectSelection && "border-red-400 bg-red-50",
                        // Edit mode - correct marked
                        isEditable && isCorrectAnswer && "border-emerald-400 bg-emerald-50",
                        // Edit mode - not marked
                        isEditable && !isCorrectAnswer && "border-neutral-200 bg-neutral-50"
                      )}
                    >
                      {/* Answer Letter */}
                      <div
                        className={cn(
                          "w-10 flex items-center justify-center rounded-l-md font-bold text-sm flex-shrink-0",
                          // Default
                          !isEditable && !submitted && !isSelected && "bg-neutral-100 text-neutral-600",
                          // Selected (not submitted)
                          !isEditable && !submitted && isSelected && "bg-blue-400 text-white",
                          // Correct (submitted)
                          submitted && isCorrectAnswer && "bg-emerald-400 text-white",
                          // Incorrect selection
                          isIncorrectSelection && "bg-red-400 text-white",
                          // Edit mode - correct
                          isEditable && isCorrectAnswer && "bg-emerald-400 text-white",
                          // Edit mode - not correct
                          isEditable && !isCorrectAnswer && "bg-neutral-100 text-neutral-600"
                        )}
                      >
                        {getAnswerID(question.answers.indexOf(answer), question.question_id)}
                      </div>

                      {/* Answer Text */}
                      <div className="flex-1 flex items-center px-3 py-2">
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
                            placeholder={t('editor.blocks.quiz_block.answer_placeholder')}
                            className="w-full text-neutral-700 bg-transparent border-0 text-sm font-medium outline-none"
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span className="text-neutral-700 text-sm font-medium break-words">
                            {answer.answer}
                          </span>
                        )}
                      </div>

                      {/* Edit Actions */}
                      {isEditable && (
                        <div className="flex items-center gap-1 px-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              markAnswerCorrect(question.question_id, answer.answer_id);
                            }}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-emerald-100 hover:bg-emerald-200 transition-colors"
                            title={answer.correct ? t('editor.blocks.quiz_block.mark_incorrect') : t('editor.blocks.quiz_block.mark_correct')}
                          >
                            <Check className="text-emerald-700" size={14} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteAnswer(question.question_id, answer.answer_id);
                            }}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-neutral-100 hover:bg-neutral-200 transition-colors"
                            title={t('editor.blocks.quiz_block.delete_answer')}
                          >
                            <Minus className="text-neutral-500" size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Add Answer Button */}
                {isEditable && (
                  <button
                    onClick={() => addAnswer(question.question_id)}
                    className="w-full flex items-center justify-center gap-1 h-11 border-2 border-dashed border-neutral-200 rounded-lg text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 transition-colors"
                  >
                    <Plus size={15} />
                    <span className="text-sm font-medium">{t('editor.blocks.quiz_block.add_answer')}</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export default QuizBlockComponent
