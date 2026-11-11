// Stream URLs must stay same-origin on an org's custom domain: the session
// cookie is scoped to that host, so a request sent straight to the backend
// arrives anonymous and private media 401s. All hosts are synthetic.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  getActivityVideoStreamUrl,
  getActivityHlsMasterUrl,
  getActivityHlsThumbnailsUrl,
  getActivityCaptionUrl,
  getVideoBlockStreamUrl,
  getVideoBlockHlsMasterUrl,
  getVideoBlockHlsThumbnailsUrl,
  getAudioBlockStreamUrl,
  getPodcastAudioStreamUrl,
} from "../services/media/media.ts";
import { shouldSendHlsCredentials } from "../components/Objects/Activities/Video/videoSource.ts";

const realWindow = globalThis.window;

function onHost(hostname) {
  globalThis.window = {
    location: { hostname, host: hostname },
    __RUNTIME_CONFIG__: {
      NEXT_PUBLIC_LEARNHOUSE_DOMAIN: "platform.test",
      NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL: "https://api.platform.test/",
    },
  };
}

const builders = () => [
  getActivityVideoStreamUrl("org_1", "course_1", "activity_1", "v.mp4"),
  getActivityHlsMasterUrl("org_1", "course_1", "activity_1"),
  getActivityHlsThumbnailsUrl("org_1", "course_1", "activity_1", "thumbnails/sprite.jpg"),
  getActivityCaptionUrl("org_1", "course_1", "activity_1", "fr"),
  getVideoBlockStreamUrl("org_1", "course_1", "activity_1", "block_1", "v.mp4"),
  getVideoBlockHlsMasterUrl("org_1", "course_1", "activity_1", "block_1"),
  getVideoBlockHlsThumbnailsUrl("org_1", "course_1", "activity_1", "block_1", "thumbnails/sprite.jpg"),
  getAudioBlockStreamUrl("org_1", "course_1", "activity_1", "block_1", "a.mp3"),
  getPodcastAudioStreamUrl("org_1", "podcast_1", "episode_1", "a.mp3"),
];

beforeEach(() => {
  globalThis.window = undefined;
});

afterEach(() => {
  globalThis.window = realWindow;
});

describe("stream URLs", () => {
  test("are same-origin on a custom domain", () => {
    onHost("learn.school.test");
    for (const url of builders()) {
      expect(url.startsWith("/api/v1/stream/")).toBe(true);
    }
    expect(getActivityHlsMasterUrl("org_1", "course_1", "activity_1")).toBe(
      "/api/v1/stream/hls/org_1/course_1/activity_1/master.m3u8"
    );
  });

  test("go straight to the backend on the platform domain and its subdomains", () => {
    for (const host of ["platform.test", "org.platform.test"]) {
      onHost(host);
      for (const url of builders()) {
        expect(url.startsWith("https://api.platform.test/api/v1/stream/")).toBe(true);
      }
    }
  });

  test("hls.js still sends the cookie to the same-origin playlist", () => {
    onHost("learn.school.test");
    expect(shouldSendHlsCredentials(getActivityHlsMasterUrl("org_1", "course_1", "activity_1"))).toBe(true);
    expect(shouldSendHlsCredentials(getVideoBlockHlsMasterUrl("org_1", "course_1", "activity_1", "block_1"))).toBe(true);
  });
});
