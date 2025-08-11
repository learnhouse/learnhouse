import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { useAssignmentsTask, useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import AssignmentBoxUI from '@components/Objects/Activities/Assignment/AssignmentBoxUI';
import { getAssignmentTask, getAssignmentTaskSubmissionsMe, getAssignmentTaskSubmissionsUser, handleAssignmentTaskSubmission, updateAssignmentTask } from '@services/courses/assignments';
import { Check, Info, Minus, Plus, PlusCircle, X, Type } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';

type FormSchema = {
    questionText: string;
    questionUUID?: string;
    blanks: {
        blankUUID?: string;
        placeholder: string;
        correctAnswer: string;
        hint?: string;
    }[];
};

type FormSubmitSchema = {
    questions: FormSchema[];
    submissions: {
        questionUUID: string;
        blankUUID: string;
        answer: string;
    }[];
    assignment_task_submission_uuid?: string;
};

type TaskFormObjectProps = {
    view: 'teacher' | 'student' | 'grading';
    assignmentTaskUUID: string;
    user_id?: string;
};

function TaskFormObject({ view, assignmentTaskUUID, user_id }: TaskFormObjectProps) {
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const assignmentTaskState = useAssignmentsTask() as any;
    const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any;
    const assignment = useAssignments() as any;

    /* TEACHER VIEW CODE */
    const [questions, setQuestions] = useState<FormSchema[]>(
        view === 'teacher' ? [
            { 
                questionText: '', 
                questionUUID: 'question_' + uuidv4(), 
                blanks: [{ 
                    placeholder: 'Enter the correct answer', 
                    correctAnswer: '', 
                    hint: '',
                    blankUUID: 'blank_' + uuidv4() 
                }] 
            },
        ] : []
    );

    const handleQuestionChange = (index: number, value: string) => {
        const updatedQuestions = [...questions];
        updatedQuestions[index].questionText = value;
        setQuestions(updatedQuestions);
    };

    const handleBlankChange = (qIndex: number, bIndex: number, field: 'placeholder' | 'correctAnswer' | 'hint', value: string) => {
        const updatedQuestions = [...questions];
        updatedQuestions[qIndex].blanks[bIndex][field] = value;
        setQuestions(updatedQuestions);
    };

    const addBlank = (qIndex: number) => {
        const updatedQuestions = [...questions];
        updatedQuestions[qIndex].blanks.push({ 
            placeholder: 'Enter the correct answer', 
            correctAnswer: '', 
            hint: '',
            blankUUID: 'blank_' + uuidv4() 
        });
        setQuestions(updatedQuestions);
    };

    const removeBlank = (qIndex: number, bIndex: number) => {
        const updatedQuestions = [...questions];
        if (updatedQuestions[qIndex].blanks.length > 1) {
            updatedQuestions[qIndex].blanks.splice(bIndex, 1);
            setQuestions(updatedQuestions);
        } else {
            toast.error('Cannot delete the last blank. At least one blank is required.');
        }
    };

    const addQuestion = () => {
        setQuestions([...questions, { 
            questionText: '', 
            questionUUID: 'question_' + uuidv4(), 
            blanks: [{ 
                placeholder: 'Enter the correct answer', 
                correctAnswer: '', 
                hint: '',
                blankUUID: 'blank_' + uuidv4() 
            }] 
        }]);
    };

    const removeQuestion = (qIndex: number) => {
        const updatedQuestions = [...questions];
        updatedQuestions.splice(qIndex, 1);
        setQuestions(updatedQuestions);
    };

    const saveFC = async () => {
        // Save the form to the server
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
            console.error('Save error:', res);
            toast.error('Error saving task, please retry later.');
        }
    };

    /* STUDENT VIEW CODE */
    const [userSubmissions, setUserSubmissions] = useState<FormSubmitSchema>({
        questions: [],
        submissions: [],
    });
    const [initialUserSubmissions, setInitialUserSubmissions] = useState<FormSubmitSchema>({
        questions: [],
        submissions: [],
    });
    const [showSavingDisclaimer, setShowSavingDisclaimer] = useState<boolean>(false);
    const [assignmentTaskOutsideProvider, setAssignmentTaskOutsideProvider] = useState<any>(null);
    const [userSubmissionObject, setUserSubmissionObject] = useState<any>(null);

    const handleUserAnswerChange = (questionUUID: string, blankUUID: string, answer: string) => {
        const updatedSubmissions = [...userSubmissions.submissions];
        const existingIndex = updatedSubmissions.findIndex(
            (submission) => submission.questionUUID === questionUUID && submission.blankUUID === blankUUID
        );

        if (existingIndex !== -1) {
            updatedSubmissions[existingIndex].answer = answer;
        } else {
            updatedSubmissions.push({
                questionUUID,
                blankUUID,
                answer,
            });
        }

        setUserSubmissions({
            ...userSubmissions,
            submissions: updatedSubmissions,
        });
    };

    const handleUserAnswerBlur = (questionUUID: string, blankUUID: string, answer: string) => {
        // Auto-focus next blank only when user leaves the current input and it has content
        if (answer.trim() && view === 'student') {
            const allBlanks = questions.flatMap(q => q.blanks.map(b => ({ questionUUID: q.questionUUID, blankUUID: b.blankUUID })));
            const currentIndex = allBlanks.findIndex(b => b.questionUUID === questionUUID && b.blankUUID === blankUUID);
            const nextBlank = allBlanks[currentIndex + 1];
            
            if (nextBlank) {
                setTimeout(() => {
                    const nextInput = document.querySelector(`[data-blank-id="${nextBlank.blankUUID}"]`) as HTMLInputElement;
                    if (nextInput && !nextInput.value.trim()) {
                        nextInput.focus();
                    }
                }, 100);
            }
        }
    };

    const submitFC = async () => {
        if (userSubmissions.submissions.length === 0) {
            toast.error('Please fill in at least one blank before submitting.');
            return;
        }

        const values = {
            assignment_task_submission_uuid: userSubmissions.assignment_task_submission_uuid || null,
            task_submission: userSubmissions,
            grade: 0,
            task_submission_grade_feedback: '',
        };

        const res = await handleAssignmentTaskSubmission(
            values,
            assignmentTaskUUID,
            assignment.assignment_object.assignment_uuid,
            access_token
        );

        if (res) {
            toast.success('Form submitted successfully!');
            // Update userSubmissions with the returned UUID for future updates
            const updatedUserSubmissions = {
                ...userSubmissions,
                assignment_task_submission_uuid: res.data?.assignment_task_submission_uuid || userSubmissions.assignment_task_submission_uuid
            };
            setUserSubmissions(updatedUserSubmissions);
            setInitialUserSubmissions(updatedUserSubmissions);
            setShowSavingDisclaimer(false);
        } else {
            console.error('Submission error:', res);
            toast.error('Error submitting form, please retry later.');
        }
    };

    const gradeFC = async () => {
        if (!user_id) {
            toast.error('User ID is required for grading.');
            return;
        }

        // Calculate grade based on correct answers
        let correctAnswers = 0;
        let totalBlanks = 0;

        questions.forEach((question) => {
            question.blanks.forEach((blank) => {
                totalBlanks++;
                const userAnswer = userSubmissions.submissions.find(
                    (submission) => submission.questionUUID === question.questionUUID && submission.blankUUID === blank.blankUUID
                );
                if (userAnswer && userAnswer.answer.toLowerCase().trim() === blank.correctAnswer.toLowerCase().trim()) {
                    correctAnswers++;
                }
            });
        });

        const maxPoints = assignmentTaskOutsideProvider?.max_grade_value || 100;
        const finalGrade = totalBlanks > 0 ? Math.round((correctAnswers / totalBlanks) * maxPoints) : 0;

        // Save the grade to the server
        const values = {
            assignment_task_submission_uuid: userSubmissions.assignment_task_submission_uuid,
            task_submission: userSubmissions,
            grade: finalGrade,
            task_submission_grade_feedback: 'Auto graded by system',
        };

        const res = await handleAssignmentTaskSubmission(values, assignmentTaskUUID, assignment.assignment_object.assignment_uuid, access_token);
        if (res) {
            getAssignmentTaskSubmissionFromIdentifiedUserUI();
            toast.success(`Task graded successfully with ${finalGrade} points (${correctAnswers}/${totalBlanks} correct)`);
        } else {
            toast.error('Error grading task, please retry later.');
        }
    };

    async function getAssignmentTaskSubmissionFromIdentifiedUserUI() {
        if (!access_token || !user_id) {
            return;
        }
        
        if (assignmentTaskUUID) {
            const res = await getAssignmentTaskSubmissionsUser(assignmentTaskUUID, user_id, assignment.assignment_object.assignment_uuid, access_token);
            if (res.success) {
                setUserSubmissions({
                    ...res.data.task_submission,
                    assignment_task_submission_uuid: res.data.assignment_task_submission_uuid
                });
                setInitialUserSubmissions({
                    ...res.data.task_submission,
                    assignment_task_submission_uuid: res.data.assignment_task_submission_uuid
                });
                setUserSubmissionObject(res.data);
            }
        }
    }

    useEffect(() => {
        const loadAssignmentTask = async () => {
            if (assignmentTaskUUID) {
                const res = await getAssignmentTask(assignmentTaskUUID, access_token);
                if (res.success) {
                    setAssignmentTaskOutsideProvider(res.data);
                    // Only set questions if they exist and we're not in teacher view, or if we're in teacher view and there are existing questions
                    if (res.data.contents?.questions && res.data.contents.questions.length > 0) {
                        setQuestions(res.data.contents.questions);
                    } else if (view !== 'teacher') {
                        // For non-teacher views, set empty array if no questions exist
                        setQuestions([]);
                    }
                    // For teacher view, keep the initial state if no questions exist
                }
            }
        };

        const loadUserSubmissions = async () => {
            if (view === 'student' && assignmentTaskUUID) {
                const res = await getAssignmentTaskSubmissionsMe(assignmentTaskUUID, assignment.assignment_object.assignment_uuid, access_token);
                if (res.success) {
                    setUserSubmissions({
                        ...res.data.task_submission,
                        assignment_task_submission_uuid: res.data.assignment_task_submission_uuid
                    });
                    setInitialUserSubmissions({
                        ...res.data.task_submission,
                        assignment_task_submission_uuid: res.data.assignment_task_submission_uuid
                    });
                }
            }
        };

        // Set assignment task UUID in context
        assignmentTaskStateHook({
            setSelectedAssignmentTaskUUID: assignmentTaskUUID,
        });

        // Teacher area - Load from context first, then from API if needed
        if (view === 'teacher') {
            if (assignmentTaskState.assignmentTask.contents?.questions) {
                setQuestions(assignmentTaskState.assignmentTask.contents.questions);
            } else {
                loadAssignmentTask();
            }
        }
        // Student area
        else if (view === 'student') {
            loadAssignmentTask();
            loadUserSubmissions();
        }
        // Grading area
        else if (view === 'grading') {
            loadAssignmentTask();
            getAssignmentTaskSubmissionFromIdentifiedUserUI();
        }
    }, [assignmentTaskState, assignment, assignmentTaskStateHook, access_token, assignmentTaskUUID, view]);

    useEffect(() => {
        if (JSON.stringify(userSubmissions) !== JSON.stringify(initialUserSubmissions)) {
            setShowSavingDisclaimer(true);
        } else {
            setShowSavingDisclaimer(false);
        }
    }, [userSubmissions, initialUserSubmissions]);

    // Ensure questions is always an array for teacher view
    if (view === 'teacher' && (!questions || questions.length === 0)) {
        setQuestions([
            { 
                questionText: '', 
                questionUUID: 'question_' + uuidv4(), 
                blanks: [{ 
                    placeholder: 'Enter the correct answer', 
                    correctAnswer: '', 
                    hint: '',
                    blankUUID: 'blank_' + uuidv4() 
                }] 
            },
        ]);
        return null; // Return null to prevent rendering while state updates
    }

    if (view === 'teacher' || (questions && questions.length > 0)) {
        return (
            <AssignmentBoxUI 
                submitFC={submitFC} 
                saveFC={saveFC} 
                gradeFC={gradeFC} 
                view={view} 
                currentPoints={userSubmissionObject?.grade} 
                maxPoints={assignmentTaskOutsideProvider?.max_grade_value} 
                showSavingDisclaimer={showSavingDisclaimer} 
                type="form"
            >
                {view === 'grading' && (
                    <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                        <h3 className="text-sm font-semibold text-gray-800 mb-2">Submission Summary</h3>
                        <div className="grid grid-cols-3 gap-4 text-sm">
                            <div className="text-center">
                                <div className="text-lg font-bold text-blue-600">
                                    {questions.flatMap(q => q.blanks).length}
                                </div>
                                <div className="text-gray-600">Total Blanks</div>
                            </div>
                            <div className="text-center">
                                <div className="text-lg font-bold text-green-600">
                                    {questions.flatMap(q => q.blanks).filter(blank => {
                                        const userAnswer = userSubmissions.submissions.find(s => s.blankUUID === blank.blankUUID);
                                        return userAnswer && userAnswer.answer.toLowerCase().trim() === blank.correctAnswer.toLowerCase().trim();
                                    }).length}
                                </div>
                                <div className="text-gray-600">Correct</div>
                            </div>
                            <div className="text-center">
                                <div className="text-lg font-bold text-red-600">
                                    {questions.flatMap(q => q.blanks).length - questions.flatMap(q => q.blanks).filter(blank => {
                                        const userAnswer = userSubmissions.submissions.find(s => s.blankUUID === blank.blankUUID);
                                        return userAnswer && userAnswer.answer.toLowerCase().trim() === blank.correctAnswer.toLowerCase().trim();
                                    }).length}
                                </div>
                                <div className="text-gray-600">Incorrect</div>
                            </div>
                        </div>
                    </div>
                )}
                <div className="flex flex-col space-y-6">
                    {questions && questions.map((question, qIndex) => (
                        <div key={qIndex} className="flex flex-col space-y-1.5">
                            <div className="flex space-x-2 items-center">
                                {view === 'teacher' ? (
                                    <input
                                        value={question.questionText}
                                        onChange={(e) => handleQuestionChange(qIndex, e.target.value)}
                                        placeholder="Enter your question with blanks (use ___ for blanks)"
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

                            {/* Blanks section */}
                            <div className="flex flex-col space-y-2">
                                {question.blanks.map((blank, bIndex) => (
                                    <div key={bIndex} className="flex">
                                        <div className={"blank-item outline-3 outline-white pr-2 shadow-sm w-full flex items-center space-x-2 min-h-[40px] hover:bg-opacity-100 hover:shadow-md rounded-lg bg-white text-sm duration-150 ease-linear nice-shadow " + (view == 'student' ? 'active:scale-105' : '')}>
                                            <div className="font-bold text-base flex items-center justify-center h-full w-[40px] rounded-l-md text-slate-800 bg-slate-100/80">
                                                <Type size={14} />
                                            </div>
                                            {view === 'teacher' ? (
                                                <div className="flex flex-col space-y-1 w-full py-2">
                                                    <input
                                                        value={blank.placeholder}
                                                        onChange={(e) => handleBlankChange(qIndex, bIndex, 'placeholder', e.target.value)}
                                                        placeholder="Placeholder text for the blank"
                                                        className="w-full mx-2 px-3 pr-6 text-neutral-600 bg-[#00008b00] border-2 border-gray-200 rounded-md border-dotted text-sm font-bold"
                                                    />
                                                    <input
                                                        value={blank.correctAnswer}
                                                        onChange={(e) => handleBlankChange(qIndex, bIndex, 'correctAnswer', e.target.value)}
                                                        placeholder="Correct answer"
                                                        className="w-full mx-2 px-3 pr-6 text-neutral-600 bg-lime-50 border-2 border-lime-200 rounded-md border-dotted text-sm font-bold"
                                                    />
                                                    <input
                                                        value={blank.hint || ''}
                                                        onChange={(e) => handleBlankChange(qIndex, bIndex, 'hint', e.target.value)}
                                                        placeholder="Hint (optional)"
                                                        className="w-full mx-2 px-3 pr-6 text-neutral-600 bg-blue-50 border-2 border-blue-200 rounded-md border-dotted text-xs"
                                                    />
                                                </div>
                                            ) : view === 'grading' ? (
                                                <div className="flex flex-col space-y-1 w-full py-2">
                                                    <div className="flex items-center space-x-2 w-full mx-2">
                                                        <input
                                                            value={userSubmissions.submissions.find(
                                                                (submission) => submission.questionUUID === question.questionUUID && submission.blankUUID === blank.blankUUID
                                                            )?.answer || ''}
                                                            readOnly
                                                            className="flex-1 px-3 pr-6 text-neutral-600 bg-gray-50 border-2 border-gray-200 rounded-md text-sm font-bold"
                                                        />
                                                    </div>
                                                    <div className="mx-2 text-xs text-gray-600">
                                                        <span className="font-semibold">Expected:</span> {blank.correctAnswer}
                                                    </div>
                                                    {blank.hint && (
                                                        <div className="mx-2 text-xs text-blue-600 italic">💡 {blank.hint}</div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="flex flex-col space-y-1 w-full py-2">
                                                    <input
                                                        value={userSubmissions.submissions?.find(
                                                            (submission) => submission.questionUUID === question.questionUUID && submission.blankUUID === blank.blankUUID
                                                        )?.answer || ''}
                                                        onChange={(e) => handleUserAnswerChange(question.questionUUID!, blank.blankUUID!, e.target.value)}
                                                        onBlur={(e) => handleUserAnswerBlur(question.questionUUID!, blank.blankUUID!, e.target.value)}
                                                        placeholder={blank.placeholder}
                                                        data-blank-id={blank.blankUUID}
                                                        className="w-full mx-2 px-3 pr-6 text-neutral-600 bg-[#00008b00] border-2 border-gray-200 rounded-md focus:border-blue-400 focus:ring-2 focus:ring-blue-200 text-sm font-bold transition-all"
                                                    />
                                                    {blank.hint && (
                                                        <div className="mx-2 text-xs text-blue-600 italic">💡 {blank.hint}</div>
                                                    )}
                                                </div>
                                            )}
                                            {view === 'teacher' && (
                                                <div
                                                    className="w-[20px] flex-none flex items-center h-[20px] rounded-lg bg-slate-200/60 text-slate-500 hover:bg-slate-300 text-sm transition-all ease-linear cursor-pointer"
                                                    onClick={() => removeBlank(qIndex, bIndex)}
                                                >
                                                    <Minus size={12} className="mx-auto" />
                                                </div>
                                            )}
                                            {view === 'grading' && (
                                                <div className={`w-fit flex-none flex text-xs px-2 py-0.5 space-x-1 items-center h-fit rounded-lg ${
                                                    userSubmissions.submissions.find(
                                                        (submission) => submission.questionUUID === question.questionUUID && submission.blankUUID === blank.blankUUID
                                                    )?.answer?.toLowerCase().trim() === blank.correctAnswer.toLowerCase().trim()
                                                        ? 'bg-lime-200 text-lime-600'
                                                        : 'bg-rose-200/60 text-rose-500'
                                                } text-sm`}>
                                                    {userSubmissions.submissions.find(
                                                        (submission) => submission.questionUUID === question.questionUUID && submission.blankUUID === blank.blankUUID
                                                    )?.answer?.toLowerCase().trim() === blank.correctAnswer.toLowerCase().trim() ? (
                                                        <>
                                                            <Check size={12} className="mx-auto" />
                                                            <p className="mx-auto font-bold text-xs">Correct</p>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <X size={12} className="mx-auto" />
                                                            <p className="mx-auto font-bold text-xs">Incorrect</p>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                            {view === 'student' && (
                                                <div className={`w-[20px] flex-none flex items-center h-[20px] rounded-lg ${
                                                    userSubmissions.submissions.find(
                                                        (submission) => submission.questionUUID === question.questionUUID && submission.blankUUID === blank.blankUUID
                                                    )?.answer?.trim()
                                                        ? "bg-green-200/60 text-green-500"
                                                        : "bg-slate-200/60 text-slate-500"
                                                } text-sm transition-all ease-linear`}>
                                                    {userSubmissions.submissions.find(
                                                        (submission) => submission.questionUUID === question.questionUUID && submission.blankUUID === blank.blankUUID
                                                    )?.answer?.trim() ? (
                                                        <Check size={12} className="mx-auto" />
                                                    ) : (
                                                        <X size={12} className="mx-auto" />
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        {view === 'teacher' && bIndex === question.blanks.length - 1 && question.blanks.length <= 4 && (
                                            <div className="flex justify-center mx-auto px-2">
                                                <div
                                                    className="outline-3 outline-white px-2 shadow-sm w-full flex items-center h-[40px] hover:bg-opacity-100 hover:shadow-md rounded-lg bg-white duration-150 cursor-pointer ease-linear nice-shadow"
                                                    onClick={() => addBlank(qIndex)}
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
                            className="flex w-full my-2 py-2 px-4 bg-white text-slate text-xs rounded-md nice-shadow hover:shadow-xs cursor-pointer space-x-3 items-center transition duration-150 ease-linear"
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

    return (
        <div className='flex flex-row space-x-2 text-sm items-center'>
            <Info size={12} />
            <p>No questions found</p>
        </div>
    );
}

export default TaskFormObject; 