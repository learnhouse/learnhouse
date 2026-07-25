import toast from 'react-hot-toast'
import { handleAssignmentTaskSubmission } from '@services/courses/assignments'
import i18n from '@/lib/i18n'

/**
 * Why a manual grade didn't go through. Returned (instead of silently doing
 * nothing) so a caller can surface a real failure rather than assume success.
 */
export type ManualGradeFailure =
    | 'missing-task'
    | 'invalid-grade'
    | 'grade-above-max'
    | 'missing-submission'
    | 'request-failed'

export type ManualGradeResult =
    | { success: true }
    | { success: false; reason: ManualGradeFailure }

interface ApplyManualGradeArgs {
    grade: number
    feedback?: string
    maxPoints: number
    assignmentTaskUUID?: string | null
    assignmentUUID: string
    accessToken: string
    username?: string | null
    assignmentTaskSubmissionUUID?: string | null
    /**
     * Value persisted into the `task_submission` JSON field on the server. Each
     * task type stores a slightly different shape here, so callers pass it in.
     */
    taskSubmissionPayload: unknown
    onSuccess: () => void
}

export async function applyManualGrade({
    grade,
    feedback,
    maxPoints,
    assignmentTaskUUID,
    assignmentUUID,
    accessToken,
    username,
    assignmentTaskSubmissionUUID,
    taskSubmissionPayload,
    onSuccess,
}: ApplyManualGradeArgs): Promise<ManualGradeResult> {
    if (!assignmentTaskUUID) return { success: false, reason: 'missing-task' }
    if (Number.isNaN(grade) || grade < 0) {
        toast.error('Grade must be a positive number.')
        return { success: false, reason: 'invalid-grade' }
    }
    if (grade > maxPoints) {
        toast.error(`Grade cannot be more than ${maxPoints} points`)
        return { success: false, reason: 'grade-above-max' }
    }
    // Defence in depth for every task type: with no target submission row the
    // API falls back to a branch keyed on the SUBMITTER — the instructor —
    // creating a phantom instructor-owned row that is forced to 0 while the UI
    // cheerfully reported "Task graded successfully". Refuse loudly instead.
    if (!assignmentTaskSubmissionUUID) {
        toast.error(i18n.t('dashboard.assignments.editor.toasts.no_submission_to_grade', {
            defaultValue: 'This student has no submission for this task yet, there is nothing to grade.',
        }))
        return { success: false, reason: 'missing-submission' }
    }
    const trimmed = feedback?.trim()
    const finalFeedback = trimmed && trimmed.length > 0
        ? trimmed
        : `Graded by teacher : @${username ?? ''}`
    const values = {
        assignment_task_submission_uuid: assignmentTaskSubmissionUUID,
        task_submission: taskSubmissionPayload,
        grade,
        task_submission_grade_feedback: finalFeedback,
        manually_graded: true,
    }
    const res = await handleAssignmentTaskSubmission(
        values,
        assignmentTaskUUID,
        assignmentUUID,
        accessToken,
    )
    if (res.success) {
        onSuccess()
        toast.success(`Task graded successfully with ${grade} points`)
        return { success: true }
    }
    toast.error('Error grading task, please retry later.')
    return { success: false, reason: 'request-failed' }
}
