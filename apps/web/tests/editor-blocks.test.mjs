import { describe, expect, test } from "bun:test";

import {
  MEDIA_KINDS,
  acceptFor,
  formatBytes,
  formatHint,
  kindForFile,
  validateFile,
} from "../components/Objects/Editor/Blocks/media/mediaKinds.ts";
import { planDownscale, MAX_EDGE } from "../components/Objects/Editor/Blocks/media/downscale.ts";
import { fileNameFromUrl, looksLikeFileUrl } from "../components/Objects/Editor/Blocks/media/urlImport.ts";
import { libraryMediaNodeAttrs } from "../components/Objects/Editor/Blocks/media/librarySnapshot.ts";
import {
  ASPECT_PRESETS,
  aspectPresetFor,
  embedAttrsFor,
  normalizeUserUrl,
  parseEmbedUrl,
  parseYouTubeTime,
} from "../components/Objects/Editor/Blocks/embeds/embedProviders.ts";
import { resolveEmbedSrc } from "../components/Objects/Editor/Blocks/embeds/embedRender.ts";
import {
  IMAGE_EXTRA_ATTRS,
  NEW_ATTR_DEFAULTS,
  dividerVariantOf,
  formatTimecode,
  imageWidthOf,
  imageWidthPresetOf,
  normalizeChapters,
  parseTimecode,
  resolveImageView,
  resolveVideoBlockObject,
  safeHref,
} from "../components/Objects/Editor/Blocks/schema/blockAttrs.ts";

const file = (name, type, size = 1000) => ({ name, type, size });
const MB = 1024 * 1024;

describe("upload validation", () => {
  test("detects the block kind from the MIME type", () => {
    expect(kindForFile(file("a.png", "image/png"))).toBe("image");
    expect(kindForFile(file("a.webm", "video/webm"))).toBe("video");
    expect(kindForFile(file("a.m4a", "audio/x-m4a"))).toBe("audio");
    expect(kindForFile(file("a.pdf", "application/pdf"))).toBe("pdf");
  });

  test("falls back to the extension when the type is missing or generic", () => {
    expect(kindForFile(file("Lecture.MP3", ""))).toBe("audio");
    expect(kindForFile(file("slides.pdf", "application/octet-stream"))).toBe("pdf");
  });

  test("refuses types no block accepts (SVG, text, archives)", () => {
    expect(kindForFile(file("logo.svg", "image/svg+xml"))).toBeNull();
    expect(validateFile(file("notes.txt", "text/plain"))).toEqual({ ok: false, code: "type", kind: null });
    expect(validateFile(file("a.zip", "application/zip")).ok).toBe(false);
  });

  test("a file of the wrong kind for the block is a type error", () => {
    const r = validateFile(file("clip.mp4", "video/mp4"), "image");
    expect(r).toEqual({ ok: false, code: "type", kind: "image" });
  });

  test("size limits mirror the API", () => {
    expect(MEDIA_KINDS.image.maxBytes).toBe(15 * MB);
    expect(MEDIA_KINDS.pdf.maxBytes).toBe(500 * MB);
    expect(MEDIA_KINDS.audio.maxBytes).toBe(1024 * MB);
    expect(MEDIA_KINDS.video.maxBytes).toBe(5 * 1024 * MB);
    const big = validateFile(file("huge.jpg", "image/jpeg", 16 * MB));
    expect(big).toEqual({ ok: false, code: "size", kind: "image", maxBytes: 15 * MB });
    expect(validateFile(file("ok.jpg", "image/jpeg", 15 * MB)).ok).toBe(true);
  });

  test("empty files are rejected", () => {
    expect(validateFile(file("empty.png", "image/png", 0))).toEqual({ ok: false, code: "empty", kind: "image" });
  });

  test("accept attribute lists MIME types and extensions", () => {
    const accept = acceptFor("image");
    expect(accept).toContain("image/png");
    expect(accept).toContain(".webp");
    expect(accept).not.toContain("svg");
  });

  test("human sizes and hints", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(820 * 1024)).toBe("820 KB");
    expect(formatBytes(1.5 * MB)).toBe("1.5 MB");
    expect(formatBytes(5 * 1024 * MB)).toBe("5 GB");
    expect(formatHint("image")).toEqual({ formats: "JPG, PNG, WebP, GIF", max: "15 MB" });
  });
});

