import { describe, expect, test } from "bun:test";

import {
  isActivityHlsReady,
  resolveActivityVideoSource,
  shouldSendHlsCredentials,
} from "../components/Objects/Activities/Video/videoSource.ts";

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
});
