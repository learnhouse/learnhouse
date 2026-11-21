import { describe, expect, test } from "bun:test";
import {
  defaultSpotMistakeContent,
  isBlankSegment,
  joinSegments,
  normalizeKind,
  normalizeSegments,
  resplit,
  scoreSelection,
  splitLines,
  splitPassage,
  splitSentences,
  starsFor,
  toggleMistake,
  toggleSelection,
  validateSpotMistake,
  MAX_SEGMENTS,
} from "../components/Objects/Editor/Extensions/Experiences/SpotMistake/spotMistakeModel.ts";

describe("sentence splitter", () => {
  test("basic punctuation", () => {
    expect(splitSentences("One. Two! Three? Four")).toEqual(["One.", "Two!", "Three?", "Four"]);
  });

  test("abbreviations and initials do not split", () => {
    expect(splitSentences("Mr. Smith met Dr. Jones at St. Mary's. They talked.")).toEqual([
      "Mr. Smith met Dr. Jones at St. Mary's.",
      "They talked.",
    ]);
    expect(splitSentences("Use a tool, e.g. A hammer. Done.")).toEqual(["Use a tool, e.g. A hammer.", "Done."]);
    expect(splitSentences("J. K. Rowling wrote it. The U.S. Army agreed.")).toEqual([
      "J. K. Rowling wrote it.",
      "The U.S. Army agreed.",
    ]);
    expect(splitSentences("See Fig. 3 for details. Next.")).toEqual(["See Fig. 3 for details.", "Next."]);
  });

  test("lower-case next word means no boundary", () => {
    expect(splitSentences("Apples, pears, etc. are fruit. Yes.")).toEqual(["Apples, pears, etc. are fruit.", "Yes."]);
  });

  test("etc. at the end of a sentence still splits", () => {
    expect(splitSentences("We sell pens, paper, etc. Come in.")).toEqual(["We sell pens, paper, etc.", "Come in."]);
  });

  test("decimals, ellipses, quotes and repeated punctuation", () => {
    expect(splitSentences("Pi is 3.14 roughly. Really?! Yes… Fine.")).toEqual(["Pi is 3.14 roughly.", "Really?!", "Yes…", "Fine."]);
    expect(splitSentences('He said "Stop." Then he left.')).toEqual(['He said "Stop."', "Then he left."]);
    expect(splitSentences("Wait... What? (Really.) Ok.")).toEqual(["Wait...", "What?", "(Really.)", "Ok."]);
  });

  test("line breaks split and blank lines vanish", () => {
    expect(splitSentences("Title line\n\nFirst. Second\r\nThird")).toEqual(["Title line", "First.", "Second", "Third"]);
  });

  test("CJK terminators split without spaces", () => {
    expect(splitSentences("今天下雨。我们在家！好吗？")).toEqual(["今天下雨。", "我们在家！", "好吗？"]);
  });

  test("empty input", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences(undefined)).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
  });
});

describe("code splitter", () => {
  test("keeps indentation and inner blank lines, drops outer ones", () => {
    expect(splitLines("\n\ndef f(x):\n\treturn x  \n\nprint(f(1))\n\n")).toEqual(["def f(x):", "  return x", "", "print(f(1))"]);
  });

  test("splitPassage picks by kind and caps the count", () => {
    expect(splitPassage("One. Two.", "text")).toEqual(["One.", "Two."]);
    expect(splitPassage("One. Two.", "code")).toEqual(["One. Two."]);
    const many = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n");
    expect(splitPassage(many, "code").length).toBe(MAX_SEGMENTS);
  });
});

