import { describe, expect, test } from "bun:test";

const M = await import("../components/Objects/Editor/Extensions/Experiences/Reflect/reflectModel.ts");

describe("reflect model: normalize", () => {
  test("guards junk into a usable shape", () => {
    const d = M.normalizeReflect({ title: 1, prompt: null, guidingQuestions: ["a", 2, null, {}], minWords: "12", modelAnswer: 5, checklist: "x" });
    expect(d).toEqual({ blockId: "", title: "1", prompt: "", guidingQuestions: ["a", "2"], minWords: 12, modelAnswer: "5", checklist: [] });
    expect(M.normalizeReflect({}).minWords).toBe(30);
    expect(M.normalizeReflect({ minWords: -5 }).minWords).toBe(0);
    expect(M.normalizeReflect({ minWords: 9999 }).minWords).toBe(500);
    expect(M.normalizeReflect({ minWords: 0 }).minWords).toBe(0);
    expect(M.normalizeReflect({ minWords: "abc" }).minWords).toBe(30);
    expect(M.normalizeReflect({ checklist: JSON.stringify(["p"]) }).checklist).toEqual(["p"]);
  });

  test("example goes through t with its own keys", () => {
    const ex = M.exampleReflect();
    expect(ex.guidingQuestions.length).toBe(3);
    expect(ex.checklist.length).toBe(4);
    expect(ex.minWords).toBe(30);
    const keys = [];
    M.exampleReflect((k, f) => (keys.push(k), f));
    expect(keys.every((k) => k.startsWith("editor.experiences.reflect.example."))).toBe(true);
    expect(M.validateReflect({ blockId: "", ...ex })).toEqual([]);
  });
});

describe("reflect model: validation and lists", () => {
  test("hints", () => {
    const base = M.normalizeReflect({ prompt: "P", modelAnswer: "M" });
    expect(M.validateReflect(base)).toEqual([]);
    const codes = (d) => M.validateReflect(M.normalizeReflect(d)).map((i) => `${i.code}${i.index ?? ""}`);
    expect(codes({ prompt: "" })).toEqual(["empty_prompt", "nothing_to_compare"]);
    expect(codes({ prompt: "P", checklist: ["", "k"], guidingQuestions: [" "] })).toEqual(["empty_guiding0", "empty_point0"]);
    expect(codes({ prompt: "P", modelAnswer: "m", guidingQuestions: ["1", "2", "3", "4", "5", "6"], checklist: Array(9).fill("p") })).toEqual(["too_many_guiding", "too_many_points"]);
  });

  test("playable and list helpers", () => {
    const p = M.playableReflect(M.normalizeReflect({ prompt: "P", guidingQuestions: ["a", " ", "b"], checklist: ["", "x"] }));
    expect(p.guidingQuestions).toEqual(["a", "b"]);
    expect(p.checklist).toEqual(["x"]);
    expect(M.isPlayable(p)).toBe(true);
    expect(M.isPlayable(M.normalizeReflect({ prompt: "  " }))).toBe(false);
    expect(M.addEntry(["a"], 2)).toEqual(["a", ""]);
    const full = ["a", "b"];
    expect(M.addEntry(full, 2)).toBe(full);
    expect(M.removeEntry(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(M.updateEntry(["a", "b"], 1, "z")).toEqual(["a", "z"]);
  });
});

describe("reflect model: word count", () => {
  test("spaced scripts", () => {
    expect(M.countWords("")).toBe(0);
    expect(M.countWords("   \n ")).toBe(0);
    expect(M.countWords("The Earth's axis is well-known.")).toBe(5);
    expect(M.countWords("one  two\nthree\tfour")).toBe(4);
    expect(M.countWords("— , . !")).toBe(0);
    expect(M.countWords("Привет мир")).toBe(2);
    expect(M.countWords("مرحبا بالعالم")).toBe(2);
    expect(M.countWords("안녕하세요 세계")).toBe(2);
  });

  test("unspaced scripts with and without Intl.Segmenter", () => {
    // Fallback: every CJK character is a word.
    expect(M.countWords("地球的轴是倾斜的", { useSegmenter: false })).toBe(8);
    expect(M.countWords("hello世界", { useSegmenter: false })).toBe(3);
    // Segmenter (when available) gives real word boundaries: fewer than characters, more than one.
    if (typeof Intl.Segmenter === "function") {
      const zh = M.countWords("地球的轴是倾斜的");
      expect(zh).toBeGreaterThan(1);
      expect(zh).toBeLessThanOrEqual(8);
      const th = M.countWords("โลกหมุนรอบดวงอาทิตย์");
      expect(th).toBeGreaterThan(1);
      expect(M.countWords("これは ペン です")).toBeGreaterThanOrEqual(3);
    }
  });

  test("goal, progress and score", () => {
    expect(M.reachedGoal(29, 30)).toBe(false);
    expect(M.reachedGoal(30, 30)).toBe(true);
    expect(M.reachedGoal(0, 0)).toBe(true);
    expect(M.goalProgress(15, 30)).toBe(0.5);
    expect(M.goalProgress(90, 30)).toBe(1);
    expect(M.goalProgress(0, 0)).toBe(1);
    expect(M.scoreReflect([0, 1], 0)).toBe(null);
    expect(M.scoreReflect([0, 1, 2, 3], 4)).toEqual({ ticked: 4, total: 4, stars: 3 });
    expect(M.scoreReflect(new Set([0, 2, 9, -1]), 4)).toEqual({ ticked: 2, total: 4, stars: 1 });
    expect(M.scoreReflect([0, 1, 2], 4).stars).toBe(2);
  });
});
