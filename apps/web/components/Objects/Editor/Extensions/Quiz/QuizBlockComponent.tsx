import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { NodeViewWrapper } from '@tiptap/react'
import { BadgeHelp, Check, Minus, Plus, RefreshCcw } from 'lucide-react'
import React from 'react'
import ReactConfetti from 'react-confetti'
import { twMerge } from 'tailwind-merge'
import { v4 as uuidv4 } from 'uuid'

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
    if (submitted) return

    const existingAnswerIndex = userAnswers.findIndex(
      (answer: any) =>
        answer.question_id === question_id && answer.answer_id === answer_id
    )

    if (existingAnswerIndex !== -1) {
      // Remove the answer if it's already selected
      setUserAnswers(
        userAnswers.filter((_, index) => index !== existingAnswerIndex)
      )
    } else {
      // Add the answer
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

      // If no correct answers are set and user didn't select any, it's correct
      if (correctAnswers.length === 0 && userAnswersForQuestion.length === 0) {
        return true
      }

      // Check if user selected all correct answers and no incorrect ones
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

    setSubmissionMessage(
      correctAnswers
        ? 'All answers are correct!'
        : 'Some answers are incorrect!'
    )
  }

  const getAnswerID = (answerIndex: number, questionId: string) => {
    const alphabet = Array.from({ length: 26 }, (_, i) =>
      String.fromCharCode('A'.charCodeAt(0) + i)
    )
    const alphabetID = alphabet[answerIndex]

    // Get question index
    const questionIndex = questions.findIndex(
      (question: Question) => question.question_id === questionId
    )
    const questionID = questionIndex + 1

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

    // check if there is already more than 5 answers
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
          correct:
            answer.answer_id === answer_id ? !answer.correct : answer.correct,
        }))
      }
      return question
    })
    saveQuestions(newQuestions)
  }

  return (
    <NodeViewWrapper className="block-quiz">
      <div className="rounded-xl bg-slate-100 px-3 py-2 transition-all ease-linear sm:px-5">
        {/* Header section */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
          {submitted && submissionMessage === 'All answers are correct!' && (
            <ReactConfetti
              numberOfPieces={submitted ? 1400 : 0}
              recycle={false}
              className="h-screen w-full"
            />
          )}
          <div className="flex items-center space-x-2 text-sm">
            <BadgeHelp className="text-slate-400" size={15} />
            <p className="py-1 text-xs font-bold tracking-widest text-slate-400 uppercase">
              Quiz
            </p>
          </div>

          {/* Submission message */}
          {submitted && (
            <div
              className={`rounded-md px-2 py-1 text-xs font-medium ${
                submissionMessage === 'All answers are correct!'
                  ? 'bg-lime-100 text-lime-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {submissionMessage}
            </div>
          )}

          <div className="grow"></div>

          {/* Action buttons */}
          {isEditable ? (
            <div>
              <button
                onClick={addSampleQuestion}
                className="rounded-lg bg-slate-200 px-2 py-1 text-xs font-bold text-slate-800 hover:bg-slate-300"
              >
                Add Question
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-1">
              <div
                onClick={() => refreshUserSubmission()}
                className="cursor-pointer rounded-md p-1.5 hover:bg-slate-200"
                title="Reset answers"
              >
                <RefreshCcw className="text-slate-500" size={15} />
              </div>
              <button
                onClick={() => handleUserSubmission()}
                className="rounded-lg bg-slate-200 px-2 py-1 text-xs font-bold text-slate-800 hover:bg-slate-300"
              >
                Submit
              </button>
            </div>
          )}
        </div>

        {/* Questions section */}
        {questions.map((question: Question) => (
          <div key={question.question_id} className="space-y-2 pt-3">
            <div className="question">
              <div className="flex items-center space-x-2">
                <div className="grow">
                  {isEditable ? (
                    <input
                      value={question.question}
                      placeholder="Your Question"
                      onChange={(e) =>
                        changeQuestionValue(
                          question.question_id,
                          e.target.value
                        )
                      }
                      className="text-md w-full rounded-md border-2 border-dotted border-gray-200 bg-[#00008b00] p-2 font-bold text-slate-800"
                    ></input>
                  ) : (
                    <p className="text-md w-full rounded-md bg-[#00008b00] p-2 font-bold break-words text-slate-800">
                      {question.question}
                    </p>
                  )}
                </div>
                {isEditable && (
                  <div
                    onClick={() => deleteQuestion(question.question_id)}
                    className="flex h-[24px] w-[24px] flex-none cursor-pointer items-center rounded-lg bg-slate-200 text-sm transition-all ease-linear hover:bg-slate-300"
                  >
                    <Minus className="mx-auto text-slate-500" size={14} />
                  </div>
                )}
              </div>

              {/* Answers section - changed to vertical layout for better responsiveness */}
              <div className="answers flex flex-col space-y-2 py-2">
                {question.answers.map((answer: Answer) => (
                  <div
                    key={answer.answer_id}
                    className={twMerge(
                      'bg-opacity-50 hover:bg-opacity-100 flex min-h-[36px] w-full cursor-pointer items-stretch space-x-2 rounded-lg bg-white pr-2 text-sm shadow-sm outline outline-2 duration-150 ease-linear hover:shadow-md',
                      answer.correct && isEditable
                        ? 'outline-lime-300'
                        : 'outline-white',
                      userAnswers.some(
                        (userAnswer: any) =>
                          userAnswer.question_id === question.question_id &&
                          userAnswer.answer_id === answer.answer_id &&
                          !isEditable &&
                          !submitted
                      )
                        ? 'outline-blue-400'
                        : '',
                      submitted && answer.correct
                        ? 'text-lime outline-lime-300'
                        : '',
                      submitted &&
                        !answer.correct &&
                        userAnswers.some(
                          (userAnswer: any) =>
                            userAnswer.question_id === question.question_id &&
                            userAnswer.answer_id === answer.answer_id
                        )
                        ? 'outline-red-400'
                        : ''
                    )}
                    onClick={() =>
                      handleAnswerClick(question.question_id, answer.answer_id)
                    }
                  >
                    <div
                      className={twMerge(
                        'flex w-[40px] items-center justify-center self-stretch rounded-l-md bg-white text-base font-bold text-slate-800',
                        answer.correct && isEditable
                          ? 'bg-lime-300 text-lime-800 outline-hidden'
                          : 'bg-white',
                        userAnswers.some(
                          (userAnswer: any) =>
                            userAnswer.question_id === question.question_id &&
                            userAnswer.answer_id === answer.answer_id &&
                            !isEditable &&
                            !submitted
                        )
                          ? 'bg-blue-400 text-white outline-hidden'
                          : '',
                        submitted && answer.correct
                          ? 'bg-lime-300 text-lime-800 outline-hidden'
                          : '',
                        submitted &&
                          !answer.correct &&
                          userAnswers.some(
                            (userAnswer: any) =>
                              userAnswer.question_id === question.question_id &&
                              userAnswer.answer_id === answer.answer_id
                          )
                          ? 'bg-red-400 text-red-800 outline-hidden'
                          : ''
                      )}
                    >
                      <p className="text-sm font-bold">
                        {getAnswerID(
                          question.answers.indexOf(answer),
                          question.question_id
                        )}
                      </p>
                    </div>
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
                        placeholder="Answer"
                        className="mx-2 w-full rounded-md border-2 border-dotted border-gray-200 bg-[#00008b00] px-3 py-1.5 pr-6 text-sm font-bold text-neutral-600"
                      ></input>
                    ) : (
                      <p className="mx-2 w-full rounded-md bg-[#00008b00] px-3 py-1.5 pr-6 text-sm font-bold break-words text-neutral-600">
                        {answer.answer}
                      </p>
                    )}
                    {isEditable && (
                      <div className="flex items-center space-x-1">
                        <div
                          onClick={(e) => {
                            e.stopPropagation()
                            markAnswerCorrect(
                              question.question_id,
                              answer.answer_id
                            )
                          }}
                          className="flex h-[24px] w-[24px] flex-none cursor-pointer items-center rounded-lg bg-lime-300 text-sm transition-all ease-linear hover:bg-lime-400"
                          title={
                            answer.correct
                              ? 'Mark as incorrect'
                              : 'Mark as correct'
                          }
                        >
                          <Check className="mx-auto text-lime-800" size={14} />
                        </div>
                        <div
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteAnswer(question.question_id, answer.answer_id)
                          }}
                          className="flex h-[24px] w-[24px] flex-none cursor-pointer items-center rounded-lg bg-slate-200 text-sm transition-all ease-linear hover:bg-slate-300"
                          title="Delete answer"
                        >
                          <Minus className="mx-auto text-slate-500" size={14} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {isEditable && (
                  <div
                    onClick={() => addAnswer(question.question_id)}
                    className="hover:bg-opacity-100 flex h-[36px] w-full flex-none cursor-pointer items-center justify-center rounded-lg bg-white text-sm outline outline-2 outline-white duration-150 ease-linear hover:scale-[1.01] hover:shadow-md active:scale-[1.02]"
                  >
                    <Plus className="mr-1 text-slate-800" size={15} />
                    <span className="text-sm text-slate-800">Add Answer</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </NodeViewWrapper>
  )
}

export default QuizBlockComponent
