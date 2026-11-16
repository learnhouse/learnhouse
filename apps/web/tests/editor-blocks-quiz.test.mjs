// Quiz and Flipcard blocks: the pure data layer behind the redesigned node
// views, checked against REAL stored content (tests/fixtures/editor-blocks).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import * as Q from "../components/Objects/Editor/Extensions/Quiz/quizModel.ts";
import * as F from "../components/Objects/Editor/Extensions/Flipcard/flipcardStyles.ts";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/editor-blocks/db-activities.json", import.meta.url), "utf8"));
const nodesOf = (type) => {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === type) out.push(n);
    (n.content || []).forEach(walk);
  };
  fixtures.forEach((f) => walk(f.content));
  return out;
};

let n = 0;
const ids = () => `id${++n}`;
const quiz = () => [
  {
    question_id: "q1",
    question: "Pick one",
    type: "multiple_choice",
    response_type: "single",
    answers: [
      { answer_id: "a", answer: "A", correct: true },
      { answer_id: "b", answer: "B", correct: false },
      { answer_id: "c", answer: "C", correct: false },
    ],
  },
  {
    question_id: "q2",
    question: "Pick all",
    type: "multiple_choice",
    response_type: "multiple",
    answers: [
      { answer_id: "x", answer: "X", correct: true },
      { answer_id: "y", answer: "Y", correct: true },
      { answer_id: "z", answer: "Z", correct: false },
    ],
  },
];

describe("stored quizzes load unchanged", () => {
  const quizzes = nodesOf("blockQuiz");
  test("fixtures include quizzes with and without response_type", () => {
    expect(quizzes.length).toBeGreaterThan(0);
    const qs = quizzes.flatMap((z) => z.attrs.questions);
    expect(qs.some((q) => !("response_type" in q))).toBe(true);
    expect(qs.some((q) => q.response_type === "multiple")).toBe(true);
  });

  test("normalizing real questions changes nothing that was stored", () => {
    for (const z of quizzes) {
      const out = Q.normalizeQuestions(z.attrs.questions);
      expect(out.length).toBe(z.attrs.questions.length);
      z.attrs.questions.forEach((q, i) => {
        for (const [k, v] of Object.entries(q)) expect([k, out[i][k]]).toEqual([k, v]);
      });
    }
  });

  test("no settings attr means the old behaviour", () => {
    expect(Q.normalizeSettings(undefined)).toEqual(Q.DEFAULT_QUIZ_SETTINGS);
    expect(Q.normalizeSettings(null)).toEqual({ shuffleAnswers: false, shuffleQuestions: false, maxAttempts: 0, showCorrectAnswers: true });
    expect(Q.compactSettings(Q.DEFAULT_QUIZ_SETTINGS)).toBeNull();
  });

  test("an old quiz is shown in authored order with default settings", () => {
    for (const z of quizzes) {
      const qs = Q.normalizeQuestions(z.attrs.questions);
      expect(Q.learnerOrder(qs, Q.normalizeSettings(z.attrs.settings), 1234)).toEqual(qs);
    }
  });

  test("junk from a paste or import does not crash", () => {
    expect(Q.normalizeQuestions("[object Object]")).toEqual([]);
    expect(Q.normalizeQuestions(null)).toEqual([]);
    expect(Q.normalizeQuestions([null, { question: 3, answers: "no" }])).toEqual([
      { question: "", question_id: "", type: "multiple_choice", answers: [] },
    ]);
    expect(Q.normalizeSettings({ maxAttempts: -3, showCorrectAnswers: "no" })).toMatchObject({ maxAttempts: 0, showCorrectAnswers: true });
    expect(Q.normalizeSettings({ maxAttempts: 2.7 }).maxAttempts).toBe(2);
  });
});