describe("image downscale plan", () => {
  test("leaves normal images alone", () => {
    expect(planDownscale(1600, 900, 400_000, "image/jpeg").resize).toBe(false);
  });

  test("shrinks the longest edge to MAX_EDGE and keeps the ratio", () => {
    const p = planDownscale(6000, 4000, 9 * MB, "image/jpeg");
    expect(p).toEqual({ resize: true, width: MAX_EDGE, height: Math.round(4000 * (MAX_EDGE / 6000)), outputType: "image/webp" });
    const tall = planDownscale(3000, 9000, 2 * MB, "image/png");
    expect(tall.height).toBe(MAX_EDGE);
    expect(tall.outputType).toBe("image/png");
  });

  test("re-encodes heavy images even when small enough in pixels", () => {
    const p = planDownscale(2000, 1500, 8 * MB, "image/png");
    expect(p.resize).toBe(true);
    expect(p.width).toBe(2000);
  });

  test("never touches GIFs (animation) or unknown types", () => {
    expect(planDownscale(8000, 8000, 14 * MB, "image/gif").resize).toBe(false);
    expect(planDownscale(8000, 8000, 14 * MB, "image/heic").resize).toBe(false);
    expect(planDownscale(0, 0, 14 * MB, "image/jpeg").resize).toBe(false);
  });
});

