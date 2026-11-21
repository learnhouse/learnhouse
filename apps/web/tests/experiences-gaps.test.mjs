import { describe, expect, test } from "bun:test";
import {
  buildBank,
  defaultGapsContent,
  escapeGapText,
  gradeGaps,
  isCorrect,
  isInsideGap,
  keepCorrect,
  makeGap,
  normalizeGapsMode,
  parseGaps,
  splitAnswers,
  starsForScore,
} from "../components/Objects/Editor/Extensions/Experiences/Gaps/gapsModel.ts";
import { normalizeAnswer, shuffle as shuffled } from "../components/Objects/Editor/Extensions/Experiences/shared/utils.ts";

const seeded = (seed = 1) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

describe("gaps parser", () => {
  test("plain gaps with alternatives", () => {
    const { tokens, gaps, issues } = parseGaps("The [[sun|Sun]] rises in the [[east]].");
    expect(issues).toEqual([]);
    expect(gaps.map((g) => g.answers)).toEqual([["sun", "Sun"], ["east"]]);
    expect(tokens.map((t) => t.type)).toEqual(["text", "gap", "text", "gap", "text"]);
    expect(tokens[0].value).toBe("The ");
    expect(tokens[4].value).toBe(".");
    expect(gaps[1].index).toBe(1);
  });

  test("answers are trimmed, collapsed and deduped", () => {
    expect(splitAnswers("  New   York | new york|| New York ")).toEqual(["New York", "new york"]);
  });

  test("escapes work outside and inside gaps", () => {
    const { tokens, gaps } = parseGaps("Use \\[\\[x]] or [[a\\|b|c]] and [[\\]]]");
    expect(tokens[0].value).toBe("Use [[x]] or ");
    expect(gaps[0].answers).toEqual(["a|b", "c"]);
    expect(gaps[1].answers).toEqual(["]"]);
    expect(parseGaps("back\\\\slash [[x]]").tokens[0].value).toBe("back\\slash ");
  });

  test("nested brackets inside a gap", () => {
    expect(parseGaps("x = [[arr[0]]];").gaps[0].answers).toEqual(["arr[0]"]);
    expect(parseGaps("[[a[[b]]c]]").gaps[0].answers).toEqual(["a[[b]]c"]);
    const { tokens, gaps } = parseGaps("[[m[i][j]|m[i, j]]] end");
    expect(gaps[0].answers).toEqual(["m[i][j]", "m[i, j]"]);
    expect(tokens[1].value).toBe(" end");
  });

  test("empty and unclosed gaps stay text and are reported", () => {
    const empty = parseGaps("A [[]] B [[ | ]] C [[ok]]");
    expect(empty.gaps.length).toBe(1);
    expect(empty.issues.map((i) => i.kind)).toEqual(["empty", "empty"]);
    expect(empty.tokens[0].value).toBe("A [[]] B [[ | ]] C ");

    const unclosed = parseGaps("Open [[gap here");
    expect(unclosed.gaps.length).toBe(0);
    expect(unclosed.issues.map((i) => i.kind)).toEqual(["unclosed", "noGaps"]);
    expect(unclosed.tokens[0].value).toBe("Open [[gap here");

    const paragraph = parseGaps("[[a\n\nb]] [[c]]");
    expect(paragraph.issues[0].kind).toBe("unclosed");
    expect(paragraph.gaps.map((g) => g.answers)).toEqual([["c"]]);
  });

  test("odd input does not throw", () => {
    expect(parseGaps(undefined).gaps).toEqual([]);
    expect(parseGaps("]] [ ] [[").issues.map((i) => i.kind)).toEqual(["unclosed", "noGaps"]);
    expect(parseGaps("trailing \\").tokens[0].value).toBe("trailing \\");
  });

  test("gap offsets and isInsideGap", () => {
    const text = "ab [[cd]] ef";
    const { gaps } = parseGaps(text);
    expect(text.slice(gaps[0].start, gaps[0].end)).toBe("[[cd]]");
    expect(isInsideGap(text, 5)).toBe(true);
    expect(isInsideGap(text, 1)).toBe(false);
  });
});

