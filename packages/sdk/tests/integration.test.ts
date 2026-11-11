// Runs against a live LearnHouse API. Skipped automatically when nothing
// answers at LEARNHOUSE_SDK_IT_URL (default http://localhost:1338).
//   LEARNHOUSE_SDK_IT_URL   API origin
//   LEARNHOUSE_SDK_IT_ORG   org slug with at least one public course (default "default")
import { describe, expect, it } from 'vitest'
import { createClient, LearnHouseError } from '../src'

declare const process: { env: Record<string, string | undefined> }

const BASE = process.env.LEARNHOUSE_SDK_IT_URL || 'http://localhost:1338'
const ORG = process.env.LEARNHOUSE_SDK_IT_ORG || 'default'

async function reachable(): Promise<boolean> {
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 1500)
    const res = await fetch(`${BASE}/api/v1/health`, { signal: ac.signal })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

const up = await reachable()

describe.skipIf(!up)(`integration against ${BASE}`, () => {
  const client = createClient({ baseUrl: BASE, timeoutMs: 15_000 })

  it('reads an org, its courses, a course structure and an activity anonymously', async () => {
    const org = await client.orgs.get(ORG)
    expect(org.slug).toBe(ORG)
    expect(org.org_uuid).toMatch(/^org_/)

    const courses = await client.courses.list(ORG, { limit: 5 })
    expect(Array.isArray(courses)).toBe(true)
    if (!courses.length) return

    const course = await client.courses.get(courses[0].course_uuid as string)
    expect(course.course_uuid).toBe(courses[0].course_uuid)

    const meta = await client.courses.getMeta(course.course_uuid as string, { slim: true })
    expect(Array.isArray(meta.chapters)).toBe(true)

    const firstActivityUuid = meta.chapters
      .flatMap((ch) => (Array.isArray(ch.activities) ? (ch.activities as unknown[]) : []))
      .map((a) => (a as { activity_uuid?: unknown } | null)?.activity_uuid)
      .find((u): u is string => typeof u === 'string')
    if (firstActivityUuid) {
      const activity = await client.activities.get(firstActivityUuid)
      expect(activity.activity_uuid).toBe(firstActivityUuid)
      expect(activity).toHaveProperty('content')
    }

    const thumb = client.media.getCourseThumbnailMediaDirectory(org.org_uuid as string, course.course_uuid as string, 'x.png')
    expect(thumb.startsWith(`${BASE}/content/orgs/`)).toBe(true)
  })

  it('maps a real 404 to LearnHouseError', async () => {
    const err = await client.courses.get('course_does-not-exist-sdk-test').catch((e) => e)
    expect(err).toBeInstanceOf(LearnHouseError)
    expect([403, 404]).toContain(err.status)
    expect(err.path).toBe('/api/v1/courses/{course_uuid}')
  })

  it('rejects an anonymous caller on a user-only route', async () => {
    const err = await client.trail.get().catch((e) => e)
    expect(err).toBeInstanceOf(LearnHouseError)
    expect(err.status).toBe(401)
  })
})
