import { describe, expect, test } from "bun:test";

import {
  isActivityHlsReady,
  resolveActivityVideoSource,
  resolveHlsThumbnails,
  resolveActivityCaptions,
  shouldSendHlsCredentials,
  buildThumbnailsVtt,
  resolveAdjacentActivities,
  spriteFrameStyle,
  spriteFrameAt,
  resolveActivityChapters,
  buildChaptersVtt,
  chapterIndexAt,
  formatClock,
  parseClock,
} from "../components/Objects/Activities/Video/videoSource.ts";

describe("resolveActivityCaptions", () => {
  const ids = { orgUuid: "org_1", courseUuid: "course_1", activityUuid: "activity_1" };

  test("returns only ready tracks with built URLs", () => {
    const activity = {
      extra_metadata: {
        captions: {
          enabled: true,
          languages: [
            { code: "fr", label: "French", status: "ready" },
            { code: "es", label: "Spanish", status: "processing" },
            { code: "de", label: "German", status: "failed" },
          ],
        },
      },
    };
    const tracks = resolveActivityCaptions(activity, ids);
    expect(tracks.length).toBe(1);
    expect(tracks[0].code).toBe("fr");
    expect(tracks[0].url).toContain("/stream/captions/org_1/course_1/activity_1/fr.vtt");
  });

  test("empty when disabled, absent, or ids missing", () => {
    expect(resolveActivityCaptions({ extra_metadata: { captions: { enabled: false, languages: [{ code: "fr", status: "ready" }] } } }, ids)).toEqual([]);
    expect(resolveActivityCaptions({ extra_metadata: {} }, ids)).toEqual([]);
    expect(resolveActivityCaptions({}, ids)).toEqual([]);
    expect(resolveActivityCaptions({ extra_metadata: { captions: { enabled: true, languages: [{ code: "fr", status: "ready" }] } } }, { orgUuid: "", courseUuid: "c", activityUuid: "a" })).toEqual([]);
  });
});

describe("isActivityHlsReady", () => {
  test("true only when hls status is 'ready'", () => {
    expect(isActivityHlsReady({ extra_metadata: { hls: { status: "ready" } } })).toBe(true);
  });

  test("false for processing/failed/missing metadata", () => {
    expect(isActivityHlsReady({ extra_metadata: { hls: { status: "processing" } } })).toBe(false);
    expect(isActivityHlsReady({ extra_metadata: { hls: { status: "failed" } } })).toBe(false);
    expect(isActivityHlsReady({ extra_metadata: {} })).toBe(false);
    expect(isActivityHlsReady({ extra_metadata: null })).toBe(false);
    expect(isActivityHlsReady({})).toBe(false);
  });
});

describe("resolveActivityVideoSource", () => {
  const base = {
    orgUuid: "org_1",
    courseUuid: "course_1",
    activityUuid: "activity_1",
    filename: "clip.mp4",
  };

  test("empty when there is no filename", () => {
    expect(resolveActivityVideoSource({ ...base, filename: undefined, hlsReady: false })).toEqual({
      src: "",
      isHls: false,
    });
  });

  test("empty for whitespace-only filename", () => {
    expect(resolveActivityVideoSource({ ...base, filename: "   ", hlsReady: false })).toEqual({
      src: "",
      isHls: false,
    });
  });

  test("empty when any id is missing (never emits 'undefined' in the URL)", () => {
    const r = resolveActivityVideoSource({ ...base, orgUuid: undefined, hlsReady: false });
    expect(r.src).toBe("");
    const r2 = resolveActivityVideoSource({ ...base, activityUuid: "", hlsReady: true });
    expect(r2.src).toBe("");
  });

  test("no double slash regardless of backend trailing slash", () => {
    const { src } = resolveActivityVideoSource({ ...base, hlsReady: false });
    expect(src).not.toContain("ioapi");
    expect(src.split("://")[1]).not.toContain("//");
  });

  test("uses the MP4 stream endpoint when HLS is not ready", () => {
    const { src, isHls } = resolveActivityVideoSource({ ...base, hlsReady: false });
    expect(isHls).toBe(false);
    expect(src).toContain("api/v1/stream/video/org_1/course_1/activity_1/clip.mp4");
    expect(src).not.toContain("/hls/");
  });

  test("uses the HLS master playlist when ready", () => {
    const { src, isHls } = resolveActivityVideoSource({ ...base, hlsReady: true });
    expect(isHls).toBe(true);
    expect(src).toContain("api/v1/stream/hls/org_1/course_1/activity_1/master.m3u8");
    expect(src).not.toContain("clip.mp4");
  });
});

