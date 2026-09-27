import { describe, expect, test } from "bun:test";

import { toEmbedUrl, vimeoHash, vimeoId } from "../lib/media/embedUrl.ts";

describe("toEmbedUrl — Vimeo", () => {
  test("player URL keeps its unlisted-link hash", () => {
    expect(toEmbedUrl("https://player.vimeo.com/video/1228007240?h=f9677038e8")).toBe(
      "https://player.vimeo.com/video/1228007240?h=f9677038e8"
    );
  });

  test("share link carries its hash over to the player", () => {
    expect(toEmbedUrl("https://vimeo.com/1228007240/f9677038e8")).toBe(
      "https://player.vimeo.com/video/1228007240?h=f9677038e8"
    );
  });

  test("public video without a hash is unchanged", () => {
    expect(toEmbedUrl("https://vimeo.com/1228007240")).toBe(
      "https://player.vimeo.com/video/1228007240"
    );
  });

  test("the player's own tracking parameters are dropped, the hash is not", () => {
    expect(
      toEmbedUrl("https://player.vimeo.com/video/1228007240?h=f9677038e8&badge=0&autopause=0&app_id=58479")
    ).toBe("https://player.vimeo.com/video/1228007240?h=f9677038e8");
  });

  test("www and a trailing slash are handled", () => {
    expect(toEmbedUrl("https://www.vimeo.com/1228007240/f9677038e8/")).toBe(
      "https://player.vimeo.com/video/1228007240?h=f9677038e8"
    );
  });
});

describe("vimeoHash", () => {
  test("reads the hash from the query string", () => {
    expect(vimeoHash("https://player.vimeo.com/video/123?h=abc123", "123")).toBe("abc123");
  });

  test("reads the hash from the path of a share link", () => {
    expect(vimeoHash("https://vimeo.com/123/abc123", "123")).toBe("abc123");
  });

  test("a non-hex segment after the id is not a hash", () => {
    expect(vimeoHash("https://vimeo.com/123/settings", "123")).toBeNull();
  });

  test("no hash returns null", () => {
    expect(vimeoHash("https://vimeo.com/123", "123")).toBeNull();
  });
});

describe("toEmbedUrl — other providers still normalize", () => {
  test("YouTube watch URL becomes its embed form", () => {
    expect(toEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=0&rel=0"
    );
  });

  test("Google Doc becomes its preview form", () => {
    expect(toEmbedUrl("https://docs.google.com/document/d/abc123/edit")).toBe(
      "https://docs.google.com/document/d/abc123/preview"
    );
  });

  test("vimeoId ignores non-Vimeo hosts", () => {
    expect(vimeoId("https://example.com/1228007240")).toBeNull();
  });
});
