// Video providers: link detection, the registry extension point, trims, the
// resume store and the transcript parser.
import { beforeEach, describe, expect, mock, test } from "bun:test";

// One registered provider, standing in for whatever @ee adds (the open-source
// stub registers none). A second one throws, which must never break a paste.
const Player = () => null;
mock.module("@ee/components/Video/videoProviders", () => ({
  EE_VIDEO_PROVIDERS: [
    {
      id: "acme",
      label: "Acme",
      match: (url) => {
        const m = String(url).match(/^https:\/\/acme\.test\/v\/(\w+)/);
        return m ? { provider: "acme", label: "Acme", videoId: m[1], embedUrl: `https://acme.test/embed/${m[1]}`, sourceUrl: url } : null;
      },
      Player,
    },
    { id: "broken", label: "Broken", match: () => { throw new Error("boom"); }, Player },
  ],
}));

const R = await import("../components/Objects/Activities/Video/providers/registry.ts");
const { parseEmbedUrl } = await import("../components/Objects/Editor/Blocks/embeds/embedProviders.ts");
const resume = await import("../lib/video/resume.ts");
const { parseVttCues, cueIndexAt } = await import("../components/Objects/Activities/Video/videoSource.ts");
const { EMBED_EXTRA_ATTRS, NEW_ATTR_DEFAULTS } = await import("../components/Objects/Editor/Blocks/schema/blockAttrs.ts");

describe("detectVideoLink", () => {
  test("built-in services", () => {
    expect(R.detectVideoLink("https://youtu.be/aqz-KE-bpKQ")).toMatchObject({
      provider: "youtube",
      videoId: "aqz-KE-bpKQ",
      embedUrl: "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ",
    });
    expect(R.detectVideoLink("vimeo.com/76979871/abcdef12")).toMatchObject({
      provider: "vimeo",
      embedUrl: "https://player.vimeo.com/video/76979871?h=abcdef12",
    });
    expect(R.detectVideoLink("https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184")).toMatchObject({
      provider: "loom",
      embedUrl: "https://www.loom.com/embed/0281766fa2d04bb788eaf19e65135184",
    });
  });

  test("registered providers, after the built-ins", () => {
    expect(R.detectVideoLink("https://acme.test/v/abc123")).toMatchObject({ provider: "acme", videoId: "abc123" });
  });

  test("unknown or invalid links", () => {
    for (const url of ["", "   ", "has spaces in it", "ftp://youtu.be/x", "https://example.com/video", "localhost/x", "https://youtube.com/watch?v=short"]) {
      expect(R.detectVideoLink(url)).toBeNull();
    }
  });
});

describe("registry", () => {
  test("lookups", () => {
    expect(R.findVideoProvider("acme")?.label).toBe("Acme");
    expect(R.findVideoProvider("youtube")).toBeNull();
    expect(R.findVideoProvider(null)).toBeNull();
    expect(R.isVideoProvider("vimeo")).toBe(true);
    expect(R.isVideoProvider("acme")).toBe(true);
    expect(R.isVideoProvider("figma")).toBe(false);
    expect(R.isVideoProvider(null)).toBe(false);
    expect(R.videoProviderLabel("loom")).toBe("Loom");
    expect(R.videoProviderLabel("acme")).toBe("Acme");
    expect(R.videoProviderLabel("mystery")).toBe("mystery");
    expect(R.videoProviderLabel("")).toBe("");
    expect(R.videoServiceNames()).toBe("YouTube, Vimeo, Loom, Acme, Broken");
  });

  test("the paste parser knows registered video services", () => {
    expect(parseEmbedUrl("https://acme.test/v/abc123")).toMatchObject({
      provider: "acme",
      label: "Acme",
      embedUrl: "https://acme.test/embed/abc123",
      aspect: 16 / 9,
    });
    expect(parseEmbedUrl("https://example.com/page")).toBeNull();
  });
});

