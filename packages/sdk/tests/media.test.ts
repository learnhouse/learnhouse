import { describe, expect, it } from 'vitest'
import { bindMedia, createClient, media } from '../src'

describe('media helpers (compiled from apps/web/services/media/media.ts)', () => {
  it('builds content URLs on baseUrl when no mediaUrl is set', () => {
    const client = createClient({ baseUrl: 'https://api.example.com' })
    expect(client.media.getCourseThumbnailMediaDirectory('org_1', 'course_1', 'thumb.png')).toBe(
      'https://api.example.com/content/orgs/org_1/courses/course_1/thumbnails/thumb.png',
    )
    expect(client.media.getUserAvatarMediaDirectory('user_1', 'a.jpg')).toBe(
      'https://api.example.com/content/users/user_1/avatars/a.jpg',
    )
  })

  it('uses mediaUrl for content and baseUrl for streams', () => {
    const client = createClient({ baseUrl: 'https://api.example.com/', mediaUrl: 'https://cdn.example.com' })
    expect(client.media.getOrgLogoMediaDirectory('org_1', 'logo.png')).toBe(
      'https://cdn.example.com/content/orgs/org_1/logos/logo.png',
    )
    expect(client.media.getActivityVideoStreamUrl('org_1', 'course_1', 'activity_1', 'v.mp4')).toBe(
      'https://api.example.com/api/v1/stream/video/org_1/course_1/activity_1/v.mp4',
    )
    expect(client.media.getActivityHlsMasterUrl('org_1', 'course_1', 'activity_1')).toBe(
      'https://api.example.com/api/v1/stream/hls/org_1/course_1/activity_1/master.m3u8',
    )
  })

  it('handles block and activity media by type', () => {
    const m = bindMedia({ baseUrl: 'http://localhost:1338' })
    expect(m.getActivityBlockMediaDirectory('org_1', 'course_1', 'activity_1', 'block_1', 'f.pdf', 'pdfBlock')).toBe(
      'http://localhost:1338/content/orgs/org_1/courses/course_1/activities/activity_1/dynamic/blocks/pdfBlock/block_1/f.pdf',
    )
    expect(m.getActivityMediaDirectory('org_1', 'course_1', 'activity_1', 'v.mp4', 'video')).toBe(
      'http://localhost:1338/content/orgs/org_1/courses/course_1/activities/activity_1/video/v.mp4',
    )
    expect(m.getActivityMediaDirectory('org_1', 'course_1', 'activity_1', 'v.mp4', 'unknown')).toBeUndefined()
  })

  it('keeps clients isolated from each other', () => {
    const a = createClient({ baseUrl: 'https://a.test' })
    const b = createClient({ baseUrl: 'https://b.test', mediaUrl: 'https://cdn-b.test/' })
    expect(a.media.getOrgThumbnailMediaDirectory('o', 'f')).toBe('https://a.test/content/orgs/o/thumbnails/f')
    expect(b.media.getOrgThumbnailMediaDirectory('o', 'f')).toBe('https://cdn-b.test/content/orgs/o/thumbnails/f')
    expect(a.media.getOrgThumbnailMediaDirectory('o', 'f')).toBe('https://a.test/content/orgs/o/thumbnails/f')
  })

  it('exposes standalone helpers that take the config first', () => {
    expect(media.getPodcastAudioStreamUrl({ baseUrl: 'https://api.test' }, 'org_1', 'pod_1', 'ep_1', 'a.mp3')).toBe(
      'https://api.test/api/v1/stream/audio/org_1/pod_1/ep_1/a.mp3',
    )
    expect(() => media.getOrgLogoMediaDirectory({ baseUrl: '' }, 'o', 'f')).toThrow(/baseUrl/)
  })

  it('leaves out the Next.js-only SCORM proxy helper', () => {
    const client = createClient({ baseUrl: 'https://api.test' })
    expect('getScormContentUrl' in client.media).toBe(false)
    expect('getScormContentUrl' in media).toBe(false)
  })
})
