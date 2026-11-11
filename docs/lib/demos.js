import catalog from '@/components/headless/demos.json'

// Where the live demos run. In development that's the headless-examples dev
// server; in production, the deployed demos app (set NEXT_PUBLIC_DEMOS_URL).
export const DEMOS_URL =
  process.env.NEXT_PUBLIC_DEMOS_URL || (process.env.NODE_ENV === 'development' ? 'http://localhost:3100' : '')

export const DEMOS_REPO = 'https://github.com/learnhouse/headless-examples'

export const { demos, sections } = catalog

export function getDemo(id) {
  const i = demos.findIndex((d) => d.id === id)
  if (i === -1) return null
  return {
    demo: demos[i],
    section: sections.find((s) => s.id === demos[i].section),
    prev: demos[(i - 1 + demos.length) % demos.length],
    next: demos[(i + 1) % demos.length],
    liveUrl: DEMOS_URL ? `${DEMOS_URL.replace(/\/$/, '')}/${demos[i].id}` : null,
  }
}
