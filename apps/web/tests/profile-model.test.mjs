import { describe, expect, test } from "bun:test";

import {
  applyDetailTemplate,
  detailHref,
  detailsToRecord,
  formatProfileDate,
  layoutSections,
  linkKind,
  normalizeDetails,
  normalizeProfile,
  parseRichText,
  profileErrors,
  richTextToPlain,
  safeImageUrl,
  safeUrl,
  serializeProfile,
} from "../lib/profile/profile.ts";

describe("safeUrl", () => {
  test("keeps http(s) and mailto, upgrades bare hosts and emails", () => {
    expect(safeUrl("https://github.com/maya")).toBe("https://github.com/maya");
    expect(safeUrl("http://example.com")).toBe("http://example.com/");
    expect(safeUrl("example.com/me")).toBe("https://example.com/me");
    expect(safeUrl("mailto:maya@kitebase.dev")).toBe("mailto:maya@kitebase.dev");
    expect(safeUrl("maya@kitebase.dev")).toBe("mailto:maya@kitebase.dev");
  });

  test("rejects script, data and obfuscated schemes", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "file:///etc/passwd",
      "//evil.example",
      "mailto:not an email",
      "hello world",
      "",
      null,
      42,
    ]) {
      expect(safeUrl(bad)).toBeNull();
    }
  });

  test("mailto can be turned off; images take http(s) only", () => {
    expect(safeUrl("maya@kitebase.dev", { mailto: false })).toBeNull();
    expect(safeImageUrl("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
    expect(safeImageUrl("mailto:maya@kitebase.dev")).toBeNull();
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("linkKind", () => {
  test("detects social hosts", () => {
    expect(linkKind("https://www.linkedin.com/in/maya")).toBe("linkedin");
    expect(linkKind("https://github.com/maya")).toBe("github");
    expect(linkKind("https://twitter.com/maya")).toBe("x");
    expect(linkKind("https://youtu.be/x")).toBe("youtube");
    expect(linkKind("mailto:a@b.co")).toBe("mail");
    expect(linkKind("https://notgithub.com")).toBe("website");
    expect(linkKind(null)).toBe("website");
  });
});

describe("parseRichText", () => {
  test("paragraphs, bullet lists, bold, italic and links", () => {
    const blocks = parseRichText("Hi **there** and *you*\n\n- one\n- [two](https://two.example)");
    expect(blocks).toEqual([
      {
        type: "p",
        children: [
          { type: "text", value: "Hi " },
          { type: "strong", children: [{ type: "text", value: "there" }] },
          { type: "text", value: " and " },
          { type: "em", children: [{ type: "text", value: "you" }] },
        ],
      },
      {
        type: "ul",
        items: [[{ type: "text", value: "one" }], [{ type: "link", href: "https://two.example/", text: "two" }]],
      },
    ]);
  });

  test("never produces markup or unsafe links", () => {
    const blocks = parseRichText('<img src=x onerror=alert(1)> [click](javascript:alert(1)) [x](data:text/html,hi)');
    const json = JSON.stringify(blocks);
    expect(json).not.toContain('"type":"link"');
    // The angle-bracket text stays text (React escapes it on render).
    expect(blocks[0].children[0]).toEqual({ type: "text", value: "<img src=x onerror=alert(1)> " });
  });

  test("auto-links bare https URLs only", () => {
    const [p] = parseRichText("see https://learnhouse.io and javascript:alert(1)");
    expect(p.children.filter((n) => n.type === "link")).toEqual([
      { type: "link", href: "https://learnhouse.io/", text: "https://learnhouse.io" },
    ]);
  });

  test("plain text summary drops the markup", () => {
    expect(richTextToPlain("**Head** of _Education_\n\n- a\n- b")).toBe("Head of Education a, b");
  });

  test("unterminated markup stays literal", () => {
    expect(richTextToPlain("2 * 3 and **open")).toBe("2 * 3 and **open");
  });
});

describe("normalizeProfile", () => {
  test("old profiles (sections only, no ids) load with a details section in front when details exist", () => {
    const doc = normalizeProfile(
      JSON.stringify({ sections: [{ type: "text", title: "Hello", content: "Hi" }, { type: "bogus" }] }),
      { location: { id: "location", label: "Location", icon: "map-pin", text: "Lagos" } }
    );
    expect(doc.version).toBe(2);
    expect(doc.sections.map((s) => s.type)).toEqual(["details", "text"]);
    expect(doc.sections[1].id).toBe("section-0");
    expect(doc.headline).toBe("");
  });

  test("no details section is invented when every detail is empty", () => {
    const doc = normalizeProfile({ sections: [] }, { a: { id: "a", label: "Title", icon: "briefcase", text: "" } });
    expect(doc.sections).toEqual([]);
  });

  test("keeps an existing details marker, its place and hidden flag; drops duplicates", () => {
    const doc = normalizeProfile(
      {
        sections: [
          { id: "t", type: "text", title: "", content: "x" },
          { id: "d", type: "details", title: "", hidden: true },
          { id: "d2", type: "details", title: "" },
          { id: "t", type: "text", title: "", content: "y" },
        ],
      },
      { a: { id: "a", label: "x", icon: "", text: "y" } }
    );
    expect(doc.sections.map((s) => [s.id, s.type, !!s.hidden])).toEqual([
      ["t", "text", false],
      ["d", "details", true],
      ["t-3", "text", false],
    ]);
  });

  test("survives malformed input", () => {
    expect(normalizeProfile("{not json", "nope").sections).toEqual([]);
    expect(normalizeProfile(null, null).sections).toEqual([]);
    expect(normalizeProfile({ sections: "x" }).sections).toEqual([]);
  });
});

describe("details compatibility", () => {
  test("round-trips the stored object in order and drops empty rows", () => {
    const stored = {
      title: { id: "title", label: "Title", icon: "briefcase", text: "Teacher" },
      "detail-1": { id: "detail-1", label: "Site", icon: "globe", text: " maya.dev " },
      empty: { id: "empty", label: "", icon: "", text: "" },
    };
    const list = normalizeDetails(stored);
    expect(list.map((d) => d.id)).toEqual(["title", "detail-1", "empty"]);
    expect(detailsToRecord(list)).toEqual({
      title: { id: "title", label: "Title", icon: "briefcase", text: "Teacher" },
      "detail-1": { id: "detail-1", label: "Site", icon: "globe", text: "maya.dev" },
    });
  });

  test("templates append missing rows only", () => {
    const list = applyDetailTemplate([{ id: "title", label: "Job", icon: "briefcase", text: "x" }], "general");
    expect(list[0]).toEqual({ id: "title", label: "Job", icon: "briefcase", text: "x" });
    expect(list.map((d) => d.id)).toEqual(["title", "affiliation", "location", "website", "linkedin"]);
  });

  test("link-like detail values become safe links", () => {
    expect(detailHref({ id: "w", label: "", icon: "globe", text: "maya.dev" })).toBe("https://maya.dev/");
    expect(detailHref({ id: "w", label: "", icon: "globe", text: "javascript:alert(1)" })).toBeNull();
    expect(detailHref({ id: "w", label: "", icon: "map-pin", text: "Lagos" })).toBeNull();
  });
});

describe("serializeProfile", () => {
  test("drops unsafe links and images, trims and clears end dates of current roles", () => {
    const doc = normalizeProfile({
      headline: "  Teacher  ",
      sections: [
        { id: "l", type: "links", title: "", links: [{ title: "Site", url: "maya.dev" }, { title: "Bad", url: "javascript:alert(1)" }] },
        { id: "g", type: "image-gallery", title: "", images: [{ url: "data:image/png;base64,xx" }, { url: "https://x.example/a.png" }] },
        { id: "e", type: "experience", title: "", experiences: [{ title: "Lead", organization: "", startDate: "2020-01", endDate: "2021-01", current: true, description: "" }] },
      ],
    });
    const out = serializeProfile(doc);
    expect(out.headline).toBe("Teacher");
    expect(out.sections[0].links).toEqual([{ title: "Site", url: "https://maya.dev/" }]);
    expect(out.sections[1].images).toEqual([{ url: "https://x.example/a.png", caption: "" }]);
    expect(out.sections[2].experiences[0].endDate).toBe("");
  });

  test("profileErrors flags addresses that would be dropped", () => {
    const doc = normalizeProfile({
      sections: [
        { id: "l", type: "links", title: "", links: [{ title: "x", url: "javascript:alert(1)" }, { title: "", url: "" }] },
        { id: "a", type: "affiliation", title: "", affiliations: [{ name: "A", logoUrl: "ftp://x", description: "" }] },
      ],
    });
    expect(profileErrors(doc)).toEqual([
      { sectionId: "l", index: 0, field: "url" },
      { sectionId: "a", index: 0, field: "logoUrl" },
    ]);
  });

  test("layout hides hidden and empty sections and splits columns", () => {
    const doc = normalizeProfile({
      sections: [
        { id: "t", type: "text", title: "", content: "x" },
        { id: "h", type: "text", title: "", content: "x", hidden: true },
        { id: "e", type: "text", title: "", content: "" },
        { id: "s", type: "skills", title: "", skills: [{ name: "Go" }] },
        { id: "c", type: "courses", title: "" },
      ],
    });
    const { main, side } = layoutSections(doc);
    expect(main.map((s) => s.id)).toEqual(["t", "c"]);
    expect(side.map((s) => s.id)).toEqual(["s"]);
  });
});

describe("formatProfileDate", () => {
  test("formats YYYY-MM and passes free text through", () => {
    expect(formatProfileDate("2024-03", "en")).toBe("Mar 2024");
    expect(formatProfileDate("Spring 2020", "en")).toBe("Spring 2020");
    expect(formatProfileDate("", "en")).toBe("");
  });
});

describe("rich text links with parentheses", () => {
  test("an unsafe target with parentheses leaves just its label", () => {
    expect(richTextToPlain("- [bad](javascript:alert(1)) done")).toBe("bad done");
  });
  test("a safe target may contain parentheses", () => {
    const [p] = parseRichText("[wiki](https://en.wikipedia.org/wiki/Foo_(bar))");
    expect(p.children).toEqual([{ type: "link", href: "https://en.wikipedia.org/wiki/Foo_(bar)", text: "wiki" }]);
  });
});
