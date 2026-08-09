import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { useAssignmentSubmission, useAssignmentTaskSubmissions } from '@components/Contexts/Assignments/AssignmentSubmissionContext';
import { useAssignmentsTask, useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import AssignmentBoxUI from '@components/Objects/Activities/Assignment/AssignmentBoxUI';
import { getAssignmentTask, getAssignmentTaskSubmissionsUser, handleAssignmentTaskSubmission, updateAssignmentTask } from '@services/courses/assignments';
import { Check, Info, Minus, Plus, PlusCircle, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { applyManualGrade } from './applyManualGrade';
import { serializeSelectedOptions } from './autosaveSerialize';

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
    assignment_task_submission_uuid?: string;
};

type TaskQuizObjectProps = {
    view: 'teacher' | 'student' | 'grading';
    user_id?: string; // Only for read-only view
    onGraded?: () => void; // Notify parent (grading view) after an inline grade
    assignmentTaskUUID?: string;
};

type Submission = {
    questionUUID: string;
    optionUUID: string;
    answer: boolean;
};

function TaskQuizObject({ view, assignmentTaskUUID, user_id, onGraded }: TaskQuizObjectProps) {
    const { t } = useTranslation()
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const assignmentTaskState = useAssignmentsTask() as any;
    const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any;
    const assignment = useAssignments() as any;
    const taskSubmissionsMap = useAssignmentTaskSubmissions();
    const queryClient = useQueryClient();
    // Reveal correct answers to the student only after the submission is
    // GRADED AND the teacher opted into it on the assignment. Before grading
    // we still hide the answer key (the assignment hasn't been evaluated yet)
    // and on opt-out we never reveal, so the student sees only their own
    // choices + score.
    const assignmentSubmission = useAssignmentSubmission() as any;
    const submissionIsGraded = Array.isArray(assignmentSubmission)
        && assignmentSubmission.length > 0
        && assignmentSubmission[0].submission_status === 'GRADED';
    const showCorrectAnswers = view === 'student'
        && submissionIsGraded
        && !!assignment?.assignment_object?.show_correct_answers;


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
        if (updatedQuestions[qIndex].options.length > 1) {
            updatedQuestions[qIndex].options.splice(oIndex, 1);
            setQuestions(updatedQuestions);
        } else {
            toast.error('Cannot delete the last option. At least one option is required.');
        }
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
        if (res.success) {
            assignmentTaskStateHook({
                type: 'reload',
            });
            toast.success(t('dashboard.assignments.editor.toasts.task_saved'));
        } else {
            toast.error(t('dashboard.assignments.editor.toasts.task_save_error'));
        }
    };
    /* TEACHER VIEW CODE */

    /* STUDENT VIEW CODE */
    const [userSubmissions, setUserSubmissions] = useState<QuizSubmitSchema>({
        questions: [],
        submissions: [],
    });

    // Whether the answer key actually reached the client.
    //
    // The API strips `assigned_right_answer` from every option whenever the
    // student is not yet allowed to see it — notably while retries remain
    // (see _student_may_see_answer_key). The client cannot re-derive that rule
    // (it has no attempt_number here), so `showCorrectAnswers` can be true
    // while the key is absent. Rendering the key markers in that state made
    // `undefined` read as "not the right answer", so EVERY option — including
    // the one the learner correctly picked — was labelled "Wrong", even on a
    // 100% submission. Only trust the key when it is genuinely present.
    const answerKeyPresent = useMemo(
        () => questions.some((question) =>
            question.options.some((option) => typeof option.assigned_right_answer === 'boolean')
        ),
        [questions]
    );
    const revealAnswerKey = showCorrectAnswers && answerKeyPresent;

    // Did the learner pick this option?
    const isOptionSelected = (questionUUID?: string, optionUUID?: string) =>
        userSubmissions.submissions.some(
            (submission) =>
                submission.questionUUID === questionUUID &&
                submission.optionUUID === optionUUID &&
                submission.answer
        );

    const [initialUserSubmissions, setInitialUserSubmissions] = useState<QuizSubmitSchema>({
        questions: [],
        submissions: [],
    });
    const [assignmentTaskOutsideProvider, setAssignmentTaskOutsideProvider] = useState<any>(null);
    // Tracks the task UUID whose server submission we've already hydrated, so we
    // hydrate live answer state exactly once (on first load) and never re-pull
    // it over the learner's in-progress edits on later query refetches.
    const submissionHydratedForRef = React.useRef<string | null>(null);
    // True once the learner has interacted, so an async hydration that resolves
    // after the first edit can't clobber it.
    const interactedRef = React.useRef(false);

    async function chooseOption(qIndex: number, oIndex: number) {
        interactedRef.current = true;
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
            // Immutable replace — mutating the element in place would also mutate
            // the shared baseline (initialUserSubmissions) and defeat dirty
            // detection after hydration.
            const prev = updatedSubmissions[submissionIndex];
            updatedSubmissions[submissionIndex] = { ...prev, answer: !prev.answer };
        }

        setUserSubmissions({
            ...userSubmissions,
            submissions: updatedSubmissions,
        });
    }

    // Used only by grading view — student view hydrates from useAssignments() context
    async function getAssignmentTaskUI() {
        if (assignmentTaskUUID) {
            const res = await getAssignmentTask(assignmentTaskUUID, access_token);
            if (res.success) {
                setAssignmentTaskOutsideProvider(res.data);
                setQuestions(res.data.contents.questions);
            }

        }
    }

    function hydrateTaskFromContext() {
        if (!assignmentTaskUUID) return;
        const task = assignment?.assignment_tasks?.find(
            (t: any) => t.assignment_task_uuid === assignmentTaskUUID
        );
        if (task) {
            setAssignmentTaskOutsideProvider(task);
            if (task.contents?.questions) {
                setQuestions(task.contents.questions);
            }
        }
    }

    // Hydrate the student's live answer state from the server exactly ONCE per
    // task (see the ref guard at the call site). Re-running it on every query
    // refetch would overwrite in-progress edits and reset the dirty flag,
    // silently stopping auto-save after the first save.
    function hydrateSubmissionFromBatch(preserveLiveAnswers = false) {
        if (!assignmentTaskUUID) return;
        const sub = taskSubmissionsMap?.[assignmentTaskUUID] ?? null;
        if (sub) {
            // Deep-copy the submissions into two INDEPENDENT states so a later
            // edit to the live answer can never mutate the saved baseline
            // through a shared reference (which previously defeated dirty
            // detection after a refresh).
            const clone = () => ({
                ...sub.task_submission,
                submissions: (sub.task_submission?.submissions ?? []).map((s: any) => ({ ...s })),
                assignment_task_submission_uuid: sub.assignment_task_submission_uuid,
            });
            // Always seed the saved baseline so dirty detection is correct.
            setInitialUserSubmissions(clone());
            if (preserveLiveAnswers) {
                // The learner started answering before the batch resolved — keep
                // their in-progress answers, but adopt the server submission uuid
                // so their save UPDATES the existing row instead of creating a
                // duplicate.
                setUserSubmissions((prev: any) => ({
                    ...prev,
                    assignment_task_submission_uuid: sub.assignment_task_submission_uuid,
                }));
            } else {
                setUserSubmissions(clone());
            }
        }
    }



    const submitFC = async (opts?: { silent?: boolean }) => {
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
            assignment_task_submission_uuid: userSubmissions.assignment_task_submission_uuid || null,
            task_submission: updatedUserSubmissions,
            grade: 0,
            task_submission_grade_feedback: '',
        };

        if (assignmentTaskUUID) {
            const res = await handleAssignmentTaskSubmission(values, assignmentTaskUUID, assignment.assignment_object.assignment_uuid, access_token);
            if (res.success) {
                if (!opts?.silent) {
                    assignmentTaskStateHook({ type: 'reload' });
                    toast.success(t('dashboard.assignments.editor.toasts.task_saved'));
                }
                const savedUUID = res.data?.assignment_task_submission_uuid || userSubmissions.assignment_task_submission_uuid;
                // Baseline = exactly the payload we persisted.
                setInitialUserSubmissions({ ...updatedUserSubmissions, assignment_task_submission_uuid: savedUUID });
                // Live = the LATEST answers (from prev), re-completed to the same
                // shape. Never revert to the call-time snapshot — that would erase
                // any selection the learner made during the save round-trip. If a
                // mid-flight change exists, live stays ahead of baseline so the
                // dirty flag re-asserts and the next auto-save persists it.
                setUserSubmissions(prev => ({
                    ...prev,
                    assignment_task_submission_uuid: savedUUID,
                    submissions: questions.flatMap(question =>
                        question.options.map(option => {
                            const existing = prev.submissions.find(
                                s => s.questionUUID === question.questionUUID && s.optionUUID === option.optionUUID
                            );
                            return existing || {
                                questionUUID: question.questionUUID || '',
                                optionUUID: option.optionUUID || '',
                                answer: false,
                            };
                        })
                    ),
                }));
                // Silent auto-saves skip the refetch: it isn't needed for a
                // draft save and would re-hydrate the batch every ~1s. They
                // must still PATCH the cache though — with staleTime 60_000 the
                // batch query otherwise keeps serving the page-load snapshot,
                // so a remount (task retry, tab switch, route change) re-seeded
                // the baseline from pre-autosave data and overwrote answers
                // that were already on the server.
                if (!opts?.silent) {
                    queryClient.invalidateQueries({ queryKey: queryKeys.assignments.taskSubmission(assignment.assignment_object.assignment_uuid) });
                } else {
                    queryClient.setQueryData(
                        queryKeys.assignments.taskSubmission(assignment.assignment_object.assignment_uuid),
                        (old: any) => {
                            // Only patch an existing map — never fabricate one, or a
                            // task with no fetched batch would hydrate from thin air.
                            if (!old || typeof old !== 'object') return old;
                            const previous = old[assignmentTaskUUID] ?? {};
                            return {
                                ...old,
                                [assignmentTaskUUID]: {
                                    ...previous,
                                    assignment_task_submission_uuid: savedUUID,
                                    task_submission: updatedUserSubmissions,
                                },
                            };
                        }
                    );
                }
                return true;
            } else {
                if (!opts?.silent) toast.error(t('dashboard.assignments.editor.toasts.task_save_error'));
                return false;
            }
        }
        return true;
    };

    /* STUDENT VIEW CODE */

    /* GRADING VIEW CODE */
    const [userSubmissionObject, setUserSubmissionObject] = useState<any>(null);
    async function getAssignmentTaskSubmissionFromIdentifiedUserUI() {
        if (assignmentTaskUUID && user_id) {
            const res = await getAssignmentTaskSubmissionsUser(assignmentTaskUUID, user_id, assignment.assignment_object.assignment_uuid, access_token);
            if (res.success) {
                setUserSubmissions({
                    ...res.data.task_submission,
                    assignment_task_submission_uuid: res.data.assignment_task_submission_uuid
                });
                setUserSubmissionObject(res.data);
                setInitialUserSubmissions({
                    ...res.data.task_submission,
                    assignment_task_submission_uuid: res.data.assignment_task_submission_uuid
                });
            }

        }
    }

    async function gradeCustomFC(grade: number, feedback?: string) {
        // Without an existing submission row there is nothing to grade: the API
        // would fall through to a branch keyed on the SUBMITTER (here the
        // instructor), writing the grade onto the instructor's own row where it
        // is forced to 0 — while the UI toasted success and the learner's grade
        // never moved. `userSubmissions` is seeded with a truthy default object
        // in this component, so the uuid field itself must be checked.
        if (!userSubmissions?.assignment_task_submission_uuid) {
            toast.error(t('dashboard.assignments.editor.toasts.no_submission_to_grade', {
                defaultValue: 'This student has no submission for this task yet, there is nothing to grade.',
            }));
            return;
        }
        await applyManualGrade({
            grade,
            feedback,
            maxPoints: assignmentTaskOutsideProvider?.max_grade_value || 100,
            assignmentTaskUUID,
            assignmentUUID: assignment.assignment_object.assignment_uuid,
            accessToken: access_token,
            username: session?.data?.user?.username,
            assignmentTaskSubmissionUUID: userSubmissions.assignment_task_submission_uuid,
            taskSubmissionPayload: userSubmissions,
            onSuccess: () => { getAssignmentTaskSubmissionFromIdentifiedUserUI(); onGraded?.(); },
        });
    }

    async function gradeFC() {
        if (assignmentTaskUUID) {
            // Same trap as the manual path: auto-grading a task the student
            // never submitted has no row to target, so the write lands on the
            // instructor's own (0-scored) row while the toast claims success.
            if (!userSubmissions?.assignment_task_submission_uuid) {
                toast.error(t('dashboard.assignments.editor.toasts.no_submission_to_grade', {
                    defaultValue: 'This student has no submission for this task yet, there is nothing to grade.',
                }));
                return;
            }
            const maxPoints = assignmentTaskOutsideProvider?.max_grade_value || 100;
            // Grade PER QUESTION (mirrors the server's _grade_quiz_task): a
            // question counts only when the student's selected option set exactly
            // matches the answer key. Per-option scoring gave phantom credit for
            // unanswered questions (unselected wrong options "matched"). A
            // question with no correct option is skipped by the server too (a
            // blank submission would "match" an all-false key), so exclude it
            // here or this preview grade drops below the server's.
            const gradableQuestions = questions.filter(
                (q) => (q.options?.length ?? 0) > 0 && q.options.some((o) => !!o.assigned_right_answer)
            );
            let correctQuestions = 0;

            gradableQuestions.forEach((question) => {
                const questionCorrect = question.options.every((option) => {
                    const submission = userSubmissions.submissions.find(
                        (sub) => sub.questionUUID === question.questionUUID && sub.optionUUID === option.optionUUID
                    );
                    const studentAnswer = !!submission?.answer;
                    return studentAnswer === !!option.assigned_right_answer;
                });
                if (questionCorrect) correctQuestions++;
            });

            const finalGrade = gradableQuestions.length > 0
                ? Math.round((correctQuestions / gradableQuestions.length) * maxPoints)
                : 0;

            // Save the grade to the server
            const values = {
                assignment_task_submission_uuid: userSubmissions.assignment_task_submission_uuid,
                task_submission: userSubmissions,
                grade: finalGrade,
                task_submission_grade_feedback: 'Auto graded by system',
                manually_graded: false,
            };

            const res = await handleAssignmentTaskSubmission(values, assignmentTaskUUID, assignment.assignment_object.assignment_uuid, access_token);
            if (res.success) {
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
        // Student area: hydrate from already-fetched context payloads.
        else if (view == 'student') {
            hydrateTaskFromContext();
            // Hydrate the saved submission once, when the batch first resolves.
            // This runs even if the learner already started answering: the
            // baseline + submission uuid are always adopted (so saves target the
            // right row and dirty detection works), while their live answers are
            // preserved. Re-hydrating on later refetches is still skipped so it
            // never clobbers in-progress work.
            if (submissionHydratedForRef.current !== assignmentTaskUUID && taskSubmissionsMap !== null) {
                hydrateSubmissionFromBatch(interactedRef.current);
                submissionHydratedForRef.current = assignmentTaskUUID ?? null;
            }
        }

        // Grading area: per-task fetches are fine here (one task at a time).
        else if (view == 'grading') {
            getAssignmentTaskUI();
            getAssignmentTaskSubmissionFromIdentifiedUserUI();

        }
    }, [assignmentTaskState, assignment, assignmentTaskStateHook, access_token, taskSubmissionsMap]);

    if (questions && questions.length >= 0) {
        return (
            <AssignmentBoxUI submitFC={submitFC} saveFC={saveFC} gradeFC={gradeFC} gradeCustomFC={gradeCustomFC} view={view} currentPoints={userSubmissionObject?.grade} currentFeedback={userSubmissionObject?.task_submission_grade_feedback} maxPoints={assignmentTaskOutsideProvider?.max_grade_value} dirtyValue={serializeSelectedOptions(userSubmissions.submissions)} savedValue={serializeSelectedOptions(initialUserSubmissions.submissions)} taskUUID={assignmentTaskUUID} type="quiz" autoGradable={true}>
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
                                            onClick={() => view === 'student' && !submissionIsGraded && chooseOption(qIndex, oIndex)}
                                            className={"answer outline outline-3 outline-white pe-2 shadow-sm w-full flex items-center space-x-2 h-[30px] hover:bg-opacity-100 hover:shadow-md rounded-lg bg-white text-sm duration-150 ease-linear nice-shadow " + (view == 'student' && !submissionIsGraded ? 'cursor-pointer active:scale-110' : '')}
                                        >
                                            <div className="font-bold text-base flex items-center h-full w-[40px] rounded-s-md text-slate-800 bg-slate-100/80">
                                                <p className="mx-auto font-bold text-sm">{String.fromCharCode(65 + oIndex)}</p>
                                            </div>
                                            {view === 'teacher' ? (
                                                <input
                                                    type="text"
                                                    value={option.text}
                                                    onChange={(e) => handleOptionChange(qIndex, oIndex, e.target.value)}
                                                    placeholder="Option"
                                                    className="w-full mx-2 px-3 pe-6 text-neutral-600 bg-[#00008b00] border-2 border-gray-200 rounded-md border-dotted text-sm font-bold"
                                                />
                                            ) : (
                                                <p className="w-full mx-2 px-3 pe-6 text-neutral-600 bg-[#00008b00] text-sm font-bold">
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
                                            {/* Verdict badge. Only options the learner actually
                                                chose get a right/wrong verdict; the option that
                                                WAS correct is highlighted separately so they can
                                                still learn from the review. Untouched wrong
                                                options get no badge at all — previously every
                                                option was labelled, which read as "you got all
                                                of these wrong". */}
                                            {view === 'student' && revealAnswerKey && (() => {
                                                const selected = isOptionSelected(question.questionUUID, option.optionUUID);
                                                const correct = !!option.assigned_right_answer;
                                                if (!selected && !correct) return null;
                                                if (selected && correct) {
                                                    return (
                                                        <div className="w-fit flex-none flex text-[10px] px-2 py-0.5 space-x-1 items-center h-fit rounded-lg bg-emerald-50 text-emerald-700">
                                                            <Check size={10} />
                                                            <p className='font-bold'>{t('assignments.quiz.correct_answer')}</p>
                                                        </div>
                                                    );
                                                }
                                                if (selected && !correct) {
                                                    return (
                                                        <div className="w-fit flex-none flex text-[10px] px-2 py-0.5 space-x-1 items-center h-fit rounded-lg bg-rose-50 text-rose-600">
                                                            <X size={10} />
                                                            <p className='font-bold'>{t('assignments.quiz.incorrect_answer')}</p>
                                                        </div>
                                                    );
                                                }
                                                // Correct but not chosen — show what the answer was.
                                                return (
                                                    <div className="w-fit flex-none flex text-[10px] px-2 py-0.5 space-x-1 items-center h-fit rounded-lg bg-emerald-50/70 text-emerald-700 border border-emerald-200">
                                                        <Check size={10} />
                                                        <p className='font-bold'>{t('assignments.quiz.correct_answer')}</p>
                                                    </div>
                                                );
                                            })()}
                                            {view === 'student' && (
                                                <div
                                                    className={`w-[20px] flex-none flex items-center h-[20px] rounded-lg ${
                                                        isOptionSelected(question.questionUUID, option.optionUUID)
                                                            ? "bg-green-200/60 text-green-500 hover:bg-green-300"
                                                            : "bg-slate-200/60 text-slate-500 hover:bg-slate-300"
                                                    } text-sm transition-all ease-linear ${submissionIsGraded ? '' : 'cursor-pointer'}`}
                                                    onClick={() => !submissionIsGraded && chooseOption(qIndex, oIndex)}
                                                >
                                                    {isOptionSelected(question.questionUUID, option.optionUUID) ? (
                                                        <Check size={12} className="mx-auto" />
                                                    ) : (
                                                        // While answering this is an empty checkbox. After grading a
                                                        // cross here would look like a verdict on an option the
                                                        // learner never picked, so leave it blank.
                                                        !submissionIsGraded && <X size={12} className="mx-auto" />
                                                    )}
                                                </div>
                                            )}
                                            {view === 'grading' && (
                                                // Marks what the LEARNER chose. The answer key is already
                                                // shown by the "Marked as True/False" badge above, so a
                                                // cross on every unchosen option only added noise.
                                                <div className={`w-[20px] flex-none flex items-center h-[20px] rounded-lg ${
                                                    isOptionSelected(question.questionUUID, option.optionUUID)
                                                        ? "bg-green-200/60 text-green-500"
                                                        : "bg-slate-200/60 text-slate-500"
                                                } text-sm`}>
                                                    {isOptionSelected(question.questionUUID, option.optionUUID) && (
                                                        <Check size={12} className="mx-auto" />
                                                    )}
                                                </div>
                                            )}

                                        </div>
                                        {view === 'teacher' && oIndex === question.options.length - 1 && questions[qIndex].options.length <= 4 && (
                                            <div className="flex justify-center mx-auto px-2">
                                                <div
                                                    className="outline text-xs outline-3 outline-white px-2 shadow-sm w-full flex items-center h-[30px] hover:bg-opacity-100 hover:shadow-md rounded-lg bg-white duration-150 cursor-pointer ease-linear nice-shadow"
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
    else {
        return <div className='flex flex-row space-x-2 text-sm items-center'>
            <Info size={12} />
            <p>No questions found</p>
        </div>;
    }
}

export default TaskQuizObject;
