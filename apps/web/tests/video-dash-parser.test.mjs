import { describe, expect, test } from 'bun:test'
import { parse } from 'mpd-parser'

// Exercise the playback boundary when security overrides update its XML parser.
const manifest = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"
     mediaPresentationDuration="PT12S" minBufferTime="PT1.5S">
  <BaseURL>https://media.example.test/course/</BaseURL>
  <Period start="PT0S">
    <AdaptationSet mimeType="video/mp4" codecs="avc1.4d401f">
      <SegmentTemplate timescale="1" duration="6" startNumber="1"
                       initialization="init-$RepresentationID$.mp4"
                       media="chunk-$RepresentationID$-$Number$.m4s" />
      <Representation id="720p" bandwidth="1500000" width="1280" height="720" />
    </AdaptationSet>
  </Period>
</MPD>`

describe('DASH playback with the patched XML parser', () => {
  test('preserves video renditions, initialization segments, and chunk URLs', () => {
    const result = parse(manifest)
    expect(result.playlists).toHaveLength(1)
    const playlist = result.playlists[0]
    expect(playlist.attributes.BANDWIDTH).toBe(1500000)
    expect(playlist.attributes.RESOLUTION).toEqual({ width: 1280, height: 720 })
    expect(playlist.segments).toHaveLength(2)
    expect(playlist.segments.map((segment) => segment.resolvedUri)).toEqual([
      'https://media.example.test/course/chunk-720p-1.m4s',
      'https://media.example.test/course/chunk-720p-2.m4s',
    ])
    expect(playlist.segments[0].map.resolvedUri).toBe(
      'https://media.example.test/course/init-720p.mp4'
    )
  })

  test('rejects empty and non-manifest XML instead of creating a playable source', () => {
    expect(() => parse('')).toThrow()
    expect(() => parse('<html><body>not a manifest</body></html>')).toThrow()
  })
})
