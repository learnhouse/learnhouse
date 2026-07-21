// Canonical serializations of task answers for the value-driven auto-save.
//
// Two answers with the same MEANING must serialize to the same string,
// regardless of array order or partial-vs-complete representation — otherwise a
// hydrated "full" server answer would look different from the learner's
// "partial" edit and either save spuriously or (worse) never settle. Equally,
// distinct answers must never collide, so free-text values go through
// JSON.stringify rather than delimiter joins.

export const serializeSelectedOptions = (
  subs?: { questionUUID?: string; optionUUID?: string; answer?: boolean }[]
): string =>
  (subs ?? [])
    .filter((s) => s.answer)
    .map((s) => `${s.questionUUID}|${s.optionUUID}`)
    .sort()
    .join(',')

export const serializeBlankAnswers = (
  subs?: { questionUUID?: string; blankUUID?: string; answer?: string }[]
): string =>
  JSON.stringify(
    (subs ?? [])
      .filter((s) => (s.answer ?? '').length > 0)
      .map((s) => [s.questionUUID, s.blankUUID, s.answer])
      .sort((a, b) => (a[0]! + a[1]! < b[0]! + b[1]! ? -1 : 1))
  )