describe("URL → embed parsing", () => {
  const cases = [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0", 16 / 9],
    ["youtu.be/dQw4w9WgXcQ?t=1m30s", "youtube", "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&start=90", 16 / 9],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0", 9 / 16],
    ["https://vimeo.com/76979871", "vimeo", "https://player.vimeo.com/video/76979871", 16 / 9],
    ["https://www.loom.com/share/abc123def", "loom", "https://www.loom.com/embed/abc123def", 16 / 9],
    ["https://docs.google.com/presentation/d/1AbC_d-9/edit#slide=id.p", "google-slides", "https://docs.google.com/presentation/d/1AbC_d-9/preview", 16 / 9],
    ["https://docs.google.com/document/d/1AbC/edit", "google-docs", "https://docs.google.com/document/d/1AbC/preview", null],
    ["https://docs.google.com/forms/d/e/1FAIpQ/viewform", "google-forms", "https://docs.google.com/forms/d/e/1FAIpQ/viewform?embedded=true", null],
    ["https://drive.google.com/file/d/1xYz/view?usp=sharing", "google-drive", "https://drive.google.com/file/d/1xYz/preview", 4 / 3],
    ["https://codepen.io/team/pen/KyzJYV", "codepen", "https://codepen.io/team/embed/KyzJYV?default-tab=result", null],
    ["https://codesandbox.io/s/new-abc12", "codesandbox", "https://codesandbox.io/embed/new-abc12", null],
    ["https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", "spotify", "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC", null],
    ["https://www.desmos.com/calculator/abcd1234", "desmos", "https://www.desmos.com/calculator/abcd1234?embed", 4 / 3],
    ["https://www.geogebra.org/m/xyz123", "geogebra", "https://www.geogebra.org/material/iframe/id/xyz123", 4 / 3],
    ["https://miro.com/app/board/uXjVO=/", "miro", "https://miro.com/app/live-embed/uXjVO=/", 4 / 3],
  ];
  for (const [input, provider, embedUrl, aspect] of cases) {
    test(`${provider}: ${input}`, () => {
      const p = parseEmbedUrl(input);
      expect(p?.provider).toBe(provider);
      expect(p?.embedUrl).toBe(embedUrl);
      expect(p?.aspect).toBe(aspect);
    });
  }

  test("Figma links go through the embed host", () => {
    const p = parseEmbedUrl("https://www.figma.com/design/AbC/Name?node-id=1-2");
    expect(p?.provider).toBe("figma");
    expect(p?.embedUrl.startsWith("https://www.figma.com/embed?embed_host=learnhouse&url=")).toBe(true);
  });

  test("Spotify albums get the taller player", () => {
    expect(parseEmbedUrl("https://open.spotify.com/album/1A2b")?.height).toBe(352);
    expect(parseEmbedUrl("https://open.spotify.com/track/1A2b")?.height).toBe(152);
  });

  test("unknown and unsafe links are not embeds", () => {
    expect(parseEmbedUrl("https://example.com/article")).toBeNull();
    expect(parseEmbedUrl("https://www.google.com/maps/place/Paris")).toBeNull();
    expect(parseEmbedUrl("javascript:alert(1)")).toBeNull();
    expect(parseEmbedUrl("not a link")).toBeNull();
    expect(parseEmbedUrl("")).toBeNull();
  });

  test("normalizeUserUrl adds https and refuses other schemes", () => {
    expect(normalizeUserUrl("  example.com/x ")).toBe("https://example.com/x");
    expect(normalizeUserUrl("http://example.com")).toBe("http://example.com/");
    expect(normalizeUserUrl("data:text/html,hi")).toBeNull();
    expect(normalizeUserUrl("ftp://example.com")).toBeNull();
    expect(normalizeUserUrl("localhost")).toBeNull();
  });

  test("YouTube time formats", () => {
    expect(parseYouTubeTime("90")).toBe(90);
    expect(parseYouTubeTime("90s")).toBe(90);
    expect(parseYouTubeTime("1h2m3s")).toBe(3723);
    expect(parseYouTubeTime("abc")).toBeNull();
    expect(parseYouTubeTime(null)).toBeNull();
  });

  test("embed attrs reuse the node's existing size attrs", () => {
    const attrs = embedAttrsFor(parseEmbedUrl("https://codepen.io/a/pen/b"));
    expect(attrs).toEqual({
      embedType: "url",
      embedUrl: "https://codepen.io/a/embed/b?default-tab=result",
      embedSourceUrl: "https://codepen.io/a/pen/b",
      embedProvider: "codepen",
      embedAspectRatio: null,
      embedHeight: 420,
    });
  });

  test("aspect presets round-trip", () => {
    for (const p of ASPECT_PRESETS) expect(aspectPresetFor(p.value)).toBe(p.id);
    expect(aspectPresetFor(1.234)).toBeNull();
    expect(aspectPresetFor(null)).toBeNull();
  });

  test("legacy embeds keep the old render-time YouTube rewrite; new ones are used as stored", () => {
    expect(resolveEmbedSrc("https://www.youtube.com/watch?v=dQw4w9WgXcQ", null)).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=0&rel=0",
    );
    expect(resolveEmbedSrc("https://example.com/page", null)).toBe("https://example.com/page");
    expect(resolveEmbedSrc("https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&start=42", "youtube")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&start=42",
    );
  });
});

describe("URL import helpers", () => {
  test("file names keep or gain an extension", () => {
    expect(fileNameFromUrl("https://x.com/a/photo.jpg?w=2", "image/jpeg")).toBe("photo.jpg");
    expect(fileNameFromUrl("https://x.com/a/download", "application/pdf")).toBe("download.pdf");
    expect(fileNameFromUrl("https://x.com/", "image/png")).toBe("file.png");
  });

  test("detects direct file links by extension", () => {
    expect(looksLikeFileUrl("https://cdn.x.com/v/clip.MP4", "video")).toBe(true);
    expect(looksLikeFileUrl("https://youtube.com/watch?v=x", "video")).toBe(false);
  });

  test("library picks become a blockLibrary reference", () => {
    const attrs = libraryMediaNodeAttrs({ resource_uuid: "media_1", resource: { name: "Deck", file_mime: "application/pdf", extra: 1 } });
    expect(attrs.resourceType).toBe("media");
    expect(attrs.display).toBe("inline");
    expect(attrs.snapshot.name).toBe("Deck");
    expect(attrs.snapshot.extra).toBeUndefined();
  });
});

