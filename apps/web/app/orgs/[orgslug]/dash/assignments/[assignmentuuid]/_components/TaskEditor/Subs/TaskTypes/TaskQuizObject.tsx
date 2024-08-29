import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { useAssignmentsTask, useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import AssignmentBoxUI from '@components/Objects/Activities/Assignment/AssignmentBoxUI';
import { getAssignmentTask, getAssignmentTaskSubmissionsMe, getAssignmentTaskSubmissionsUser, handleAssignmentTaskSubmission, updateAssignmentTask } from '@services/courses/assignments';
import { Check, Info, Minus, Plus, PlusCircle, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';

type QuizSchema = {
    questionText: string;
    questionUUID?: string;
    options: {
        optionUUID?: string;
        text: string;
        fileID: string;
        type: 'text' | 'image' | 'audio' | 'video';
        assigned_right_answer: boolean;
    }[];
};

type QuizSubmitSchema = {
    questions: QuizSchema[];
    submissions: {
        questionUUID: string;
        optionUUID: string;
        answer: boolean
    }[];
};

type TaskQuizObjectProps = {
    view: 'teacher' | 'student' | 'grading';
    user_id?: string; // Only for read-only view
    assignmentTaskUUID?: string;
};

type Submission = {
    questionUUID: string;
    optionUUID: string;
    answer: boolean;
};

function TaskQuizObject({ view, assignmentTaskUUID, user_id }: TaskQuizObjectProps) {
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const assignmentTaskState = useAssignmentsTask() as any;
    const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any;
    const assignment = useAssignments() as any;


    /* TEACHER VIEW CODE */
    const [questions, setQuestions] = useState<QuizSchema[]>([
        { questionText: '', questionUUID: 'question_' + uuidv4(), options: [{ text: '', fileID: '', type: 'text', assigned_right_answer: false, optionUUID: 'option_' + uuidv4() }] },
    ]);

    const handleQuestionChange = (index: number, value: string) => {
        const updatedQuestions = [...questions];
        updatedQuestions[index].questionText = value;
        setQuestions(updatedQuestions);
    };

    const handleOptionChange = (qIndex: number, oIndex: number, value: string) => {
        const updatedQuestions = [...questions];
        updatedQuestions[qIndex].options[oIndex].text = value;
        setQuestions(updatedQuestions);
    };

    const addOption = (qIndex: number) => {
        const updatedQuestions = [...questions];
        updatedQuestions[qIndex].options.push({ text: '', fileID: '', type: 'text', assigned_right_answer: false, optionUUID: 'option_' + uuidv4() });
        setQuestions(updatedQuestions);
    };

    const removeOption = (qIndex: number, oIndex: number) => {
        const updatedQuestions = [...questions];
        updatedQuestions[qIndex].options.splice(oIndex, 1);
        setQuestions(updatedQuestions);
    };

    const addQuestion = () => {
        setQuestions([...questions, { questionText: '', questionUUID: 'question_' + uuidv4(), options: [{ text: '', fileID: '', type: 'text', assigned_right_answer: false, optionUUID: 'option_' + uuidv4() }] }]);
    };

    const removeQuestion = (qIndex: number) => {
        const updatedQuestions = [...questions];
        updatedQuestions.splice(qIndex, 1);
        setQuestions(updatedQuestions);
    };

    const toggleOption = (qIndex: number, oIndex: number) => {
        const updatedQuestions = [...questions];
        // Find the option to toggle
        const optionToToggle = updatedQuestions[qIndex].options[oIndex];
        // Toggle the 'correct' property of the option
        optionToToggle.assigned_right_answer = !optionToToggle.assigned_right_answer;
        setQuestions(updatedQuestions);
    };

    const saveFC = async () => {
        // Save the quiz to the server
        const values = {
            contents: {
                questions,
            },
        };
        const res = await updateAssignmentTask(values, assignmentTaskState.assignmentTask.assignment_task_uuid, assignment.assignment_object.assignment_uuid, access_token);
        if (res) {
            assignmentTaskStateHook({
                type: 'reload',
            });
            toast.success('Task saved successfully');
        } else {
            toast.error('Error saving task, please retry later.');
        }
    };
    /* TEACHER VIEW CODE */

    /* STUDENT VIEW CODE */
    const [userSubmissions, setUserSubmissions] = useState<QuizSubmitSchema>({
        questions: [],
        submissions: [],
    });
    const [initialUserSubmissions, setInitialUserSubmissions] = useState<QuizSubmitSchema>({
        questions: [],
        submissions: [],
    });
    const [showSavingDisclaimer, setShowSavingDisclaimer] = useState<boolean>(false);
    const [assignmentTaskOutsideProvider, setAssignmentTaskOutsideProvider] = useState<any>(null);

    async function chooseOption(qIndex: number, oIndex: number) {
        const updatedSubmissions = [...userSubmissions.submissions];
        const question = questions[qIndex];
        const option = question?.options[oIndex];

        if (!question || !option) return;

        const questionUUID = question.questionUUID;
        const optionUUID = option.optionUUID;

        if (!questionUUID || !optionUUID) return;

        const submissionIndex = updatedSubmissions.findIndex(
            (submission) => submission.questionUUID === questionUUID && submission.optionUUID === optionUUID
        );

        if (submissionIndex === -1) {
            updatedSubmissions.push({ questionUUID, optionUUID, answer: true });
        } else {
            updatedSubmissions[submissionIndex].answer = !updatedSubmissions[submissionIndex].answer;
        }

        setUserSubmissions({
            ...userSubmissions,
            submissions: updatedSubmissions,
        });
    }

    async function getAssignmentTaskUI() {
        if (assignmentTaskUUID) {
            const res = await getAssignmentTask(assignmentTaskUUID, access_token);
            if (res.success) {
                setAssignmentTaskOutsideProvider(res.data);
                setQuestions(res.data.contents.questions);
            }

        }
    }

    async function getAssignmentTaskSubmissionFromUserUI() {
        if (assignmentTaskUUID) {
            const res = await getAssignmentTaskSubmissionsMe(assignmentTaskUUID, assignment.assignment_object.assignment_uuid, access_token);
            if (res.success) {
                setUserSubmissions(res.data.task_submission);
                setInitialUserSubmissions(res.data.task_submission);
            }

        }
    }

    // Detect changes between initial and current submissions
    useEffect(() => {
        const hasChanges = JSON.stringify(initialUserSubmissions.submissions) !== JSON.stringify(userSubmissions.submissions);
        setShowSavingDisclaimer(hasChanges);
    }, [userSubmissions, initialUserSubmissions.submissions]);



    const submitFC = async () => {
        // Ensure all questions and options have submissions
        const updatedSubmissions: Submission[] = questions.flatMap(question => {
            return question.options.map(option => {
                const existingSubmission = userSubmissions.submissions.find(
                    submission => submission.questionUUID === question.questionUUID && submission.optionUUID === option.optionUUID
                );
                
                return existingSubmission || {
                    questionUUID: question.questionUUID || '',
                    optionUUID: option.optionUUID || '',
                    answer: false // Mark unsubmitted options as false
                };
            });
        });

        // Update userSubmissions with the complete set of submissions
        const updatedUserSubmissions: QuizSubmitSchema = {
            ...userSubmissions,
            submissions: updatedSubmissions
        };

        // Save the quiz to the server
        const values = {
            task_submission: updatedUserSubmissions,
            grade: 0,
            task_submission_grade_feedback: '',
        };

        if (assignmentTaskUUID) {
            const res = await handleAssignmentTaskSubmission(values, assignmentTaskUUID, assignment.assignment_object.assignment_uuid, access_token);
            if (res) {
                assignmentTaskStateHook({
                    type: 'reload',
                });
                toast.success('Task saved successfully');
                setShowSavingDisclaimer(false);
                setUserSubmissions(updatedUserSubmissions);
            } else {
                toast.error('Error saving task, please retry later.');
            }
        }
    };

    /* STUDENT VIEW CODE */

    /* GRADING VIEW CODE */
    const [userSubmissionObject, setUserSubmissionObject] = useState<any>(null);
    async function getAssignmentTaskSubmissionFromIdentifiedUserUI() {
        if (assignmentTaskUUID && user_id) {
            const res = await getAssignmentTaskSubmissionsUser(assignmentTaskUUID, user_id, assignment.assignment_object.assignment_uuid, access_token);
            if (res.success) {
                setUserSubmissions(res.data.task_submission);
                setUserSubmissionObject(res.data);
                setInitialUserSubmissions(res.data.task_submission);
            }

        }
    }

    async function gradeFC() {
        if (assignmentTaskUUID) {
            const maxPoints = assignmentTaskOutsideProvider?.max_grade_value || 100;
            const totalOptions = questions.reduce((total, question) => total + question.options.length, 0);
            let correctAnswers = 0;

            questions.forEach((question) => {
                question.options.forEach((option) => {
                    const submission = userSubmissions.submissions.find(
                        (sub) => sub.questionUUID === question.questionUUID && sub.optionUUID === option.optionUUID
                    );
                    if (submission?.answer === option.assigned_right_answer) {
                        correctAnswers++;
                    }
                });
            });

            const finalGrade = Math.round((correctAnswers / totalOptions) * maxPoints);

            // Save the grade to the server
            const values = {
                task_submission: userSubmissions,
                grade: finalGrade,
                task_submission_grade_feedback: 'Auto graded by system',
            };

            const res = await handleAssignmentTaskSubmission(values, assignmentTaskUUID, assignment.assignment_object.assignment_uuid, access_token);
            if (res) {
                getAssignmentTaskSubmissionFromIdentifiedUserUI();
                toast.success(`Task graded successfully with ${finalGrade} points`);
            } else {
                toast.error('Error grading task, please retry later.');
            }
        }
    }



    /* GRADING VIEW CODE */

    useEffect(() => {
        assignmentTaskStateHook({
            setSelectedAssignmentTaskUUID: assignmentTaskUUID,
        });
        // Teacher area
        if (view == 'teacher' && assignmentTaskState.assignmentTask.contents?.questions) {
            setQuestions(assignmentTaskState.assignmentTask.contents.questions);
        }
        // Student area
        else if (view == 'student') {
            getAssignmentTaskUI();
            getAssignmentTaskSubmissionFromUserUI();
        }

        // Grading area
        else if (view == 'grading') {
            getAssignmentTaskUI();
            //setQuestions(assignmentTaskState.assignmentTask.contents.questions);
            getAssignmentTaskSubmissionFromIdentifiedUserUI();

        }
    }, [assignmentTaskState, assignment, assignmentTaskStateHook, access_token]);

    if (questions && questions.length >= 0) {
        return (
            <AssignmentBoxUI submitFC={submitFC} saveFC={saveFC} gradeFC={gradeFC} view={view} currentPoints={userSubmissionObject?.grade} maxPoints={assignmentTaskOutsideProvider?.max_grade_value} showSavingDisclaimer={showSavingDisclaimer} type="quiz">
                <div className="flex flex-col space-y-6">
                    {questions && questions.map((question, qIndex) => (
                        <div key={qIndex} className="flex flex-col space-y-1.5">
                            <div className="flex space-x-2 items-center">
                                {view === 'teacher' ? (
                                    <input
                                        value={question.questionText}
                                        onChange={(e) => handleQuestionChange(qIndex, e.target.value)}
                                        placeholder="Question"
                                        className="w-full px-3 text-neutral-600 bg-[#00008b00] border-2 border-gray-200 rounded-md border-dotted text-sm font-bold"
                                    />
                                ) : (
                                    <p className="w-full px-3 text-neutral-600 bg-[#00008b00] border-2 border-gray-200 rounded-md border-dotted text-sm font-bold">
                                        {question.questionText}
                                    </p>
                                )}
                                {view === 'teacher' && (
                                    <div
                                        className="w-[20px] flex-none flex items-center h-[20px] rounded-lg bg-slate-200/60 text-slate-500 hover:bg-slate-300 text-sm transition-all ease-linear cursor-pointer"
                                        onClick={() => removeQuestion(qIndex)}
                                    >
                                        <Minus size={12} className="mx-auto" />
                                    </div>
                                )}
                            </div>
                            <div className="flex flex-col space-y-2">
                                {question.options.map((option, oIndex) => (
                                    <div className="flex" key={oIndex}>
                                        <div
                                            onClick={() => view === 'student' && chooseOption(qIndex, oIndex)}
                                            className={"answer outline outline-3 outline-white pr-2 shadow w-full flex items-center space-x-2 h-[30px] hover:bg-opacity-100 hover:shadow-md rounded-lg bg-white text-sm duration-150 cursor-pointer ease-linear nice-shadow " + (view == 'student' ? 'active:scale-110' : '')}
                                        >
                                            <div className="font-bold text-base flex items-center h-full w-[40px] rounded-l-md text-slate-800 bg-slate-100/80">
                                                <p className="mx-auto font-bold text-sm">{String.fromCharCode(65 + oIndex)}</p>
                                            </div>
                                            {view === 'teacher' ? (
                                                <input
                                                    type="text"
                                                    value={option.text}
                                                    onChange={(e) => handleOptionChange(qIndex, oIndex, e.target.value)}
                                                    placeholder="Option"
                                                    className="w-full mx-2 px-3 pr-6 text-neutral-600 bg-[#00008b00] border-2 border-gray-200 rounded-md border-dotted text-sm font-bold"
                                                />
                                            ) : (
                                                <p className="w-full mx-2 px-3 pr-6 text-neutral-600 bg-[#00008b00] text-sm font-bold">
                                                    {option.text}
                                                </p>
                                            )}
                                            {view === 'teacher' && (
                                                <>
                                                    <div
                                                        className={`w-fit flex-none flex text-xs px-2 py-0.5 space-x-1 items-center h-fit rounded-lg ${option.assigned_right_answer ? 'bg-lime-200 text-lime-600' : 'bg-rose-200/60 text-rose-500'
                                                            } hover:bg-lime-300 text-sm transition-all ease-linear cursor-pointer`}
                                                        onClick={() => toggleOption(qIndex, oIndex)}
                                                    >
                                                        {option.assigned_right_answer ? <Check size={12} className="mx-auto" /> : <X size={12} className="mx-auto" />}
                                                        {option.assigned_right_answer ? (
                                                            <p className="mx-auto font-bold text-xs">True</p>
                                                        ) : (
                                                            <p className="mx-auto font-bold text-xs">False</p>
                                                        )}
                                                    </div>
                                                    <div
                                                        className="w-[20px] flex-none flex items-center h-[20px] rounded-lg bg-slate-200/60 text-slate-500 hover:bg-slate-300 text-sm transition-all ease-linear cursor-pointer"
                                                        onClick={() => removeOption(qIndex, oIndex)}
                                                    >
                                                        <Minus size={12} className="mx-auto" />
                                                    </div>
                                                </>
                                            )}
                                            {view === 'grading' && (
                                                <>
                                                    <div
                                                        className={`w-fit flex-none flex text-xs px-2 py-0.5 space-x-1 items-center h-fit rounded-lg ${option.assigned_right_answer ? 'bg-lime-200 text-lime-600' : 'bg-rose-200/60 text-rose-500'
                                                            } hover:bg-lime-300 text-sm transition-all ease-linear cursor-pointer`}
                                                    >
                                                        {option.assigned_right_answer ? <Check size={12} className="mx-auto" /> : <X size={12} className="mx-auto" />}
                                                        {option.assigned_right_answer ? (
                                                            <p className="mx-auto font-bold text-xs">Marked as True</p>
                                                        ) : (
                                                            <p className="mx-auto font-bold text-xs">Marked as False</p>
                                                        )}
                                                    </div>

                                                </>
                                            )}
                                            {view === 'student' && (
                                                <div 
                                                    className={`w-[20px] flex-none flex items-center h-[20px] rounded-lg ${
                                                        userSubmissions.submissions.find(
                                                            (submission) =>
                                                                submission.questionUUID === question.questionUUID &&
                                                                submission.optionUUID === option.optionUUID &&
                                                                submission.answer
                                                        )
                                                            ? "bg-green-200/60 text-green-500 hover:bg-green-300"
                                                            : "bg-slate-200/60 text-slate-500 hover:bg-slate-300"
                                                    } text-sm transition-all ease-linear cursor-pointer`}
                                                    onClick={() => chooseOption(qIndex, oIndex)}
                                                >
                                                    {userSubmissions.submissions.find(
                                                        (submission) =>
                                                            submission.questionUUID === question.questionUUID &&
                                                            submission.optionUUID === option.optionUUID &&
                                                            submission.answer
                                                    ) ? (
                                                        <Check size={12} className="mx-auto" />
                                                    ) : (
                                                        <X size={12} className="mx-auto" />
                                                    )}
                                                </div>
                                            )}
                                            {view === 'grading' && (
                                                <>
                                                   
                                                    <div className={`w-[20px] flex-none flex items-center h-[20px] rounded-lg ${
                                                        userSubmissions.submissions.find(
                                                            (submission) =>
                                                                submission.questionUUID === question.questionUUID &&
                                                                submission.optionUUID === option.optionUUID &&
                                                                submission.answer
                                                        )
                                                            ? "bg-green-200/60 text-green-500"
                                                            : "bg-slate-200/60 text-slate-500"
                                                    } text-sm`}>
                                                        {userSubmissions.submissions.find(
                                                            (submission) =>
                                                                submission.questionUUID === question.questionUUID &&
                                                                submission.optionUUID === option.optionUUID &&
                                                                submission.answer
                                                        ) ? (
                                                            <Check size={12} className="mx-auto" />
                                                        ) : (
                                                            <X size={12} className="mx-auto" />
                                                        )}
                                                    </div>
                                                </>
                                            )}

                                        </div>
                                        {view === 'teacher' && oIndex === question.options.length - 1 && questions[qIndex].options.length <= 4 && (
                                            <div className="flex justify-center mx-auto px-2">
                                                <div
                                                    className="outline text-xs outline-3 outline-white px-2 shadow w-full flex items-center h-[30px] hover:bg-opacity-100 hover:shadow-md rounded-lg bg-white duration-150 cursor-pointer ease-linear nice-shadow"
                                                    onClick={() => addOption(qIndex)}
                                                >
                                                    <Plus size={14} className="inline-block" />
                                                    <span></span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
                {view === 'teacher' && questions.length <= 5 && (
                    <div className="flex justify-center mx-auto px-2">
                        <div
                            className="flex w-full my-2 py-2 px-4 bg-white text-slate text-xs rounded-md nice-shadow hover:shadow-sm cursor-pointer space-x-3 items-center transition duration-150 ease-linear"
                            onClick={addQuestion}
                        >
                            <PlusCircle size={14} className="inline-block" />
                            <span>Add Question</span>
                        </div>
                    </div>
                )}
            </AssignmentBoxUI>
        );
    }
    else {
        return <div className='flex flex-row space-x-2 text-sm items-center'>
            <Info size={12} />
            <p>No questions found</p>
        </div>;
    }
}

export default TaskQuizObject;