describe("make gap", () => {
  test("wraps the selection and trims whitespace", () => {
    const r = makeGap("The cat sat", 3, 8);
    expect(r.text).toBe("The [[cat]] sat");
    expect(r.text.slice(r.selStart, r.selEnd)).toBe("cat");
  });

  test("escapes special characters in the selection", () => {
    const r = makeGap("pick a|b now", 5, 8);
    expect(r.text).toBe("pick [[a\\|b]] now");
    expect(parseGaps(r.text).gaps[0].answers).toEqual(["a|b"]);
    expect(escapeGapText("[x]\\|")).toBe("\\[x\\]\\\\\\|");
  });

  test("empty selection inserts a placeholder", () => {
    const r = makeGap("Hello ", 6, 6, "word");
    expect(r.text).toBe("Hello [[word]]");
    expect(r.text.slice(r.selStart, r.selEnd)).toBe("word");
  });

  test("refuses to nest in an existing gap; reversed selection is fine", () => {
    expect(makeGap("a [[b]] c", 4, 5)).toBeNull();
    expect(makeGap("a [[b]] c", 0, 9)).toBeNull();
    expect(makeGap("one two", 7, 4).text).toBe("one [[two]]");
    expect(makeGap("a [[b]] c", 2, 2, "w").text).toBe("a [[w]][[b]] c");
  });
});

describe("grading", () => {
  const { gaps } = parseGaps("[[Paris]] is in [[France|the French Republic]].");

  test("normalises case, spacing and unicode", () => {
    expect(normalizeAnswer("  PaRis  ", false)).toBe("paris");
    expect(normalizeAnswer("  PaRis  ", true)).toBe("PaRis");
    expect(normalizeAnswer("Café", false)).toBe("café");
  });

  test("isCorrect with alternatives and case", () => {
    expect(isCorrect(gaps[0], "paris", false)).toBe(true);
    expect(isCorrect(gaps[0], "paris", true)).toBe(false);
    expect(isCorrect(gaps[1], "the  french republic", false)).toBe(true);
    expect(isCorrect(gaps[1], "", false)).toBe(false);
  });

  test("gradeGaps, keepCorrect and stars", () => {
    const g = gradeGaps(gaps, ["Paris", "Spain"], false);
    expect(g).toEqual({ results: [true, false], correct: 1, total: 2 });
    expect(keepCorrect(["Paris", "Spain"], g.results)).toEqual(["Paris", ""]);
    expect(gradeGaps(gaps, [], false).correct).toBe(0);
    expect(starsForScore(2, 2)).toBe(3);
    expect(starsForScore(3, 4)).toBe(2);
    expect(starsForScore(1, 3)).toBe(1);
    expect(starsForScore(0, 3)).toBe(0);
    expect(starsForScore(0, 0)).toBe(0);
  });
});

describe("word bank", () => {
  test("one chip per gap, no distractors, shuffled", () => {
    const { gaps } = parseGaps("[[a]] [[b|B]] [[c]] [[d]]");
    const bank = buildBank(gaps, seeded(7));
    expect(bank.map((c) => c.text).sort()).toEqual(["a", "b", "c", "d"]);
    expect(bank.map((c) => c.text)).not.toEqual(["a", "b", "c", "d"]);
    expect(new Set(bank.map((c) => c.id)).size).toBe(4);
  });

  test("shuffled never returns the identity order for length > 1", () => {
    expect(shuffled([1, 2], () => 0.999)).toEqual([2, 1]);
    for (let s = 1; s < 50; s++) expect(shuffled([1, 2, 3], seeded(s))).not.toEqual([1, 2, 3]);
    expect(shuffled([1])).toEqual([1]);
    expect(shuffled([])).toEqual([]);
  });
});

test("default content and mode", () => {
  const c = defaultGapsContent((k) => k);
  expect(c.text).toBe("editor.experiences.gaps.example.text");
  expect(c).toMatchObject({ mode: "type", caseSensitive: false });
  expect(normalizeGapsMode("bank")).toBe("bank");
  expect(normalizeGapsMode("x")).toBe("type");
});