describe("quiz editing", () => {
  test("marking correct: radio on pick-one, toggle on select-all", () => {
    let qs = Q.toggleCorrect(quiz(), "q1", "b");
    expect(qs[0].answers.map((a) => a.correct)).toEqual([false, true, false]);
    qs = Q.toggleCorrect(qs, "q1", "b");
    expect(qs[0].answers.map((a) => a.correct)).toEqual([false, false, false]);
    qs = Q.toggleCorrect(quiz(), "q2", "z");
    expect(qs[1].answers.map((a) => a.correct)).toEqual([true, true, true]);
  });

  test("switching to pick-one keeps only the first correct option", () => {
    const qs = Q.setResponseType(quiz(), "q2", "single");
    expect(qs[1].response_type).toBe("single");
    expect(qs[1].answers.map((a) => a.correct)).toEqual([true, false, false]);
    expect(Q.setResponseType(quiz(), "q1", "multiple")[0].answers).toEqual(quiz()[0].answers);
  });

  test("insert after, remove, reorder options", () => {
    let qs = Q.insertAnswer(quiz(), "q1", "a", { answer_id: "new", answer: "", correct: false });
    expect(qs[0].answers.map((a) => a.answer_id)).toEqual(["a", "new", "b", "c"]);
    qs = Q.insertAnswer(qs, "q1", null, { answer_id: "end", answer: "", correct: false });
    expect(qs[0].answers.at(-1).answer_id).toBe("end");
    qs = Q.moveAnswer(qs, "q1", 0, 3);
    expect(qs[0].answers.map((a) => a.answer_id)).toEqual(["new", "b", "c", "a", "end"]);
    qs = Q.removeAnswer(qs, "q1", "c");
    expect(qs[0].answers.map((a) => a.answer_id)).toEqual(["new", "b", "a", "end"]);
  });

  test("options stop at the maximum", () => {
    let qs = quiz();
    for (let i = 0; i < 20; i++) qs = Q.insertAnswer(qs, "q1", null, Q.newAnswer(ids));
    expect(qs[0].answers.length).toBe(Q.MAX_ANSWERS);
  });

  test("moveItem clamps and ignores out-of-range sources", () => {
    expect(Q.moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    expect(Q.moveItem([1, 2, 3], 0, 99)).toEqual([2, 3, 1]);
    expect(Q.moveItem([1, 2, 3], 5, 0)).toEqual([1, 2, 3]);
  });

  test("duplicate gives fresh, unique ids", () => {
    const qs = Q.duplicateQuestion(quiz(), "q1", ids);
    expect(qs.length).toBe(3);
    expect(qs[1].question).toBe("Pick one");
    const all = qs.flatMap((q) => [q.question_id, ...q.answers.map((a) => a.answer_id)]);
    expect(new Set(all).size).toBe(all.length);
  });

  test("feedback and explanation are stored only when written", () => {
    const a = Q.withOptionalText({ answer_id: "a", answer: "A", correct: true }, "feedback", "Because.");
    expect(a.feedback).toBe("Because.");
    expect("feedback" in Q.withOptionalText(a, "feedback", "  ")).toBe(false);
  });

  test("new questions start as pick-one with two empty options", () => {
    const q = Q.newQuestion(ids);
    expect(q.response_type).toBe("single");
    expect(q.answers.length).toBe(2);
    expect(Q.hasCorrectAnswer(q)).toBe(false);
  });

  test("settings are stored compactly", () => {
    expect(Q.compactSettings({ ...Q.DEFAULT_QUIZ_SETTINGS, maxAttempts: 2, showCorrectAnswers: false })).toEqual({ maxAttempts: 2, showCorrectAnswers: false });
  });
});

describe("quiz taking", () => {
  test("pick-one replaces, select-all toggles", () => {
    const [q1, q2] = quiz();
    let s = Q.selectAnswer({}, q1, "a");
    s = Q.selectAnswer(s, q1, "b");
    expect(s.q1).toEqual(["b"]);
    s = Q.selectAnswer(s, q2, "x");
    s = Q.selectAnswer(s, q2, "y");
    s = Q.selectAnswer(s, q2, "x");
    expect(s.q2).toEqual(["y"]);
  });

  test("grading is all-or-nothing and skips questions with no key", () => {
    const qs = quiz();
    expect(Q.gradeQuiz(qs, { q1: ["a"], q2: ["x", "y"] })).toMatchObject({ correct: 2, graded: 2, allCorrect: true });
    expect(Q.gradeQuiz(qs, { q1: ["a"], q2: ["x"] })).toMatchObject({ correct: 1, graded: 2, allCorrect: false });
    const noKey = Q.updateQuestion(qs, "q2", (q) => ({ ...q, answers: q.answers.map((a) => ({ ...a, correct: false })) }));
    const g = Q.gradeQuiz(noKey, { q1: ["a"] });
    expect(g.results.q2).toBe("ungraded");
    expect(g).toMatchObject({ correct: 1, graded: 1, allCorrect: true });
  });

  test("an inferred multi-answer question (old data) needs every correct option", () => {
    const q = { question_id: "old", question: "?", type: "multiple_choice", answers: [
      { answer_id: "1", answer: "1", correct: true }, { answer_id: "2", answer: "2", correct: true }, { answer_id: "3", answer: "3", correct: false }] };
    expect(Q.responseTypeOf(q)).toBe("multiple");
    expect(Q.gradeQuestion(q, ["1"])).toBe("incorrect");
    expect(Q.gradeQuestion(q, ["1", "2"])).toBe("correct");
  });

  test("shuffling is stable for a seed, a permutation, and reorders", () => {
    const list = Array.from({ length: 8 }, (_, i) => i);
    expect(Q.shuffled(list, 42)).toEqual(Q.shuffled(list, 42));
    expect([...Q.shuffled(list, 42)].sort()).toEqual(list);
    const orders = new Set([1, 2, 3, 4, 5].map((s) => Q.shuffled(list, s).join()));
    expect(orders.size).toBeGreaterThan(1);
    const s = { ...Q.DEFAULT_QUIZ_SETTINGS, shuffleAnswers: true };
    const out = Q.learnerOrder(quiz(), s, 7);
    expect(out.map((q) => q.question_id)).toEqual(["q1", "q2"]);
    expect(out[0].answers.map((a) => a.answer_id).sort()).toEqual(["a", "b", "c"]);
  });

  test("attempts", () => {
    expect(Q.attemptsLeft(Q.DEFAULT_QUIZ_SETTINGS, 9)).toBeNull();
    expect(Q.attemptsLeft({ ...Q.DEFAULT_QUIZ_SETTINGS, maxAttempts: 2 }, 1)).toBe(1);
    expect(Q.attemptsLeft({ ...Q.DEFAULT_QUIZ_SETTINGS, maxAttempts: 2 }, 5)).toBe(0);
    expect(Q.answerLetter(0)).toBe("A");
    expect(Q.answerLetter(30)).toBe("?");
  });
});

describe("QuizBlock attrs survive copy/paste (HTML)", () => {
  const src = readFileSync(new URL("../components/Objects/Editor/Extensions/Quiz/QuizBlock.ts", import.meta.url), "utf8");
  test("questions and settings are JSON data-attributes", () => {
    expect(src).toContain("questions: jsonAttr('questions', [])");
    expect(src).toContain("settings: jsonAttr('settings', null)");
    expect(src).toContain("JSON.stringify(attrs[name])");
  });
});

describe("flipcards keep their old look", () => {
  const cards = nodesOf("flipcard");
  test("fixtures include flipcards", () => expect(cards.length).toBeGreaterThan(0));

  test("stored colours resolve to the same palette as before", () => {
    // The old block: amber was drawn orange, yellow amber, unknown keys blue.
    expect(F.flipcardFaces("amber", undefined).front).toContain("bg-orange-500");
    expect(F.flipcardFaces("yellow", undefined).front).toContain("bg-amber-500");
    expect(F.flipcardFaces("green", undefined).front).toContain("bg-emerald-500");
    expect(F.flipcardFaces("blue", undefined).back).toContain("bg-blue-600");
    // Same fill + border classes as the old getCardColor().
    expect(F.flipcardFaces("blue", undefined).front).toBe("bg-blue-500 text-white border-blue-600");
    expect(F.flipcardFaces("amber", "solid").back).toBe("bg-orange-600 text-white border-orange-700");
    expect(F.flipcardFaces("neutral", undefined).front).toContain("bg-neutral-600");
    expect(F.resolveFlipcardColor(undefined)).toBe("blue");
    expect(F.resolveFlipcardColor("nonsense")).toBe("blue");
    for (const c of cards) {
      expect(F.resolveFlipcardStyle(c.attrs.style)).toBe("solid");
      expect(F.flipcardFaces(c.attrs.color, c.attrs.style).front).toContain("text-white");
    }
  });

  test("colour names the AI writes map to a real colour instead of blue", () => {
    expect(cards.some((c) => c.attrs.color === "orange")).toBe(true);
    expect(F.resolveFlipcardColor("orange")).toBe("amber");
    expect(F.resolveFlipcardColor("Pink")).toBe("pink");
    expect(F.resolveFlipcardColor("violet")).toBe("purple");
  });

  test("sizes keep the old boxes; long text steps down", () => {
    expect(F.SIZE_BOX.medium).toEqual({ w: "w-80", h: "h-48" });
    expect(F.resolveFlipcardSize("huge")).toBe("medium");
    // Short text keeps the old sizes (small text-sm, medium text-lg, large text-xl).
    expect(F.faceTextClass("Short", "small")).toContain("text-sm");
    expect(F.faceTextClass("Short", "medium")).toContain("text-lg");
    expect(F.faceTextClass("Short", "large")).toContain("text-xl");
    expect(F.faceTextClass("x".repeat(100), "medium")).toContain("text-sm");
    expect(F.faceTextClass("x".repeat(200), "large")).toContain("text-xs");
  });

  test("every colour × style is spelled out (Tailwind needs literal classes)", () => {
    for (const c of F.FLIPCARD_COLORS)
      for (const s of F.FLIPCARD_STYLES) {
        const f = F.flipcardFaces(c, s);
        expect(f.front).toMatch(/\bbg-/);
        expect(f.back).toMatch(/\bbg-/);
        expect(f.front).toMatch(/\bborder-/);
      }
  });

  test("Flipcard declares the style attr with the old look as default", () => {
    const src = readFileSync(new URL("../components/Objects/Editor/Extensions/Flipcard/Flipcard.ts", import.meta.url), "utf8");
    expect(src).toMatch(/style: \{\s*default: 'solid'/);
  });
});
