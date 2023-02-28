import { NodeViewWrapper } from "@tiptap/react";
import { v4 as uuidv4 } from "uuid";
import React from "react";
import styled from "styled-components";
import { submitQuizBlock } from "@services/blocks/Quiz/quiz";

function ImageBlockComponent(props: any) {
  const [questions, setQuestions] = React.useState([]) as any;
  const [answers, setAnswers] = React.useState([]) as any;

  function addSampleQuestion() {
    setQuestions([
      ...questions,
      {
        question_id: "question_" + uuidv4(),
        question_value: "",
        options: [
          {
            option_id: "option_" + uuidv4(),
            option_data: "",
            option_type: "text",
          },
        ],
      },
    ]);
  }

  const deleteQuestion = (index: number) => {
    let modifiedQuestions = [...questions];
    modifiedQuestions.splice(index, 1);
    setQuestions(modifiedQuestions);
    console.log(questions);

    // remove the answers from the answers array
    let modifiedAnswers = [...answers];
    modifiedAnswers = modifiedAnswers.filter((answer: any) => answer.question_id !== questions[index].question_id);
    setAnswers(modifiedAnswers);
  };

  const onQuestionChange = (e: any, index: number) => {
    let modifiedQuestions = [...questions];
    modifiedQuestions[index].question_value = e.target.value;
    setQuestions(modifiedQuestions);
  };

  const addOption = (question_id: string) => {
    // find the question index from the question_id and add the option to that question index
    let modifiedQuestions = [...questions];
    let questionIndex = modifiedQuestions.findIndex((question: any) => question.question_id === question_id);
    modifiedQuestions[questionIndex].options.push({
      option_id: "option_" + uuidv4(),
      option_data: "",
      option_type: "text",
    });
    setQuestions(modifiedQuestions);
  };

  const deleteOption = (question_id: string, option_id: string) => {
    // find the option index from the option_id and delete the option from that option index
    let modifiedQuestions = [...questions];
    let questionIndex = modifiedQuestions.findIndex((question: any) => question.question_id === question_id);
    let optionIndex = modifiedQuestions[questionIndex].options.findIndex((option: any) => option.option_id === option_id);
    modifiedQuestions[questionIndex].options.splice(optionIndex, 1);
    setQuestions(modifiedQuestions);

    // remove the answer from the answers array
    let answerIndex = answers.findIndex((answer: any) => answer.option_id === option_id);
    if (answerIndex !== -1) {
      let modifiedAnswers = [...answers];
      modifiedAnswers.splice(answerIndex, 1);
      setAnswers(modifiedAnswers);
    }
  };

  const markOptionAsCorrect = (question_id: string, option_id: string) => {
    // find the option index from the option_id and mark the option as correct
    let answer = {
      question_id: question_id,
      option_id: option_id,
    };
    setAnswers([...answers, answer]);
    console.log(answers);
  };

  const saveQuiz = async () => {
    // save the questions and answers to the backend
    console.log("saving quiz");
    console.log(questions);
    console.log(answers);
    try {
      let res = await submitQuizBlock(props.extension.options.lecture.lecture_id, {questions : questions , answers : answers})
      console.log(res.block_id);
      props.updateAttributes({
        quizId: {
          value : res.block_id
        },
      });
      
    }
    catch (error) {
      console.log(error);
    }

    
  };

  const onOptionChange = (e: any, questionIndex: number, optionIndex: number) => {
    let modifiedQuestions = [...questions];
    modifiedQuestions[questionIndex].options[optionIndex].option_data = e.target.value;
    setQuestions(modifiedQuestions);
  };

  React.useEffect(() => {
    // fetch the questions and options from the backend
    console.log("fetching questions");
    console.log(questions);
    console.log(answers);
  }, [questions, answers]);

  return (
    <NodeViewWrapper className="block-quiz">
      <QuizBlockWrapper>
        Questions <button onClick={addSampleQuestion}>Add Question</button> <button onClick={() => saveQuiz()}>Save</button>
        <hr />
        {questions.map((question: any, qIndex: number) => (
          <>
            <div key={qIndex} style={{ marginTop: "10px" }}>
              Question : <input type="text" value={question.question} onChange={(e) => onQuestionChange(e, qIndex)} />
              <button onClick={() => deleteQuestion(qIndex)}>Delete</button>
            </div>
            Answers : <br />
            {question.options.map((option: any, oIndex: number) => (
              <>
                <div key={oIndex}>
                  <input type="text" value={option.option_data} onChange={(e) => onOptionChange(e, qIndex, oIndex)} />

                  <button onClick={() => deleteOption(question.question_id, option.option_id)}>Delete</button>
                  <input
                    type="checkbox"
                    onChange={(e) =>
                      // check if checkbox is checked or not
                      // if checked then add the answer to the answers array
                      // if unchecked then remove the answer from the answers array
                      e.target.checked ? markOptionAsCorrect(question.question_id, option.option_id) : null
                    }
                  />
                </div>
              </>
            ))}
            <button onClick={() => addOption(question.question_id)}>Add Option</button>
          </>
        ))}
      </QuizBlockWrapper>
    </NodeViewWrapper>
  );
}

const QuizBlockWrapper = styled.div`
  background-color: #0000001d;
  border-radius: 5px;
  padding: 20px;
  height: 100%;
`;
export default ImageBlockComponent;
