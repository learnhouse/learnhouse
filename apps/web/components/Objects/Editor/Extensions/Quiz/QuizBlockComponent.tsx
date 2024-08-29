import { NodeViewWrapper } from '@tiptap/react'
import { v4 as uuidv4 } from 'uuid'
import { twMerge } from 'tailwind-merge'
import React from 'react'
import { BadgeHelp, Check, Minus, Plus, RefreshCcw } from 'lucide-react'
import ReactConfetti from 'react-confetti'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'

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
    if (submitted) return;

    const existingAnswerIndex = userAnswers.findIndex(
      (answer: any) => answer.question_id === question_id && answer.answer_id === answer_id
    );

    if (existingAnswerIndex !== -1) {
      // Remove the answer if it's already selected
      setUserAnswers(userAnswers.filter((_, index) => index !== existingAnswerIndex));
    } else {
      // Add the answer
      setUserAnswers([...userAnswers, { question_id, answer_id }]);
    }
  }

  const refreshUserSubmission = () => {
    setUserAnswers([])
    setSubmitted(false)
  }

  const handleUserSubmission = () => {
    setSubmitted(true);

    const correctAnswers = questions.every((question: Question) => {
      const correctAnswers = question.answers.filter((answer: Answer) => answer.correct);
      const userAnswersForQuestion = userAnswers.filter(
        (userAnswer: any) => userAnswer.question_id === question.question_id
      );

      // If no correct answers are set and user didn't select any, it's correct
      if (correctAnswers.length === 0 && userAnswersForQuestion.length === 0) {
        return true;
      }

      // Check if user selected all correct answers and no incorrect ones
      return (
        correctAnswers.length === userAnswersForQuestion.length &&
        correctAnswers.every((correctAnswer: Answer) =>
          userAnswersForQuestion.some(
            (userAnswer: any) => userAnswer.answer_id === correctAnswer.answer_id
          )
        )
      );
    });

    setSubmissionMessage(correctAnswers ? 'All answers are correct!' : 'Some answers are incorrect!');
  }

  const getAnswerID = (answerIndex: number, questionId: string) => {
    const alphabet = Array.from({ length: 26 }, (_, i) =>
      String.fromCharCode('A'.charCodeAt(0) + i)
    )
    let alphabetID = alphabet[answerIndex]

    // Get question index
    const questionIndex = questions.findIndex(
      (question: Question) => question.question_id === questionId
    )
    let questionID = questionIndex + 1

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

    // check if there is already more thqn 5 answers
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
      <div
        //style={{ background: "radial-gradient(152.15% 150.08% at 56.45% -6.67%, rgba(180, 255, 250, 0.10) 5.53%, rgba(202, 201, 255, 0.10) 66.76%)" }}
        className="rounded-xl px-5 py-2 bg-slate-100 transition-all ease-linear"
      >
        <div className="flex space-x-2 pt-1 items-center text-sm overflow-hidden">
          {submitted && submissionMessage == 'All answers are correct!' && (
            <ReactConfetti
              numberOfPieces={submitted ? 1400 : 0}
              recycle={false}
              className="w-full h-screen"
            />
          )}
          <div className="flex space-x-2 items-center text-sm">
            <BadgeHelp className="text-slate-400" size={15} />
            <p className="uppercase tracking-widest text-xs font-bold py-1 text-slate-400">
              Quiz
            </p>
          </div>
          <div className="grow flex items-center justify-center"></div>
          {isEditable ? (
            <div>
              <button
                onClick={addSampleQuestion}
                className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold py-1 px-2 rounded-lg text-xs"
              >
                Add Question
              </button>
            </div>
          ) : (
            <div className="flex space-x-1 items-center">
              <div
                onClick={() => refreshUserSubmission()}
                className="cursor-pointer px-2"
              >
                <RefreshCcw
                  className="text-slate-400 cursor-pointer"
                  size={15}
                />
              </div>
              <button
                onClick={() => handleUserSubmission()}
                className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold py-1 px-2 rounded-lg text-xs"
              >
                Submit
              </button>
            </div>
          )}
        </div>

        {questions.map((question: Question) => (
          <div key={question.question_id} className="pt-1 space-y-2">
            <div className="question">
              <div className="flex space-x-2 items-center">
                <div className="flex-grow">
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
                      className="text-slate-800 bg-[#00008b00] border-2 border-gray-200 rounded-md border-dotted text-md font-bold w-full"
                    ></input>
                  ) : (
                    <p className="text-slate-800 bg-[#00008b00] rounded-md text-md font-bold w-full">
                      {question.question}
                    </p>
                  )}
                </div>
                {isEditable && (
                  <div
                    onClick={() => deleteQuestion(question.question_id)}
                    className="w-[20px] flex-none flex items-center h-[20px] rounded-lg bg-slate-200 hover:bg-slate-300 text-sm transition-all ease-linear cursor-pointer"
                  >
                    <Minus className="mx-auto text-slate-400" size={12} />
                  </div>
                )}
              </div>
              <div className="answers flex py-2 space-x-3">
                {question.answers.map((answer: Answer) => (
                  <div
                    key={answer.answer_id}
                    className={twMerge(
                      'outline outline-3 pr-2 shadow w-full flex items-center space-x-2 h-[30px] bg-opacity-50 hover:bg-opacity-100 hover:shadow-md rounded-s rounded-lg bg-white text-sm hover:scale-105 active:scale-110 duration-150 cursor-pointer ease-linear',
                      answer.correct && isEditable ? 'outline-lime-300' : 'outline-white',
                      userAnswers.some(
                        (userAnswer: any) =>
                          userAnswer.question_id === question.question_id &&
                          userAnswer.answer_id === answer.answer_id &&
                          !isEditable
                      ) ? 'outline-slate-300' : '',
                      submitted && answer.correct ? 'outline-lime-300 text-lime' : '',
                      submitted &&
                        !answer.correct &&
                        userAnswers.some(
                          (userAnswer: any) =>
                            userAnswer.question_id === question.question_id &&
                            userAnswer.answer_id === answer.answer_id
                        ) ? 'outline-red-400' : ''
                    )}
                    onClick={() =>
                      handleAnswerClick(question.question_id, answer.answer_id)
                    }
                  >
                    <div
                      className={twMerge(
                        'bg-white font-bold  text-base flex items-center h-full w-[40px] rounded-l-md text-slate-800',
                        answer.correct && isEditable
                          ? 'bg-lime-300 text-lime-800 outline-none'
                          : 'bg-white',
                        submitted && answer.correct
                          ? 'bg-lime-300 text-lime-800 outline-none'
                          : '',
                        submitted &&
                          !answer.correct &&
                          userAnswers.some(
                            (userAnswer: any) =>
                              userAnswer.question_id === question.question_id &&
                              userAnswer.answer_id === answer.answer_id
                          )
                          ? 'bg-red-400 text-red-800 outline-none'
                          : ''
                      )}
                    >
                      <p className="mx-auto font-bold text-sm ">
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
                        className="w-full mx-2 px-3 pr-6 text-neutral-600 bg-[#00008b00] border-2 border-gray-200 rounded-md border-dotted text-sm font-bold"
                      ></input>
                    ) : (
                      <p className="w-full mx-2 px-3 pr-6 text-neutral-600 bg-[#00008b00] rounded-md ext-sm font-bold">
                        {answer.answer}
                      </p>
                    )}
                    {isEditable && (
                      <div className="flex space-x-1 items-center">
                        <div
                          onClick={() =>
                            markAnswerCorrect(
                              question.question_id,
                              answer.answer_id
                            )
                          }
                          className="w-[20px] flex-none flex items-center h-[20px] rounded-lg bg-lime-300 hover:bg-lime-400 transition-all ease-linear text-sm cursor-pointer "
                        >
                          <Check className="mx-auto text-lime-800" size={12} />
                        </div>
                        <div
                          onClick={() =>
                            deleteAnswer(question.question_id, answer.answer_id)
                          }
                          className="w-[20px] flex-none flex items-center h-[20px] rounded-lg bg-slate-200 hover:bg-slate-300 text-sm transition-all ease-linear cursor-pointer"
                        >
                          <Minus className="mx-auto text-slate-400" size={12} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {isEditable && (
                  <div
                    onClick={() => addAnswer(question.question_id)}
                    className="outline outline-3 w-[30px] flex-none flex items-center h-[30px] outline-white hover:bg-opacity-100 hover:shadow-md rounded-lg bg-white text-sm hover:scale-105 active:scale-110 duration-150 cursor-pointer ease-linear"
                  >
                    <Plus className="mx-auto text-slate-800" size={15} />
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