describe("new attribute defaults", () => {
  test("every new attr defaults to the old behaviour", () => {
    expect(NEW_ATTR_DEFAULTS.blockImage).toEqual({ alt: "", caption: "", href: null, lightbox: true });
    expect(NEW_ATTR_DEFAULTS.blockVideo).toEqual({ caption: "", startTime: null, chapters: null });
    expect(NEW_ATTR_DEFAULTS.blockAudio).toEqual({ caption: "", transcript: "" });
    expect(NEW_ATTR_DEFAULTS.blockPDF).toEqual({ caption: "" });
    expect(NEW_ATTR_DEFAULTS.blockEmbed).toEqual({ embedSourceUrl: null, embedProvider: null, caption: "" });
    expect(NEW_ATTR_DEFAULTS.callout).toEqual({ icon: null });
    expect(NEW_ATTR_DEFAULTS.codeBlock).toEqual({ filename: null });
    expect(NEW_ATTR_DEFAULTS.horizontalRule).toEqual({ variant: null });
  });

  test("default attrs render no extra HTML attributes", () => {
    const html = Object.fromEntries(
      Object.entries(IMAGE_EXTRA_ATTRS).map(([k, spec]) => [k, spec.renderHTML?.(NEW_ATTR_DEFAULTS.blockImage)]),
    );
    for (const v of Object.values(html)) expect(v).toEqual({});
  });

  test("an image saved before the redesign resolves to the old look", () => {
    // Exactly what the old block wrote (see tests/fixtures/editor-blocks).
    const old = { blockObject: { block_uuid: "b" }, size: { width: 900 }, alignment: "center", unsplash_url: null };
    expect(resolveImageView(old)).toEqual({ width: 900, alignment: "center", alt: "", caption: "", href: null, lightbox: true });
    expect(imageWidthOf({ size: null })).toBe(300);
    expect(imageWidthOf({})).toBe(300);
    expect(imageWidthOf({ size: { width: "640" } })).toBe(640);
    expect(imageWidthOf({ size: { width: "100%" } })).toBe("100%");
    expect(resolveImageView({ alignment: "weird" }).alignment).toBe("center");
    expect(imageWidthPresetOf({ size: { width: 560 } })).toBe("medium");
    expect(imageWidthPresetOf({ size: { width: 900 } })).toBeNull();
  });

  test("image links only allow http(s)/mailto", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com/");
    expect(safeHref("mailto:a@b.co")).toBe("mailto:a@b.co");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("")).toBeNull();
    expect(safeHref(42)).toBeNull();
  });

  test("video sizes: legacy pixel widths map to names without rewriting", () => {
    expect(resolveVideoBlockObject(null)).toBeNull();
    expect(resolveVideoBlockObject({ block_uuid: "v" }).size).toBe("medium");
    expect(resolveVideoBlockObject({ size: { width: 400 } }).size).toBe("small");
    expect(resolveVideoBlockObject({ size: { width: "100%" } }).size).toBe("large");
    expect(resolveVideoBlockObject({ size: "full" }).size).toBe("large");
    const named = { size: "small", block_uuid: "v" };
    expect(resolveVideoBlockObject(named)).toBe(named);
  });

  test("timecodes and chapters", () => {
    expect(parseTimecode("1:30")).toBe(90);
    expect(parseTimecode("1:02:03")).toBe(3723);
    expect(parseTimecode("75")).toBe(75);
    expect(parseTimecode("1:75")).toBeNull();
    expect(parseTimecode("abc")).toBeNull();
    expect(parseTimecode(-3)).toBeNull();
    expect(formatTimecode(90)).toBe("1:30");
    expect(formatTimecode(3723)).toBe("1:02:03");
    expect(
      normalizeChapters([
        { start: "2:00", title: " Second " },
        { start: 0, title: "Intro" },
        { start: "2:00", title: "dupe" },
        { start: "x", title: "bad" },
        { start: 30, title: "" },
      ]),
    ).toEqual([
      { start: 0, title: "Intro" },
      { start: 120, title: "Second" },
    ]);
    expect(normalizeChapters(null)).toEqual([]);
  });

  test("divider variants fall back to the original line", () => {
    expect(dividerVariantOf(null)).toBe("line");
    expect(dividerVariantOf({ variant: null })).toBe("line");
    expect(dividerVariantOf({ variant: "dashed" })).toBe("dashed");
    expect(dividerVariantOf({ variant: "<script>" })).toBe("line");
  });
});