describe("withTrim", () => {
  test("YouTube start and end", () => {
    expect(R.withTrim("https://www.youtube.com/embed/x?rel=0&start=5", "youtube", 30, 90)).toBe(
      "https://www.youtube.com/embed/x?rel=0&start=30&end=90",
    );
    expect(R.withTrim("https://www.youtube.com/embed/x?start=5&end=9", "youtube", null, null)).toBe("https://www.youtube.com/embed/x");
    // An end before the start is dropped.
    expect(R.withTrim("https://www.youtube.com/embed/x", "youtube", 60, 30)).toBe("https://www.youtube.com/embed/x?start=60");
  });

  test("Vimeo start in the hash", () => {
    expect(R.withTrim("https://player.vimeo.com/video/1?h=a", "vimeo", 42, 99)).toBe("https://player.vimeo.com/video/1?h=a#t=42s");
    expect(R.withTrim("https://player.vimeo.com/video/1#t=4s", "vimeo", 0, null)).toBe("https://player.vimeo.com/video/1");
  });

  test("others read t", () => {
    expect(R.withTrim("https://acme.test/embed/a?t=3", "acme", 12.9, null)).toBe("https://acme.test/embed/a?t=12");
    expect(R.withTrim("https://www.loom.com/embed/a", "loom", null, null)).toBe("https://www.loom.com/embed/a");
    expect(R.withTrim("not a url", "youtube", 1, 2)).toBe("not a url");
  });
});

describe("resume store", () => {
  const store = new Map();
  beforeEach(() => {
    store.clear();
    globalThis.window = {
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        key: (i) => [...store.keys()][i] ?? null,
        get length() { return store.size; },
      },
    };
  });

  test("saves, reads and forgets near the end", () => {
    resume.savePosition("a1", 125.6, 600);
    expect(resume.readSavedPosition("a1")).toBe(125);
    resume.savePosition("a1", 590, 600);
    expect(resume.readSavedPosition("a1")).toBeNull();
    resume.savePosition("a1", 3, 600);
    expect(resume.readSavedPosition("a1")).toBeNull();
    resume.savePosition("a1", 200, 600);
    resume.clearSavedPosition("a1");
    expect(resume.readSavedPosition("a1")).toBeNull();
  });

  test("a trim's end counts as the end", () => {
    resume.savePosition("a2", 95, 600, 100);
    expect(resume.readSavedPosition("a2")).toBeNull();
  });

  test("bad stored values and missing keys", () => {
    store.set("lh:video-position:x", "{not json");
    expect(resume.readSavedPosition("x")).toBeNull();
    store.set("lh:video-position:y", "42");
    expect(resume.readSavedPosition("y")).toBe(42);
    expect(resume.readSavedPosition(undefined)).toBeNull();
    resume.savePosition(undefined, 10, 100);
    resume.clearSavedPosition(undefined);
    resume.savePosition("z", Number.NaN, 100);
    expect(store.size).toBe(2);
  });

  test("keeps at most 200 positions, dropping the oldest", () => {
    for (let i = 0; i < 205; i++) store.set(`lh:video-position:old${i}`, JSON.stringify({ t: 10, at: i }));
    resume.savePosition("fresh", 50, 600);
    expect(store.has("lh:video-position:fresh")).toBe(true);
    expect(store.has("lh:video-position:old0")).toBe(false);
    expect([...store.keys()].filter((k) => k.startsWith("lh:video-position:")).length).toBe(200);
  });

  test("resumePosition respects the trim", () => {
    expect(resume.resumePosition(null)).toBeNull();
    expect(resume.resumePosition(4)).toBeNull();
    expect(resume.resumePosition(70.4, { startTime: 60 })).toBe(70);
    expect(resume.resumePosition(62, { startTime: 60 })).toBeNull();
    expect(resume.resumePosition(120, { endTime: 100 })).toBeNull();
    expect(resume.resumePosition(590, { duration: 600 })).toBeNull();
    expect(resume.resumePosition(300, { duration: 600 })).toBe(300);
  });

  test("isNearEnd", () => {
    expect(resume.isNearEnd(10, 0)).toBe(false);
    expect(resume.isNearEnd(55, 60)).toBe(true);
    expect(resume.isNearEnd(30, 600, 35)).toBe(true);
  });

  test("playback speed", () => {
    expect(resume.readPlaybackRate()).toBeNull();
    resume.savePlaybackRate(1.5);
    expect(resume.readPlaybackRate()).toBe(1.5);
    resume.savePlaybackRate(9);
    expect(resume.readPlaybackRate()).toBe(1.5);
    resume.savePlaybackRate(1);
    expect(resume.readPlaybackRate()).toBeNull();
  });

  test("blocked storage never throws", () => {
    globalThis.window = {
      get localStorage() {
        throw new Error("blocked");
      },
    };
    expect(resume.readSavedPosition("a")).toBeNull();
    resume.savePosition("a", 50, 600);
    resume.clearSavedPosition("a");
    expect(resume.readPlaybackRate()).toBeNull();
    resume.savePlaybackRate(2);
    globalThis.window = {
      localStorage: {
        getItem: () => { throw new Error("x"); },
        setItem: () => { throw new Error("full"); },
        removeItem: () => { throw new Error("x"); },
        key: () => null,
        length: 0,
      },
    };
    expect(resume.readSavedPosition("a")).toBeNull();
    resume.savePosition("a", 50, 600);
    resume.savePosition("a", 1, 600);
    resume.clearSavedPosition("a");
    resume.savePlaybackRate(2);
    resume.savePlaybackRate(1);
    expect(resume.readPlaybackRate()).toBeNull();
  });

  test("throttle", () => {
    const calls = [];
    const f = resume.throttle((x) => calls.push(x), 10_000);
    f(1);
    f(2);
    expect(calls).toEqual([1]);
  });
});