describe("resolveHlsThumbnails", () => {
  const ids = { orgUuid: "org_1", courseUuid: "course_1", activityUuid: "activity_1" };
  const full = {
    extra_metadata: {
      hls: {
        status: "ready",
        thumbnails: { url: "thumbnails/sprite.jpg", interval: 10, width: 160, height: 90, columns: 10, rows: 6 },
      },
    },
  };

  test("builds an absolute sprite URL and passes config through", () => {
    const t = resolveHlsThumbnails(full, ids);
    expect(t).not.toBeNull();
    expect(t.url).toContain("api/v1/stream/hls/org_1/course_1/activity_1/thumbnails/sprite.jpg");
    expect(t).toMatchObject({ interval: 10, width: 160, height: 90, columns: 10, rows: 6 });
  });

  test("null when thumbnails metadata is missing or incomplete", () => {
    expect(resolveHlsThumbnails({ extra_metadata: { hls: { status: "ready" } } }, ids)).toBeNull();
    expect(resolveHlsThumbnails({ extra_metadata: { hls: { thumbnails: { url: "x.jpg" } } } }, ids)).toBeNull();
    expect(resolveHlsThumbnails({}, ids)).toBeNull();
  });

  test("null for negative/zero/NaN numeric fields", () => {
    const mk = (over) => ({ extra_metadata: { hls: { thumbnails: { url: "s.jpg", interval: 5, width: 160, height: 90, columns: 10, ...over } } } });
    expect(resolveHlsThumbnails(mk({ interval: 0 }), ids)).toBeNull();
    expect(resolveHlsThumbnails(mk({ width: -160 }), ids)).toBeNull();
    expect(resolveHlsThumbnails(mk({ columns: 0 }), ids)).toBeNull();
    expect(resolveHlsThumbnails(mk({ height: Number.NaN }), ids)).toBeNull();
  });

  test("null when an id is missing", () => {
    expect(resolveHlsThumbnails(full, { ...ids, orgUuid: undefined })).toBeNull();
  });

  test("defaults rows to 1 when omitted or non-positive", () => {
    const mk = (rows) => ({ extra_metadata: { hls: { thumbnails: { url: "s.jpg", interval: 5, width: 160, height: 90, columns: 10, ...(rows === undefined ? {} : { rows }) } } } });
    expect(resolveHlsThumbnails(mk(undefined), ids).rows).toBe(1);
    expect(resolveHlsThumbnails(mk(0), ids).rows).toBe(1);
    expect(resolveHlsThumbnails(mk(-3), ids).rows).toBe(1);
  });
});

describe("shouldSendHlsCredentials", () => {
  test("credentials only for our API playlist endpoint", () => {
    expect(shouldSendHlsCredentials("https://api.learnhouse.io/api/v1/stream/hls/o/c/a/master.m3u8")).toBe(true);
    expect(shouldSendHlsCredentials("https://api.learnhouse.io/api/v1/stream/hls/o/c/a/v720p/index.m3u8")).toBe(true);
  });

  test("no credentials for presigned R2 segment URLs", () => {
    expect(
      shouldSendHlsCredentials("https://acct.r2.cloudflarestorage.com/bucket/content/.../seg_0000.ts?X-Amz-Signature=x")
    ).toBe(false);
  });

  test("never sends credentials to a presigned URL even if it contains the API path", () => {
    // Pathological URL that both looks like our API path AND is presigned:
    // the X-Amz- guard must win so the cookie is not leaked to storage.
    expect(
      shouldSendHlsCredentials("https://r2/bucket/api/v1/stream/hls/x/seg.ts?X-Amz-Credential=abc")
    ).toBe(false);
  });
});

describe("buildThumbnailsVtt", () => {
  const grid = { url: "/sprite.jpg", interval: 5, width: 160, height: 90, columns: 2, rows: 2 };

  test("emits one cropped cue per sprite cell with an absolute URL", () => {
    const vtt = buildThumbnailsVtt(grid, "https://org.example.com/course/x");
    const lines = vtt.split("\n");
    expect(lines[0]).toBe("WEBVTT");
    expect(lines).toContain("00:00:00.000 --> 00:00:05.000");
    expect(lines).toContain("https://org.example.com/sprite.jpg#xywh=0,0,160,90");
    expect(lines).toContain("00:00:15.000 --> 00:00:20.000");
    expect(lines).toContain("https://org.example.com/sprite.jpg#xywh=160,90,160,90");
    expect(lines.filter((l) => l.includes("#xywh=")).length).toBe(4);
  });

  test("formats hours in cue timestamps", () => {
    const vtt = buildThumbnailsVtt({ ...grid, interval: 3600, columns: 1, rows: 2 }, "https://a.test/");
    expect(vtt).toContain("01:00:00.000 --> 02:00:00.000");
  });

  test("rejects a broken grid", () => {
    expect(buildThumbnailsVtt({ ...grid, interval: 0 }, "https://a.test/")).toBeNull();
    expect(buildThumbnailsVtt({ ...grid, columns: Number.NaN }, "https://a.test/")).toBeNull();
    expect(buildThumbnailsVtt({ ...grid, url: "" }, "https://a.test/")).toBeNull();
  });

  test("defaults missing rows to a single row", () => {
    const vtt = buildThumbnailsVtt({ ...grid, rows: 0 }, "https://a.test/");
    expect(vtt.split("\n").filter((l) => l.includes("#xywh=")).length).toBe(2);
  });
});

