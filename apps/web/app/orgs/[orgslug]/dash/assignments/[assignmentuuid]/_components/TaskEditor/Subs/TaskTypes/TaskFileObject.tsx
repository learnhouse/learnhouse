import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { useAssignmentSubmission, useAssignmentTaskSubmissions } from '@components/Contexts/Assignments/AssignmentSubmissionContext';
import { useAssignmentsTaskDispatch } from '@components/Contexts/Assignments/AssignmentsTaskContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useOrg } from '@components/Contexts/OrgContext';
import AssignmentBoxUI from '@components/Objects/Activities/Assignment/AssignmentBoxUI'
import { getAssignmentTask, getAssignmentTaskSubmissionsUser, handleAssignmentTaskSubmission, updateSubFile } from '@services/courses/assignments';
import { getTaskFileSubmissionDir } from '@services/media/media';
import { Cloud, DownloadSimple, File as FileIcon, Info, CircleNotch, Lock, CloudArrowUp } from '@phosphor-icons/react'
import Link from 'next/link';
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { applyManualGrade } from './applyManualGrade';

type FileSchema = {
    fileUUID: string;
    assignment_task_submission_uuid?: string;
};

type TaskFileObjectProps = {
    view: 'teacher' | 'student' | 'grading' | 'custom-grading';
    assignmentTaskUUID?: string;
    user_id?: string;
    onGraded?: () => void;
};

