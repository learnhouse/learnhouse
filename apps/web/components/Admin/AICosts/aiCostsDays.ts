import type { AICostDayRow } from '@services/ee/platform/types'

/** Every day of the window (UTC dates), zeros where nothing was charged. */
export function fillDays(from: string | undefined, to: string | undefined, rows: AICostDayRow[]): AICostDayRow[] {
  if (!from || !to) return rows
  const byDate = new Map(rows.map((r) => [r.date, r]))
  const out: AICostDayRow[] = []
  const end = new Date(to.slice(0, 10) + 'T00:00:00Z')
  for (let d = new Date(from.slice(0, 10) + 'T00:00:00Z'); d <= end && out.length < 400; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10)
    out.push(
      byDate.get(key) ?? { date: key, requests: 0, credits: 0, value_usd: 0, cost_usd: 0, margin_multiple: null, gross_margin_pct: null, below_floor: false }
    )
  }
  return out
}
