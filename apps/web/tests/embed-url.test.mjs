import { describe, expect, test } from "bun:test";

import { toEmbedUrl, vimeoHash } from "../lib/media/embedUrl.ts";

describe("toEmbedUrl: Vimeo private-link hash", () => {
  test("player URL keeps its ?h= hash", () => {
    expect(toEmbedUrl("https://player.vimeo.com/video/1228007240?h=f9677038e8")).toBe(
      "https://player.vimeo.com/video/1228007240?h=f9677038e8",
    );
  });

  test("share link carries the hash as the segment after the id", () => {
    expect(toEmbedUrl("https://vimeo.com/1228007240/f9677038e8")).toBe(
      "https://player.vimeo.com/video/1228007240?h=f9677038e8",
    );
  });

  test("share link with tracking params still forwards only the hash", () => {
    expect(toEmbedUrl("https://vimeo.com/1228007240/f9677038e8?share=copy")).toBe(
      "https://player.vimeo.com/video/1228007240?h=f9677038e8",
    );
  });

  test("public video stays hash-free", () => {
    expect(toEmbedUrl("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871");
    expect(toEmbedUrl("https://vimeo.com/76979871?share=copy")).toBe(
      "https://player.vimeo.com/video/76979871",
    );
    expect(toEmbedUrl("https://player.vimeo.com/video/76979871")).toBe(
      "https://player.vimeo.com/video/76979871",
    );
  });

  test("channel URL does not mistake a word segment for a hash", () => {
    expect(toEmbedUrl("https://vimeo.com/channels/staffpicks/76979871")).toBe(
      "https://player.vimeo.com/video/76979871",
    );
  });

  test("a hash with URL-breaking characters is dropped", () => {
    expect(vimeoHash("https://player.vimeo.com/video/1?h=abc%26autoplay%3D1", "1")).toBeNull();
    expect(toEmbedUrl("https://player.vimeo.com/video/1?h=a\"b")).toBe("https://player.vimeo.com/video/1");
  });
});

describe("toEmbedUrl: other providers unchanged", () => {
  test("YouTube", () => {
    expect(toEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=0&rel=0",
    );
  });

  test("unknown URLs pass through", () => {
    expect(toEmbedUrl("https://example.com/x?y=1")).toBe("https://example.com/x?y=1");
  });
});
