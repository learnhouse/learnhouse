import { describe, expect, test } from "bun:test";

import { extractIframeSrc, normalizeH5PUrl } from "../lib/media/h5pUrl.ts";

describe("normalizeH5PUrl — H5P.com", () => {
  test("content page URL becomes its embed form", () => {
    const result = normalizeH5PUrl("https://team.h5p.com/content/1291234567890123456");
    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://team.h5p.com/content/1291234567890123456/embed");
  });

  test("trailing slash on the content page is handled", () => {
    const result = normalizeH5PUrl("https://team.h5p.com/content/123/");
    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://team.h5p.com/content/123/embed");
  });

  test("already-embed URL passes through unchanged", () => {
    const url = "https://team.h5p.com/content/1291234567890123456/embed";
    expect(normalizeH5PUrl(url)).toEqual({ ok: true, url });
  });

  test("query string on a content URL is preserved", () => {
    const result = normalizeH5PUrl("https://team.h5p.com/content/123?lang=fr");
    expect(result.url).toBe("https://team.h5p.com/content/123/embed?lang=fr");
  });
});

describe("normalizeH5PUrl — self-hosted shapes", () => {
  test("Drupal/standalone /h5p/embed/<id> passes through", () => {
    const url = "https://learning.example.org/h5p/embed/42";
    expect(normalizeH5PUrl(url)).toEqual({ ok: true, url });
  });

  test("Moodle /h5p/embed.php passes through", () => {
    const url = "https://moodle.example.org/h5p/embed.php?url=https%3A%2F%2Fmoodle.example.org%2Ffile.h5p";
    expect(normalizeH5PUrl(url)).toEqual({ ok: true, url });
  });

  test("WordPress admin-ajax h5p_embed passes through", () => {
    const url = "https://example.org/wp-admin/admin-ajax.php?action=h5p_embed&id=7";
    expect(normalizeH5PUrl(url)).toEqual({ ok: true, url });
  });

  test("?embed=1 style passes through", () => {
    const url = "https://example.org/interactive/quiz?embed=1";
    expect(normalizeH5PUrl(url)).toEqual({ ok: true, url });
  });

  test("http is kept as-is, not upgraded", () => {
    const url = "http://intranet.example.org/h5p/embed/3";
    expect(normalizeH5PUrl(url)).toEqual({ ok: true, url });
  });

  test("an unrecognised https URL is passed through rather than mangled", () => {
    const url = "https://example.org/some/other/path";
    expect(normalizeH5PUrl(url)).toEqual({ ok: true, url });
  });
});

describe("normalizeH5PUrl — iframe snippets", () => {
  test("extracts src from a full iframe snippet", () => {
    const snippet =
      '<iframe src="https://team.h5p.com/content/123/embed" width="1090" height="694" frameborder="0" allowfullscreen="allowfullscreen" allow="autoplay *; geolocation *"></iframe>';
    expect(normalizeH5PUrl(snippet)).toEqual({
      ok: true,
      url: "https://team.h5p.com/content/123/embed",
    });
  });

  test("decodes &amp; inside a snippet src", () => {
    const snippet = "<iframe src='https://example.org/h5p/embed/9?a=1&amp;b=2'></iframe>";
    expect(normalizeH5PUrl(snippet)).toEqual({
      ok: true,
      url: "https://example.org/h5p/embed/9?a=1&b=2",
    });
  });

  test("a snippet pointing at a content page is still normalized to /embed", () => {
    const snippet = '<iframe width="800" src="https://team.h5p.com/content/55"></iframe>';
    expect(normalizeH5PUrl(snippet).url).toBe("https://team.h5p.com/content/55/embed");
  });

  test("extractIframeSrc returns null for a plain URL", () => {
    expect(extractIframeSrc("https://example.org/h5p/embed/1")).toBeNull();
  });

  test("a javascript: src inside a snippet is still rejected", () => {
    const snippet = `<iframe src="javascript:alert(1)"></iframe>`;
    expect(normalizeH5PUrl(snippet)).toEqual({
      ok: false,
      reason: "unsupported_protocol",
    });
  });
});

describe("normalizeH5PUrl — rejections", () => {
  test("javascript: is rejected", () => {
    expect(normalizeH5PUrl("javascript:alert(document.cookie)")).toEqual({
      ok: false,
      reason: "unsupported_protocol",
    });
  });

  test("data: is rejected", () => {
    expect(normalizeH5PUrl("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==")).toEqual({
      ok: false,
      reason: "unsupported_protocol",
    });
  });

  test("file: is rejected", () => {
    expect(normalizeH5PUrl("file:///etc/passwd").ok).toBe(false);
  });

  test("empty and whitespace-only input is rejected", () => {
    expect(normalizeH5PUrl("")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeH5PUrl("   ")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeH5PUrl(null)).toEqual({ ok: false, reason: "empty" });
  });

  test("garbage input is rejected", () => {
    expect(normalizeH5PUrl("this is not a url").ok).toBe(false);
    expect(normalizeH5PUrl("hello").ok).toBe(false);
    expect(normalizeH5PUrl("https://").ok).toBe(false);
  });
});

describe("normalizeH5PUrl — schemeless input", () => {
  test("schemeless host gets https://", () => {
    expect(normalizeH5PUrl("team.h5p.com/content/123")).toEqual({
      ok: true,
      url: "https://team.h5p.com/content/123/embed",
    });
  });

  test("protocol-relative input gets https:", () => {
    expect(normalizeH5PUrl("//example.org/h5p/embed/4")).toEqual({
      ok: true,
      url: "https://example.org/h5p/embed/4",
    });
  });

  test("surrounding whitespace is trimmed", () => {
    expect(normalizeH5PUrl("  https://example.org/h5p/embed/5  ").url).toBe(
      "https://example.org/h5p/embed/5"
    );
  });
});
