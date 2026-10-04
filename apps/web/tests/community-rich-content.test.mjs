import { describe, expect, test } from "bun:test";

import {
  extractYoutubeVideoId,
  hasRichContent,
  isRichContentAllowed,
  stripRichContent,
  youtubeWatchUrl,
} from "../components/Objects/Communities/richContent.ts";

const VIDEO_ID = "dQw4w9WgXcQ";

describe("extractYoutubeVideoId", () => {
  test.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ",
  ])("accepts %s", (url) => {
    expect(extractYoutubeVideoId(url)).toBe(VIDEO_ID);
  });

  test.each([
    null,
    undefined,
    "",
    "not a url",
    "https://vimeo.com/123456",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/",
  ])("rejects %s", (url) => {
    expect(extractYoutubeVideoId(url)).toBeNull();
  });

  test("youtubeWatchUrl builds the canonical form", () => {
    expect(youtubeWatchUrl(VIDEO_ID)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
});

describe("isRichContentAllowed", () => {
  test("defaults to false", () => {
    expect(isRichContentAllowed(null)).toBe(false);
    expect(isRichContentAllowed(undefined)).toBe(false);
    expect(isRichContentAllowed({ moderation_settings: null })).toBe(false);
    expect(isRichContentAllowed({ moderation_settings: {} })).toBe(false);
    expect(isRichContentAllowed({ moderation_settings: { allow_rich_content: false } })).toBe(false);
  });

  test("is true only when the flag is explicitly on", () => {
    expect(isRichContentAllowed({ moderation_settings: { allow_rich_content: true } })).toBe(true);
  });
});

describe("stripRichContent", () => {
  const src = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const doc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Watch this" }] },
      { type: "youtube", attrs: { src, start: 0, width: 640, height: 360 } },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "youtube", attrs: { src } }] },
        ],
      },
    ],
  };

  test("replaces embeds with a linked paragraph, including nested ones", () => {
    const stripped = stripRichContent(doc);
    expect(hasRichContent(stripped)).toBe(false);
    expect(stripped.content[0]).toEqual(doc.content[0]);
    expect(stripped.content[1]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: src, marks: [{ type: "link", attrs: { href: src } }] }],
    });
    expect(stripped.content[2].content[0].content[0].type).toBe("paragraph");
  });

  test("drops embeds without a src", () => {
    const stripped = stripRichContent({ type: "doc", content: [{ type: "youtube" }] });
    expect(stripped).toEqual({ type: "doc", content: [] });
  });

  test("does not mutate the input", () => {
    const before = JSON.stringify(doc);
    stripRichContent(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  test("passes through non-document values", () => {
    expect(stripRichContent(null)).toBeNull();
    expect(stripRichContent("plain text")).toBe("plain text");
  });
});

describe("hasRichContent", () => {
  test("detects embeds at any depth", () => {
    expect(hasRichContent({ type: "doc", content: [{ type: "paragraph" }] })).toBe(false);
    expect(
      hasRichContent({
        type: "doc",
        content: [{ type: "blockquote", content: [{ type: "youtube", attrs: {} }] }],
      })
    ).toBe(true);
  });
});
