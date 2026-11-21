import { describe, expect, test } from "bun:test";

const M = await import("../components/Objects/Editor/Extensions/Experiences/Confidence/confidenceModel.ts");

const q = (id, answer = 0, options = ["a", "b", "c"]) => ({ id, prompt: `P ${id}`, options, answer, explanation: "why" });
const A = (correct, level) => ({ questionId: "x", choice: 0, level, correct });

describe("confidence model: normalize", () => {
  test("guards junk into a usable shape", () => {
    const d = M.normalizeConfidence({ title: 4, questions: [null, { id: "q", prompt: "P", options: ["a", 2], answer: 9 }, { id: "q", options: "x" }, "nope"] });
    expect(d.title).toBe("4");
    expect(d.blockId).toBe("");
    expect(d.questions.map((x) => x.id)).toEqual(["q", "q_1"]);
    expect(d.questions[0].options).toEqual(["a", "2"]);
    expect(d.questions[0].answer).toBe(0);
    expect(d.questions[0].explanation).toBe("");
    expect(d.questions[1].options).toEqual([]);
    expect(M.normalizeConfidence(null).questions).toEqual([]);
    expect(M.normalizeConfidence({ questions: JSON.stringify([q("s", 2)]) }).questions[0].answer).toBe(2);
  });

  test("example is playable, translated through t, with fixed ids", () => {
    const ex = M.exampleConfidence();
    expect(ex.questions.map((x) => x.id)).toEqual(["q1", "q2", "q3"]);
    expect(M.validateConfidence({ blockId: "", ...ex }).filter((i) => i.severity === "error")).toEqual([]);
    const keys = [];
    M.exampleConfidence((k, f) => (keys.push(k), f));
    expect(keys.every((k) => k.startsWith("editor.experiences.confidence.example."))).toBe(true);
    expect(M.exampleConfidence((k) => `T:${k}`).title).toBe("T:editor.experiences.confidence.example.title");
  });
});

describe("confidence model: validation and playable", () => {
  test("flags problems inline", () => {
    const codes = (d) => M.validateConfidence(d).map((i) => i.code);
    expect(codes({ questions: [] })).toEqual(["too_few_questions"]);
    const many = { questions: Array.from({ length: 11 }, (_, i) => q(`q${i}`)) };
    expect(codes(many)).toContain("too_many_questions");
    expect(codes({ questions: [{ id: "a", prompt: "", options: ["x", ""], answer: 0, explanation: "" }] })).toEqual(["empty_prompt", "too_few_options", "no_explanation"]);
    expect(codes({ questions: [{ ...q("a"), options: ["x", "y", ""] }] })).toEqual(["empty_option"]);
    expect(codes({ questions: [{ ...q("a"), options: ["1", "2", "3", "4", "5"] }] })).toEqual(["too_many_options"]);
  });

  test("playable drops blanks and keeps the answer on its option", () => {
    const p = M.playableConfidence({ blockId: "", title: "", questions: [{ ...q("a", 2), options: ["x", "", "z"] }, { ...q("b", 1), options: ["x", ""] }, { ...q("c"), prompt: " " }] });
    expect(p.questions.map((x) => x.id)).toEqual(["a"]);
    expect(p.questions[0].options).toEqual(["x", "z"]);
    expect(p.questions[0].answer).toBe(1);
    expect(M.isPlayable({ questions: [] })).toBe(false);
    expect(M.isPlayable({ questions: [q("a")] })).toBe(true);
    expect(M.playableConfidence({ questions: Array.from({ length: 12 }, (_, i) => q(`q${i}`)) }).questions.length).toBe(10);
  });

  test("author edits respect limits", () => {
    let d = { blockId: "", title: "", questions: [q("a", 1, ["x", "y"])] };
    expect(M.removeQuestion(d, "a")).toBe(d);
    d = M.addQuestion(d, "b");
    expect(d.questions[1]).toEqual({ id: "b", prompt: "", options: ["", ""], answer: 0, explanation: "" });
    expect(M.removeOption(d, "a", 0).questions[0].options).toEqual(["x", "y"]); // min 2
    d = M.addOption(M.addOption(M.addOption(d, "a"), "a"), "a");
    expect(d.questions[0].options.length).toBe(4);
    const r = M.removeOption(d, "a", 0);
    expect(r.questions[0].answer).toBe(0);
    expect(M.removeOption(d, "a", 1).questions[0].answer).toBe(0);
    expect(M.removeOption(d, "a", 3).questions[0].answer).toBe(1);
    expect(M.updateQuestion(d, "b", { prompt: "Hi" }).questions[1].prompt).toBe("Hi");
    let full = { questions: Array.from({ length: 10 }, (_, i) => q(`q${i}`)) };
    expect(M.addQuestion(full, "z")).toBe(full);
  });
});

describe("confidence model: learner", () => {
  test("judge, calibration and score", () => {
    const question = q("a", 2);
    expect(M.judge(question, 2, "certain")).toEqual({ questionId: "a", choice: 2, level: "certain", correct: true });
    expect(M.judge(question, 0, "guess").correct).toBe(false);
    expect(M.isLevel("fair")).toBe(true);
    expect(M.isLevel("sure")).toBe(false);
    const answers = [A(true, "certain"), A(false, "certain"), A(true, "guess")];
    const cal = M.calibration(answers);
    expect(cal.map((s) => s.level)).toEqual(["guess", "fair", "certain"]);
    expect(cal[0]).toEqual({ level: "guess", total: 1, correct: 1, accuracy: 1 });
    expect(cal[1]).toEqual({ level: "fair", total: 0, correct: 0, accuracy: null });
    expect(cal[2].accuracy).toBe(0.5);
    expect(M.scoreConfidence(answers, 3)).toEqual({ correct: 2, total: 3, stars: 1, perfect: false });
    expect(M.scoreConfidence([A(true, "fair")], 1)).toEqual({ correct: 1, total: 1, stars: 3, perfect: true });
    expect(M.scoreConfidence([], 0).stars).toBe(0);
  });

  test("insights in plain codes", () => {
    const codes = (a) => M.insights(a).map((i) => `${i.code}:${i.n}`);
    expect(M.insights([])).toEqual([]);
    expect(codes([A(true, "certain"), A(true, "certain")])).toEqual(["all_right:0"]);
    expect(codes([A(false, "certain"), A(false, "certain"), A(true, "certain")])).toEqual(["certain_wrong:2", "overconfident:0"]);
    expect(codes([A(true, "guess"), A(true, "guess"), A(true, "fair")])).toEqual(["guess_right:2", "underconfident:0"]);
    expect(codes([A(true, "certain"), A(false, "guess"), A(true, "fair")])).toEqual(["well_calibrated:0"]);
    expect(M.insights([A(false, "certain")])[0].tone).toBe("warn");
  });
});
