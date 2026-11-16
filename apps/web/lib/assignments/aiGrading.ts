// AI grading on an assignment: OFF, SUGGEST (drafts a teacher reviews) or
// AUTO (graded on hand-in). Rows written before the field existed read as
// SUGGEST, the API default, which never spends credits on its own.
export type AIGradingMode = 'OFF' | 'SUGGEST' | 'AUTO'

export function aiGradingModeOf(assignment: { ai_grading_mode?: string | null } | null | undefined): AIGradingMode {
  const mode = assignment?.ai_grading_mode
  return mode === 'OFF' || mode === 'AUTO' ? mode : 'SUGGEST'
}

/** AI grading is offered on graded assignments whose mode is not OFF. */
export function aiGradingEnabled(assignment: { ai_grading_mode?: string | null; ungraded?: boolean | null } | null | undefined): boolean {
  return !!assignment && !assignment.ungraded && aiGradingModeOf(assignment) !== 'OFF'
}
