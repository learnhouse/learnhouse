import toast from 'react-hot-toast'

// Learner-facing URL of an assignment's activity. Same path the "Preview"
// button opens, so the copied link always matches what the teacher sees.
export function assignmentLearnerPath(courseUuid?: string | null, activityUuid?: string | null): string | null {
  if (!courseUuid || !activityUuid) return null
  return `/course/${courseUuid.replace('course_', '')}/activity/${activityUuid.replace('activity_', '')}`
}

export async function copyAssignmentLink(path: string, t: (_key: string) => string) {
  try {
    await navigator.clipboard.writeText(new URL(path, window.location.origin).toString())
    toast.success(t('dashboard.assignments.list.link_copied'))
  } catch {
    toast.error(t('dashboard.assignments.list.link_copy_failed'))
  }
}