describe("segments", () => {
  test("resplit keeps flags for unchanged text", () => {
    const prev = [
      { id: "a", text: "One.", isMistake: false, correction: "", explanation: "" },
      { id: "b", text: "Two.", isMistake: true, correction: "2.", explanation: "why" },
    ];
    const next = resplit(prev, "Zero. One. Two.", "text");
    expect(next.map((s) => s.text)).toEqual(["Zero.", "One.", "Two."]);
    expect(next[1].id).toBe("a");
    expect(next[2]).toMatchObject({ id: "b", isMistake: true, correction: "2.", explanation: "why" });
    expect(next[0].isMistake).toBe(false);
    expect(["a", "b"]).not.toContain(next[0].id);
  });

  test("resplit handles duplicate texts once each", () => {
    const prev = [{ id: "a", text: "x", isMistake: true }];
    const next = resplit(prev, "x\nx", "code");
    expect(next[0].id).toBe("a");
    expect(next[1].id).not.toBe("a");
  });

  test("join, blank detection and toggles", () => {
    const segs = [
      { id: "a", text: "l1", isMistake: false },
      { id: "b", text: "", isMistake: false },
      { id: "c", text: "l3", isMistake: false },
    ];
    expect(joinSegments(segs, "code")).toBe("l1\n\nl3");
    expect(joinSegments([segs[0], segs[2]], "text")).toBe("l1 l3");
    expect(isBlankSegment(segs[1])).toBe(true);
    expect(toggleMistake(segs, "b")[1].isMistake).toBe(false);
    expect(toggleMistake(segs, "c")[2].isMistake).toBe(true);
    const sel = toggleSelection(new Set(["a"]), "a");
    expect(sel.has("a")).toBe(false);
    expect(toggleSelection(sel, "c").has("c")).toBe(true);
  });

  test("normalizeSegments cleans stored attrs", () => {
    const out = normalizeSegments([{ id: "a", text: "x", isMistake: true }, { id: "a", text: " ", isMistake: true }, 3]);
    expect(out.length).toBe(2);
    expect(out[0]).toMatchObject({ id: "a", isMistake: true, correction: "" });
    expect(out[1].id).not.toBe("a");
    expect(out[1].isMistake).toBe(false);
    expect(normalizeSegments(null)).toEqual([]);
    expect(normalizeKind("code")).toBe("code");
    expect(normalizeKind("x")).toBe("text");
  });
});

describe("scoring", () => {
  const segs = [
    { id: "a", text: "ok", isMistake: false },
    { id: "b", text: "bad", isMistake: true },
    { id: "c", text: "ok2", isMistake: false },
    { id: "d", text: "bad2", isMistake: true },
    { id: "e", text: "", isMistake: false },
  ];

  test("hits, misses and false alarms", () => {
    const s = scoreSelection(segs, new Set(["b", "c", "e"]));
    expect(s.hits).toEqual(["b"]);
    expect(s.misses).toEqual(["d"]);
    expect(s.falseAlarms).toEqual(["c"]);
    expect(s.totalMistakes).toBe(2);
  });

  test("perfect gets 3, errors of either kind cost stars", () => {
    expect(scoreSelection(segs, new Set(["b", "d"])).stars).toBe(3);
    expect(scoreSelection(segs, new Set(["b"])).stars).toBe(1);
    expect(scoreSelection(segs, new Set(["b", "d", "a"])).stars).toBe(2);
    expect(scoreSelection(segs, new Set()).stars).toBe(0);
    expect(scoreSelection(segs, new Set(["a", "c"])).stars).toBe(0);
    expect(starsFor(4, 1, 0)).toBe(2);
    expect(starsFor(4, 0, 1)).toBe(2);
    expect(starsFor(0, 0, 0)).toBe(0);
  });
});

describe("validation and defaults", () => {
  test("hints", () => {
    const kinds = (s) => validateSpotMistake(s).map((i) => i.kind);
    expect(kinds([])).toEqual(["tooFew", "noMistakes"]);
    expect(kinds([{ id: "a", text: "x", isMistake: true, correction: "y" }, { id: "b", text: "z", isMistake: true, correction: "w" }])).toEqual(["allMistakes"]);
    expect(kinds([{ id: "a", text: "x", isMistake: true }, { id: "b", text: "z", isMistake: false }])).toEqual(["missingCorrection"]);
  });

  test("default example is valid", () => {
    const c = defaultSpotMistakeContent((k) => `T:${k}`);
    expect(c.kind).toBe("text");
    expect(c.segments.length).toBe(4);
    expect(c.segments.filter((s) => s.isMistake).length).toBe(2);
    expect(validateSpotMistake(c.segments)).toEqual([]);
  });
});
