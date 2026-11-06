const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})
const shortFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

const valid = (iso) => iso && !Number.isNaN(new Date(iso).getTime())

export const formatDate = (iso) => (valid(iso) ? dateFmt.format(new Date(iso)) : '')
export const formatShortDate = (iso) => (valid(iso) ? shortFmt.format(new Date(iso)) : '')
export const formatMonth = (iso) => (valid(iso) ? monthFmt.format(new Date(iso)) : 'Undated')

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const releaseTitle = (r) => (r.kind === 'cli' ? `CLI ${r.version}` : `LearnHouse ${r.version}`)

/** The documented way to get onto a given release. */
export const releaseCommand = (r) =>
  r.kind === 'cli' ? `npx learnhouse@${r.version}` : `npx learnhouse update --to ${r.version}`