describe("transcript cues", () => {
  const vtt = [
    "WEBVTT",
    "",
    "1",
    "00:00:01.000 --> 00:00:04.500 align:start",
    "Hello <b>there</b> &amp; welcome",
    "",
    "00:04.500 --> 00:06.000",
    "Hello <b>there</b> &amp; welcome",
    "",
    "00:00:06,000 --> 00:00:09.250",
    "Second line,",
    "wrapped &lt;3&nbsp;times",
    "",
    "NOTE a comment block",
    "",
    "00:00:10.000 --> bad",
    "skipped",
    "",
    "00:00:11.000 --> 00:00:12.000",
    "<i></i>",
  ].join("\r\n");

  test("parses, cleans and merges repeats", () => {
    expect(parseVttCues(vtt)).toEqual([
      { start: 1, end: 6, text: "Hello there & welcome" },
      { start: 6, end: 9.25, text: "Second line, wrapped <3 times" },
    ]);
    expect(parseVttCues("")).toEqual([]);
  });

  test("cueIndexAt", () => {
    const cues = parseVttCues(vtt);
    expect(cueIndexAt(cues, 0)).toBe(-1);
    expect(cueIndexAt(cues, 1)).toBe(0);
    expect(cueIndexAt(cues, 7)).toBe(1);
    expect(cueIndexAt([], 7)).toBe(-1);
  });
});

describe("video embed trim attrs", () => {
  const el = (attrs) => ({ getAttribute: (k) => attrs[k] ?? null });
  test("optional, null by default, round-trip through HTML", () => {
    expect(NEW_ATTR_DEFAULTS.blockEmbed.startTime).toBeNull();
    expect(NEW_ATTR_DEFAULTS.blockEmbed.endTime).toBeNull();
    expect(EMBED_EXTRA_ATTRS.startTime.parseHTML(el({ "data-start-time": "30" }))).toBe(30);
    expect(EMBED_EXTRA_ATTRS.endTime.parseHTML(el({ "data-end-time": "x" }))).toBeNull();
    expect(EMBED_EXTRA_ATTRS.startTime.renderHTML({ startTime: 30 })).toEqual({ "data-start-time": "30" });
    expect(EMBED_EXTRA_ATTRS.endTime.renderHTML({ endTime: 90 })).toEqual({ "data-end-time": "90" });
    expect(EMBED_EXTRA_ATTRS.endTime.renderHTML({ endTime: null })).toEqual({});
  });
});
