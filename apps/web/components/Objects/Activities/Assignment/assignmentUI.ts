// Shared learner-facing styles for assignment tasks, so every task type
// (quiz, short answer, number, file, form, code) reads as one form.

/** Fired to open the hand-in confirmation from the inline panel at the end of the tasks. */
export const ASSIGNMENT_SUBMIT_EVENT = 'lh:assignment-submit'

export const answerInputClass =
  'w-full h-12 md:h-11 rounded-xl border border-neutral-200 bg-white px-4 text-base md:text-sm text-neutral-900 ' +
  'placeholder:text-neutral-400 outline-none transition-[border-color,box-shadow] ' +
  'focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 read-only:bg-neutral-50 read-only:text-neutral-600 read-only:focus:ring-0 read-only:focus:border-neutral-200'

export const promptTextClass = 'text-sm leading-relaxed text-neutral-600 whitespace-pre-wrap'

export const answerKeyPanelClass = 'flex flex-col gap-1.5 rounded-xl border border-emerald-200/70 bg-emerald-50/70 p-3'

// Whether a saved task submission holds an actual answer. Covers every task
// payload shape: free text / number ({ answer }), quiz ({ submissions }),
// file ({ fileUUID }), code ({ code }) and fill-in forms ({ submissions }).
export function taskSubmissionHasAnswer(taskSubmission: any): boolean {
  const ts = taskSubmission?.task_submission ?? taskSubmission
  if (!ts || typeof ts !== 'object') return false
  if (typeof ts.answer === 'string' && ts.answer.trim()) return true
  if (typeof ts.answer === 'number') return true
  if (ts.fileUUID) return true
  if (typeof ts.code === 'string' && ts.code.trim()) return true
  if (Array.isArray(ts.submissions)) {
    return ts.submissions.some(
      (s: any) => s?.answer === true || (typeof s?.answer === 'string' && s.answer.trim().length > 0)
    )
  }
  return false
}