describe("resolveAdjacentActivities", () => {
  const course = {
    chapters: [
      { activities: [{ activity_uuid: "activity_a", published: true }, { activity_uuid: "activity_b", published: false }] },
      { activities: [{ activity_uuid: "activity_c" }, { activity_uuid: "activity_d", published: true }] },
    ],
  };

  test("flattens chapters and skips unpublished neighbours", () => {
    const { prev, next } = resolveAdjacentActivities(course, "c");
    expect(prev.activity_uuid).toBe("activity_a");
    expect(next.activity_uuid).toBe("activity_d");
  });

  test("returns nulls at the edges and for unknown ids", () => {
    expect(resolveAdjacentActivities(course, "activity_a").prev).toBeNull();
    expect(resolveAdjacentActivities(course, "activity_d").next).toBeNull();
    expect(resolveAdjacentActivities(course, "zzz")).toEqual({ prev: null, next: null });
    expect(resolveAdjacentActivities(null, "a")).toEqual({ prev: null, next: null });
  });
});

describe("sprite frames", () => {
  const sprite = { url: "https://cdn.test/s.jpg", interval: 10, width: 160, height: 90, columns: 10, rows: 7 };

  test("spriteFrameStyle picks a frame by fraction in percent units", () => {
    expect(spriteFrameStyle(sprite, 0)).toEqual({
      backgroundImage: 'url("https://cdn.test/s.jpg")',
      backgroundSize: "1000% 700%",
      backgroundPosition: "0% 0%",
    });
    expect(spriteFrameStyle(sprite, 1).backgroundPosition).toBe("100% 100%");
  });

  test("spriteFrameAt maps seconds to the frame grid and clamps", () => {
    expect(spriteFrameAt(sprite, 125).backgroundPosition).toBe(`${(2 / 9) * 100}% ${(1 / 6) * 100}%`);
    expect(spriteFrameAt(sprite, -5).backgroundPosition).toBe("0% 0%");
    expect(spriteFrameAt(sprite, 99999).backgroundPosition).toBe("100% 100%");
    expect(spriteFrameAt({ ...sprite, columns: 1, rows: 1 }, 50).backgroundPosition).toBe("0% 0%");
  });
});

describe("chapters", () => {
  const ready = {
    extra_metadata: {
      chapters: {
        status: "ready",
        items: [
          { start: 90, title: " Setup " },
          { start: 0, title: "Intro" },
          { start: "x", title: "Bad" },
          { start: 30, title: "" },
        ],
      },
    },
  };

  test("resolveActivityChapters keeps valid ready chapters, sorted", () => {
    expect(resolveActivityChapters(ready)).toEqual([
      { start: 0, title: "Intro" },
      { start: 90, title: "Setup" },
    ]);
    expect(resolveActivityChapters({ extra_metadata: { chapters: { ...ready.extra_metadata.chapters, status: "processing" } } })).toEqual([]);
    expect(resolveActivityChapters({ extra_metadata: { chapters: { status: "ready", items: [{ start: 0, title: "One" }] } } })).toEqual([]);
    expect(resolveActivityChapters({})).toEqual([]);
  });

  test("buildChaptersVtt chains cue ends and escapes titles", () => {
    const vtt = buildChaptersVtt([{ start: 0, title: "A & <b>" }, { start: 65.5, title: "B --> C" }]);
    expect(vtt.split("\n")).toEqual([
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:01:05.500",
      "A &amp; &lt;b>",
      "",
      "00:01:05.500 --> 99:59:59.000",
      "B → C",
      "",
    ]);
    expect(buildChaptersVtt([{ start: 0, title: "Only" }])).toBeNull();
  });

  test("chapterIndexAt finds the playing chapter", () => {
    const ch = [{ start: 0, title: "a" }, { start: 10, title: "b" }, { start: 20, title: "c" }];
    expect(chapterIndexAt(ch, 0)).toBe(0);
    expect(chapterIndexAt(ch, 15)).toBe(1);
    expect(chapterIndexAt(ch, 500)).toBe(2);
    expect(chapterIndexAt([{ start: 5, title: "a" }], 1)).toBe(-1);
  });

  test("formatClock and parseClock round-trip", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(605.9)).toBe("10:05");
    expect(formatClock(3723)).toBe("1:02:03");
    expect(parseClock("1:02:03")).toBe(3723);
    expect(parseClock("10:05")).toBe(605);
    expect(parseClock(" 45 ")).toBe(45);
    expect(Number.isNaN(parseClock("1:xx"))).toBe(true);
    expect(Number.isNaN(parseClock(""))).toBe(true);
    expect(Number.isNaN(parseClock("1:2:3:4"))).toBe(true);
  });
});
