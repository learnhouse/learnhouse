import toast from 'react-hot-toast'
import { handleAssignmentTaskSubmission } from '@services/courses/assignments'

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
}: ApplyManualGradeArgs): Promise<void> {
    if (!assignmentTaskUUID) return
    if (Number.isNaN(grade) || grade < 0) {
        toast.error('Grade must be a positive number.')
        return
    }
    if (grade > maxPoints) {
        toast.error(`Grade cannot be more than ${maxPoints} points`)
        return
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
    if (res) {
        onSuccess()
        toast.success(`Task graded successfully with ${grade} points`)
    } else {
        toast.error('Error grading task, please retry later.')
    }
}