export default function TaskFileObject({ view, user_id, assignmentTaskUUID, onGraded }: TaskFileObjectProps) {
    const { t } = useTranslation()
    const session = useLHSession() as any;
    const org = useOrg() as any;
    const access_token = session?.data?.tokens?.access_token;
    const [isLoading, setIsLoading] = React.useState(false);
    const [localUploadFile, setLocalUploadFile] = React.useState<File | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [assignmentTask, setAssignmentTask] = React.useState<any>(null);
    const assignmentTaskStateHook = useAssignmentsTaskDispatch() as any;
    const assignment = useAssignments() as any;
    const taskSubmissionsMap = useAssignmentTaskSubmissions();
    const queryClient = useQueryClient();

    // Student lock: same derivation as AssignmentBoxUI's `canStudentSave` and
    // the sibling task types (see TaskShortAnswerObject). The upload endpoint
    // only enforces the deadline: it returns a file_uuid and writes NO
    // submission row, so the new file is persisted purely by auto-save. Once
    // the submission is SUBMITTED/GRADED auto-save is off, meaning a fresh
    // upload would show a green success chip but be lost on reload while the
    // teacher grades the OLD file. So the upload has to be gated too.
    const assignmentSubmission = useAssignmentSubmission() as any;
    const latestSubmissionStatus =
        Array.isArray(assignmentSubmission) && assignmentSubmission.length > 0
            ? assignmentSubmission[0]?.submission_status
            : null;
    const submissionIsGraded = latestSubmissionStatus === 'GRADED';
    const canStudentSave =
        !submissionIsGraded && latestSubmissionStatus !== 'SUBMITTED';

    /* TEACHER VIEW CODE */
    /* TEACHER VIEW CODE */

    /* STUDENT VIEW CODE */
    const [userSubmissions, setUserSubmissions] = useState<FileSchema>({
        fileUUID: '',
    });
    const [initialUserSubmissions, setInitialUserSubmissions] = useState<FileSchema>({
        fileUUID: '',
    });
    // Hydrate the student's saved submission exactly once (see call site), so
    // later query refetches can't overwrite in-progress edits and stop auto-save.
    const submissionHydratedForRef = React.useRef<string | null>(null);
    const interactedRef = React.useRef(false);

    const handleFileChange = async (event: any) => {
        // Defense in depth: the input is not rendered once the submission is
        // SUBMITTED/GRADED, but a stale/duplicated node must not slip an upload
        // through that could never be persisted (see canStudentSave above).
        if (view === 'student' && !canStudentSave) {
            return;
        }
        interactedRef.current = true;
        // Check if user is authenticated
        if (!access_token) {
            setError(t('dashboard.assignments.editor.task_editor.general.auth_required'));
            return;
        }

        const file = event.target.files[0]

        setLocalUploadFile(file)
        setIsLoading(true)
        const res = await updateSubFile(
            file,
            assignmentTask.assignment_task_uuid,
            assignment.assignment_object.assignment_uuid,
            access_token
        )

        // wait for 1 second to show loading animation
        await new Promise((r) => setTimeout(r, 1500))
        if (res.success === false) {
            setError(res.data.detail)
            setIsLoading(false)
        } else {
            assignmentTaskStateHook({ type: 'reload' })
            // Only the file uuid comes back from this endpoint: it uploads the
            // file and does NOT create/return a submission row. Reading
            // `assignment_task_submission_uuid` off this response yielded
            // undefined and wiped the existing submission uuid, so the follow-up
            // auto-save created a duplicate row instead of updating the current
            // one. Keep whatever uuid we already hold.
            setUserSubmissions((prev) => ({
                ...prev,
                fileUUID: res.data.file_uuid,
            }))
            queryClient.invalidateQueries({ queryKey: queryKeys.assignments.taskSubmission(assignment.assignment_object.assignment_uuid) });
            setIsLoading(false)
            setError('')
        }
    }

    // Hydrate from the batch task-submissions cache instead of calling
    // /submissions/me per task. Re-runs when the batch payload arrives.
    function hydrateSubmissionFromBatch(preserveLiveAnswers = false) {
        if (!assignmentTaskUUID) return;
        const sub = taskSubmissionsMap?.[assignmentTaskUUID] ?? null;
        if (sub) {
            // Always seed the saved baseline so dirty detection is correct.
            setInitialUserSubmissions({
                ...sub.task_submission,
                assignment_task_submission_uuid: sub.assignment_task_submission_uuid,
            });
            if (preserveLiveAnswers) {
                // Learner interacted before the batch resolved, so keep their live
                // answer but adopt the server submission uuid so a save updates
                // the existing row instead of creating a duplicate.
                setUserSubmissions((prev: any) => ({
                    ...prev,
                    assignment_task_submission_uuid: sub.assignment_task_submission_uuid,
                }));
            } else {
                setUserSubmissions({
                    ...sub.task_submission,
                    assignment_task_submission_uuid: sub.assignment_task_submission_uuid,
                });
            }
        }
    }

    const submitFC = async (opts?: { silent?: boolean }) => {
        // Check if user is authenticated
        if (!access_token) {
            if (!opts?.silent) toast.error(t('dashboard.assignments.editor.task_editor.general.auth_required_submit'));
            return false;
        }

        // Save the file submission to the server
        const values = {
            assignment_task_submission_uuid: userSubmissions.assignment_task_submission_uuid || null,
            task_submission: userSubmissions,
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
                // Baseline = what we sent; live = latest (from prev), never reverted
                // to the call-time snapshot, so a change during the save survives.
                setInitialUserSubmissions({ ...userSubmissions, assignment_task_submission_uuid: savedUUID });
                setUserSubmissions(prev => ({ ...prev, assignment_task_submission_uuid: savedUUID }));
                // Keep the shared batch cache current with the saved file UUID,
                // even on a silent save. Without this the 60s-cached batch still
                // holds the pre-upload submission, so a remount re-hydrates the
                // old file UUID and the next save persists the stale one.
                queryClient.setQueryData(
                    queryKeys.assignments.taskSubmission(assignment.assignment_object.assignment_uuid),
                    (old: any) => (old ? { ...old, [assignmentTaskUUID]: res.data ?? old[assignmentTaskUUID] } : old)
                );
                return true;
            } else {
                if (!opts?.silent) toast.error(t('dashboard.assignments.editor.toasts.task_save_error'));
                return false;
            }
        }
        return true;
    };

    // Used only by grading view; student view hydrates from useAssignments() context
    async function getAssignmentTaskUI() {
        if (!access_token) {
            return;
        }

        if (assignmentTaskUUID) {
            const res = await getAssignmentTask(assignmentTaskUUID, access_token);
            if (res.success) {
                setAssignmentTask(res.data);
                setAssignmentTaskOutsideProvider(res.data);
            }
        }
    }

    function hydrateTaskFromContext() {
        if (!assignmentTaskUUID) return;
        const task = assignment?.assignment_tasks?.find(
            (t: any) => t.assignment_task_uuid === assignmentTaskUUID
        );
        if (task) {
            setAssignmentTask(task);
            setAssignmentTaskOutsideProvider(task);
        }
    }

    /* STUDENT VIEW CODE */

    /* GRADING VIEW CODE */
    const [userSubmissionObject, setUserSubmissionObject] = useState<any>(null);
    async function getAssignmentTaskSubmissionFromIdentifiedUserUI() {
        if (!access_token) {
            // Silently fail if not authenticated
            return;
        }
        
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
        // Same guard as the sibling task types (TaskShortAnswerObject:259).
        // Without an existing submission uuid the grade is written against the
        // INSTRUCTOR's own row, where it is silently forced to 0 while the UI
        // reports success, so refuse instead of grading a phantom submission.
        if (!userSubmissions?.assignment_task_submission_uuid) {
            toast.error(t('assignments.no_task_submission_to_grade', {
                defaultValue: 'This student has not submitted a file for this task yet.',
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
            assignmentTaskSubmissionUUID: userSubmissions?.assignment_task_submission_uuid,
            taskSubmissionPayload: userSubmissions,
            onSuccess: () => { getAssignmentTaskSubmissionFromIdentifiedUserUI(); onGraded?.(); },
        });
    }

    /* GRADING VIEW CODE */
    const [assignmentTaskOutsideProvider, setAssignmentTaskOutsideProvider] = useState<any>(null);
    useEffect(() => {
        /* eslint-disable react-hooks/set-state-in-effect */
        // Student area: hydrate from already-fetched context payloads.
        if (view === 'student') {
            hydrateTaskFromContext()
            // Hydrate the saved submission only once (when the batch first
            // resolves). Re-hydrating on later refetches would clobber the
            // learner's in-progress submission and stop auto-save.
            if (taskSubmissionsMap !== null && submissionHydratedForRef.current !== assignmentTaskUUID) {
                hydrateSubmissionFromBatch(interactedRef.current)
                submissionHydratedForRef.current = assignmentTaskUUID ?? null
            }
        }

        // Grading area: per-task fetches are fine here (one task at a time).
        else if (view == 'custom-grading') {
            getAssignmentTaskUI();
            getAssignmentTaskSubmissionFromIdentifiedUserUI();
        }
        /* eslint-enable react-hooks/set-state-in-effect */
    }, [view, assignmentTaskUUID, assignment?.assignment_tasks, taskSubmissionsMap])

    return (
        <AssignmentBoxUI submitFC={submitFC} dirtyValue={userSubmissions.fileUUID ?? ''} savedValue={initialUserSubmissions.fileUUID ?? ''} taskUUID={assignmentTaskUUID} view={view} gradeCustomFC={gradeCustomFC} currentPoints={userSubmissionObject?.grade} currentFeedback={userSubmissionObject?.task_submission_grade_feedback} maxPoints={assignmentTaskOutsideProvider?.max_grade_value} type="file">
            {view === 'teacher' && (
                <div className='flex flex-col sm:flex-row py-5 sm:py-6 text-xs sm:text-sm justify-center mx-auto space-y-2 sm:space-y-0 sm:space-x-3 text-slate-600 px-4 sm:px-2 text-center sm:text-start bg-slate-50 rounded-lg border border-slate-100'>
                    <Info size={18} className="mx-auto sm:mx-0 text-slate-500" />
                    <p>{t('dashboard.assignments.editor.task_editor.file.teacher_hint')}</p>
                </div>
            )}
            {view === 'custom-grading' && (
                <div className='flex flex-col space-y-4 w-full px-2 sm:px-0'>
                    {/* On a formative assignment there is no grade to input, so
                        the instruction to enter one would be wrong. */}
                    <div className='flex flex-col sm:flex-row py-5 sm:py-6 text-xs sm:text-sm justify-center mx-auto space-y-2 sm:space-y-0 sm:space-x-3 text-slate-600 px-4 sm:px-2 text-center sm:text-start bg-slate-50 rounded-lg border border-slate-100'>
                        <DownloadSimple size={18} className="mx-auto sm:mx-0 text-slate-500" />
                        <p>
                            {assignment?.assignment_object?.ungraded
                                ? t('dashboard.assignments.submissions.download_to_review', { defaultValue: 'Download the file to review what the learner handed in.' })
                                : t('dashboard.assignments.submissions.download_to_grade', { defaultValue: 'Please download the file and grade it manually, then input the grade above' })}
                        </p>
                    </div>
                    {userSubmissions.fileUUID && !isLoading && assignmentTaskUUID && (
                        <Link
                            href={getTaskFileSubmissionDir(org?.org_uuid, assignment.course_object.course_uuid, assignment.activity_object.activity_uuid, assignment.assignment_object.assignment_uuid, assignmentTaskUUID, userSubmissions.fileUUID)}
                            target='_blank'
                            className='flex flex-col rounded-lg bg-white text-gray-500 shadow-xs hover:shadow-md transition-shadow border border-gray-100 px-4 sm:px-5 py-4 space-y-1 items-center relative w-full sm:w-auto mx-auto'>
                            <div className='absolute top-0 end-0 transform translate-x-1/2 -translate-y-1/2 bg-emerald-500 rounded-full p-1.5 text-white flex justify-center items-center shadow-xs'>
                                <Cloud size={14} />
                            </div>

                            <div className='flex space-x-2 mt-2 items-center'>
                                <FileIcon size={18} className="text-emerald-500" />
                                <div className='font-medium text-xs sm:text-sm uppercase break-all'>
                                    {`${userSubmissions.fileUUID.slice(0, 8)}...${userSubmissions.fileUUID.slice(-4)}`}
                                </div>
                            </div>
                        </Link>
                    )}
                </div>
            )}
            {view === 'student' && (() => {
                const inputId = 'fileInput_' + assignmentTaskUUID
                const fileName = localUploadFile?.name
                    ?? (userSubmissions.fileUUID ? `${userSubmissions.fileUUID.slice(0, 8)}…${userSubmissions.fileUUID.slice(-4)}` : null)
                const canUpload = !!access_token && canStudentSave && !isLoading
                const pick = () => document.getElementById(inputId)?.click()
                return (
                    <div className='flex flex-col gap-3'>
                        {error && (
                            <div className='rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700'>{error}</div>
                        )}
                        <input type='file' id={inputId} className='hidden' onChange={handleFileChange} disabled={!canUpload} />

                        {fileName && !isLoading ? (
                            // Uploaded: one row with the file and a way to replace it.
                            <div className='flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3'>
                                <span className='flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-teal-50 text-teal-600'>
                                    <FileIcon size={18} />
                                </span>
                                <div className='min-w-0 flex-1'>
                                    <p className='truncate text-sm font-semibold text-neutral-900'>{fileName}</p>
                                    <p className='flex items-center gap-1 text-xs text-neutral-500'>
                                        <Cloud size={12} className='text-teal-600' />
                                        {t('dashboard.assignments.editor.task_editor.file.uploaded', { defaultValue: 'Uploaded' })}
                                    </p>
                                </div>
                                {canUpload && (
                                    <button type='button' onClick={pick} className='h-9 flex-none rounded-xl bg-neutral-100 px-3 text-xs font-semibold text-neutral-800 transition-colors hover:bg-neutral-200'>
                                        {t('dashboard.assignments.editor.task_editor.file.replace', { defaultValue: 'Replace' })}
                                    </button>
                                )}
                            </div>
                        ) : access_token && !canStudentSave ? (
                            // Handed in without a file: nothing to drop anything into any more.
                            <div className='flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-500'>
                                <span className='flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-white text-neutral-400'>
                                    <FileIcon size={18} />
                                </span>
                                {t('dashboard.assignments.editor.task_editor.file.no_file', { defaultValue: 'No file submitted' })}
                            </div>
                        ) : (
                            // Empty: a drop zone that is also one big button.
                            <button
                                type='button'
                                disabled={!canUpload}
                                onClick={pick}
                                onDragOver={(e) => { if (canUpload) e.preventDefault() }}
                                onDrop={(e) => {
                                    if (!canUpload) return
                                    e.preventDefault()
                                    if (e.dataTransfer.files?.length) handleFileChange({ target: { files: e.dataTransfer.files } })
                                }}
                                className='flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50/60 px-4 py-7 text-center transition-colors enabled:hover:border-teal-400 enabled:hover:bg-teal-50/40 disabled:cursor-not-allowed'
                            >
                                <span className='flex h-11 w-11 items-center justify-center rounded-full bg-white text-neutral-500 nice-shadow'>
                                    {isLoading ? <CircleNotch size={18} className='animate-spin' /> : <CloudArrowUp size={18} />}
                                </span>
                                <span className='text-sm font-semibold text-neutral-900'>
                                    {isLoading
                                        ? t('dashboard.assignments.editor.task_editor.general.loading')
                                        : t('dashboard.assignments.editor.task_editor.file.submit_file')}
                                </span>
                                <span className='text-xs text-neutral-500'>{t('dashboard.assignments.editor.task_editor.general.allowed_formats')}</span>
                            </button>
                        )}

                        {!access_token && (
                            <p className='flex items-center gap-1.5 text-xs font-medium text-amber-700'>
                                <Info size={13} />
                                {t('dashboard.assignments.editor.task_editor.general.sign_in_required')}
                            </p>
                        )}
                        {access_token && !canStudentSave && (
                            // Locked: uploading now would look successful but could
                            // never be persisted (auto-save is off once
                            // SUBMITTED/GRADED), so the teacher would keep grading
                            // the previous file.
                            <p className='flex items-center gap-1.5 text-xs font-medium text-neutral-500'>
                                <Lock size={13} />
                                {submissionIsGraded
                                    ? t('dashboard.assignments.editor.task_editor.general.upload_locked_graded', {
                                        defaultValue: 'This submission has been graded; your file can no longer be changed.',
                                    })
                                    : t('dashboard.assignments.editor.task_editor.general.upload_locked_submitted', {
                                        defaultValue: 'You have submitted this assignment; your file can no longer be changed.',
                                    })}
                            </p>
                        )}
                    </div>
                )
            })()}
        </AssignmentBoxUI>
    )
}
