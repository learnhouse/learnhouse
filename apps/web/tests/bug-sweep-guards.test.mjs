// Guards against requests built from ids that haven't loaded yet, and the
// feature gate used before fetching plan-gated data. All ids are synthetic.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  getActivityBlockMediaDirectory,
  getCourseThumbnailMediaDirectory,
  hasMediaIds,
} from '../services/media/media.ts'
import { isMissingActivityId } from '../services/courses/activities.ts'
import { isOrgFeatureEnabled } from '../lib/features/orgFeature.ts'

const realWindow = globalThis.window

beforeEach(() => {
  globalThis.window = {
    location: { hostname: 'school.platform.test', host: 'school.platform.test' },
    __RUNTIME_CONFIG__: {
      NEXT_PUBLIC_LEARNHOUSE_DOMAIN: 'platform.test',
      NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL: 'https://api.platform.test/',
    },
  }
})

afterEach(() => {
  globalThis.window = realWindow
})

describe('media URL builders while ids are loading', () => {
  test('missing ids are detected before a URL is built', () => {
    for (const org of ['', undefined, null, 'undefined', 'null']) {
      expect(hasMediaIds(org, 'course_1')).toBe(false)
    }
    expect(hasMediaIds('org_1', '')).toBe(false)
    expect(hasMediaIds('org_1', 'course_1', 'activity_1')).toBe(true)
  })

  test('builders keep their return values (the SDK compiles them in)', () => {
    expect(getCourseThumbnailMediaDirectory('org_1', 'course_1', 'thumb.png')).toBe(
      'https://api.platform.test/content/orgs/org_1/courses/course_1/thumbnails/thumb.png',
    )
    expect(getActivityBlockMediaDirectory('org_1', 'course_1', 'activity_1', 'block_1', 'i.png', 'imageBlock')).toContain(
      'content/orgs/org_1/courses/course_1/activities/activity_1/dynamic/blocks/imageBlock/block_1/i.png',
    )
  })
})

describe('activity ids', () => {
  test('stringified missing values are not activity ids', () => {
    for (const id of ['', 'null', 'undefined', 'activity_null', null, undefined, '  ']) {
      expect(isMissingActivityId(id)).toBe(true)
    }
    expect(isMissingActivityId('abc123')).toBe(false)
    expect(isMissingActivityId('activity_abc123')).toBe(false)
  })
})

describe('resolved feature gate', () => {
  test('only an explicitly enabled feature counts', () => {
    const org = (live) => ({ config: { config: { resolved_features: { live_sessions: live } } } })
    expect(isOrgFeatureEnabled(org({ enabled: true }), 'live_sessions')).toBe(true)
    expect(isOrgFeatureEnabled(org({ enabled: false }), 'live_sessions')).toBe(false)
    expect(isOrgFeatureEnabled(org(undefined), 'live_sessions')).toBe(false)
    expect(isOrgFeatureEnabled(null, 'live_sessions')).toBe(false)
  })
})
