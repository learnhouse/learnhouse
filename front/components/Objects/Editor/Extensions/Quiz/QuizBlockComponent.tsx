import { NodeViewWrapper } from "@tiptap/react";
import { v4 as uuidv4 } from "uuid";
import React from "react";
import { BadgeHelp, Check, Minus, MoreVertical, Plus, X } from "lucide-react";

interface Answer {
  answer_id: string;
  answer: string;
  correct: boolean;
}
interface Question {
  question_id: string;
  question: string;
  type: "multiple_choice" | 'custom_answer'
  answers: Answer[];
}

function QuizBlockComponent(props: any) {
  const [questions, setQuestions] = React.useState(props.node.attrs.questions) as [Question[], any];
  const isEditable = props.extension.options.editable;

  const getAlphabetFromIndex = (index: number) => {
    const alphabet = Array.from({ length: 26 }, (_, i) => String.fromCharCode('A'.charCodeAt(0) + i));
    return alphabet[index];
  }

  const saveQuestions = (questions: any) => {
    props.updateAttributes({
      questions: questions,
    });
    setQuestions(questions);

  };
  const addSampleQuestion = () => {
    const newQuestion = {
      question_id: uuidv4(),
      question: "",
      type: "multiple_choice",
      answers: [
        {
          answer_id: uuidv4(),
          answer: "",
          correct: false
        },
      ]
    }
    setQuestions([...questions, newQuestion]);
  }

  const addAnswer = (question_id: string) => {
    const newAnswer = {
      answer_id: uuidv4(),
      answer: "",
      correct: false
    }

    // check if there is already more thqn 5 answers
    const question: any = questions.find((question: Question) => question.question_id === question_id);
    if (question.answers.length >= 5) {
      return;
    }



    const newQuestions = questions.map((question: Question) => {
      if (question.question_id === question_id) {
        question.answers.push(newAnswer);
      }
      return question;
    });

    saveQuestions(newQuestions);
  }

  const changeAnswerValue = (question_id: string, answer_id: string, value: string) => {
    const newQuestions = questions.map((question: Question) => {
      if (question.question_id === question_id) {
        question.answers.map((answer: Answer) => {
          if (answer.answer_id === answer_id) {
            answer.answer = value;
          }
          return answer;
        });
      }
      return question;
    });
    saveQuestions(newQuestions);
  }

  const changeQuestionValue = (question_id: string, value: string) => {
    const newQuestions = questions.map((question: Question) => {
      if (question.question_id === question_id) {
        question.question = value;
      }
      return question;
    });
    saveQuestions(newQuestions);
  }

  const deleteQuestion = (question_id: string) => {
    const newQuestions = questions.filter((question: Question) => question.question_id !== question_id);
    saveQuestions(newQuestions);
  }

  const deleteAnswer = (question_id: string, answer_id: string) => {
    const newQuestions = questions.map((question: Question) => {
      if (question.question_id === question_id) {
        question.answers = question.answers.filter((answer: Answer) => answer.answer_id !== answer_id);
      }
      return question;
    });
    saveQuestions(newQuestions);
  }

  const markAnswerCorrect = (question_id: string, answer_id: string) => {
    const newQuestions = questions.map((question: Question) => {
      if (question.question_id === question_id) {
        question.answers.map((answer: Answer) => {
          if (answer.answer_id === answer_id) {
            answer.correct = true;
          } else {
            answer.correct = false;
          }
          return answer;
        });
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
        <div className="flex space-x-2 pt-1 items-center text-sm">
          <div className="grow flex space-x-2 items-center text-sm">
            <BadgeHelp className='text-slate-400' size={15} />
            <p className="uppercase tracking-widest text-xs font-bold py-1 text-slate-400">Quiz</p>
          </div>
          <div>
            <button onClick={addSampleQuestion} className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold py-1 px-2 rounded-lg text-xs">Add Question</button>
          </div>
        </div>

        {questions.map((question: Question) => (
          <div key={question.question_id} className="pt-1 space-y-2">
            <div className="question">
              <div className="flex space-x-2 items-center">
                <div className="flex-grow">
                  <input value={question.question} placeholder="Your Question" onChange={(e) => changeQuestionValue(question.question_id, e.target.value)} className="text-slate-800 bg-[#00008b00] border-2 border-gray-200 rounded-md border-dotted text-md font-bold w-full"></input>
                </div>
                <div className="w-[20px] flex-none flex items-center h-[20px] rounded-lg bg-red-600 hover:bg-red-700 text-sm transition-all ease-linear cursor-pointer">
                  <Minus
                    onClick={() => deleteQuestion(question.question_id)}
                    className="mx-auto text-red-200" size={12} />
                </div>
              </div>
              <div className="answers flex py-2 space-x-3">
                {question.answers.map((answer: Answer) => (
                  <div key={answer.answer_id}
                    className={`outline outline-3 pr-2 shadow w-full flex items-center space-x-2 h-[30px] ${answer.correct ? 'outline-green-200' : 'outline-white'} bg-opacity-50 hover:bg-opacity-100 hover:shadow-md rounded-lg bg-white text-sm hover:scale-105 active:scale-110 duration-150 cursor-pointer ease-linear`}>
                    <div className="bg-white font-bold text-neutral-900 text-base flex items-center h-full w-[40px] rounded-md">
                      <p className="mx-auto">{getAlphabetFromIndex(question.answers.indexOf(answer))}</p>
                    </div>
                    <input value={answer.answer} onChange={(e) => changeAnswerValue(question.question_id, answer.answer_id, e.target.value)} placeholder="Answer" className="w-full mx-2 px-3 pr-6 text-neutral-600 bg-[#00008b00] border-2 border-gray-200 rounded-md border-dotted text-sm font-bold"></input>

                    <div className="flex space-x-1 items-center">
                      <div
                        onClick={() => markAnswerCorrect(question.question_id, answer.answer_id)}
                        className="w-[20px] flex-none flex items-center h-[20px] rounded-lg bg-green-200 hover:bg-green-300 transition-all ease-linear text-sm cursor-pointer ">
                        <Check
                          className="mx-auto text-green-800" size={12} />
                      </div>
                      <MoreVertical className="text-slate-300" size={15} />
                      <div
                        onClick={() => deleteAnswer(question.question_id, answer.answer_id)}
                        className="w-[20px] flex-none flex items-center h-[20px] rounded-lg bg-red-600 hover:bg-red-700 text-sm transition-all ease-linear cursor-pointer">
                        <Minus
                          className="mx-auto text-red-200" size={12} />
                      </div>
                    </div>

                  </div>
                ))}
                <div onClick={() => addAnswer(question.question_id)} className="outline outline-3 shadow w-[30px] flex-none flex items-center h-[30px] outline-white hover:bg-opacity-100 hover:shadow-md rounded-lg bg-white text-sm hover:scale-105 active:scale-110 duration-150 cursor-pointer ease-linear">
                  <Plus className="mx-auto text-slate-800" size={15} />
                </div>
              </div>
            </div>
          </div>
        ))}

      </div>
    </NodeViewWrapper>
  );
}


export default QuizBlockComponent;
