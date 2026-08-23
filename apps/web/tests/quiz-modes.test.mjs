import { describe, expect, test } from "bun:test";

import {
  inferQuizResponseType,
  resolveQuizGradingMode,
  resolveQuizResponseType,
  scoreQuizQuestion,
} from "../lib/quiz/modes.ts";

// These mirror apps/api/src/services/courses/activities/quiz_modes.py. The
// learner sees the grade this module computes (gradeFC's preview) and the
// server stores the grade the Python side computes, so the two must agree —
// the cases below are the same ones pinned in test_quiz_grading_edge.py.

const outcome = (correct, selected) => ({ correct, selected });

describe("resolveQuizResponseType", () => {
  test("infers single from a lone correct option", () => {
    expect(resolveQuizResponseType(undefined, 1)).toBe("single");
    expect(inferQuizResponseType(1)).toBe("single");
  });

  test("infers multiple from two or more correct options", () => {
    expect(resolveQuizResponseType(undefined, 2)).toBe("multiple");
    expect(inferQuizResponseType(3)).toBe("multiple");
  });

  test("infers single when no option is correct", () => {
    expect(resolveQuizResponseType(undefined, 0)).toBe("single");
  });

  test("an explicit value wins over inference", () => {
    expect(resolveQuizResponseType("multiple", 1)).toBe("multiple");
    expect(resolveQuizResponseType("  SINGLE ", 1)).toBe("single");
  });

  test("an unknown value falls back to inference", () => {
    expect(resolveQuizResponseType("pick_one_maybe", 2)).toBe("multiple");
    expect(resolveQuizResponseType(null, 2)).toBe("multiple");
    expect(resolveQuizResponseType(7, 1)).toBe("single");
  });
});

describe("resolveQuizGradingMode", () => {
  test("defaults to all-or-nothing", () => {
    expect(resolveQuizGradingMode(undefined)).toBe("all_or_nothing");
    expect(resolveQuizGradingMode(null)).toBe("all_or_nothing");
    expect(resolveQuizGradingMode("generous")).toBe("all_or_nothing");
  });

  test("reads partial credit when it is set", () => {
    expect(resolveQuizGradingMode("partial_credit")).toBe("partial_credit");
  });
});

describe("scoreQuizQuestion — all or nothing", () => {
  const key = (a, b, c, d) => [
    outcome(true, a),
    outcome(true, b),
    outcome(false, c),
    outcome(false, d),
  ];

  test("an exact set match is full credit", () => {
    expect(scoreQuizQuestion(key(true, true, false, false), "multiple", "all_or_nothing")).toBe(1);
  });

  test("a partial selection earns nothing", () => {
    expect(scoreQuizQuestion(key(true, false, false, false), "multiple", "all_or_nothing")).toBe(0);
  });

  test("a superset earns nothing", () => {
    expect(scoreQuizQuestion(key(true, true, true, false), "multiple", "all_or_nothing")).toBe(0);
  });

  test("a question with no correct option scores zero", () => {
    expect(
      scoreQuizQuestion([outcome(false, false), outcome(false, false)], "single", "all_or_nothing")
    ).toBe(0);
  });
});

describe("scoreQuizQuestion — partial credit", () => {
  const key = (a, b, c, d) => [
    outcome(true, a),
    outcome(true, b),
    outcome(false, c),
    outcome(false, d),
  ];

  test("an exact set match is still full credit", () => {
    expect(scoreQuizQuestion(key(true, true, false, false), "multiple", "partial_credit")).toBe(1);
  });

  test("half the correct options earns half", () => {
    expect(scoreQuizQuestion(key(true, false, false, false), "multiple", "partial_credit")).toBe(0.5);
  });

  test("a wrong pick cancels a right pick", () => {
    expect(scoreQuizQuestion(key(true, false, true, false), "multiple", "partial_credit")).toBe(0);
  });

  test("both correct plus one wrong earns half", () => {
    expect(scoreQuizQuestion(key(true, true, true, false), "multiple", "partial_credit")).toBe(0.5);
  });

  test("selecting everything earns nothing", () => {
    expect(scoreQuizQuestion(key(true, true, true, true), "multiple", "partial_credit")).toBe(0);
  });

  test("the score is clamped at zero", () => {
    const outcomes = [
      outcome(true, false),
      outcome(false, true),
      outcome(false, true),
      outcome(false, true),
    ];
    expect(scoreQuizQuestion(outcomes, "multiple", "partial_credit")).toBe(0);
  });

  test("three correct of five with two wrong picks", () => {
    const outcomes = [
      outcome(true, true),
      outcome(true, true),
      outcome(true, true),
      outcome(false, true),
      outcome(false, true),
    ];
    expect(scoreQuizQuestion(outcomes, "multiple", "partial_credit")).toBeCloseTo(1 / 3, 10);
  });

  test("single-response questions stay all-or-nothing", () => {
    const outcomes = [outcome(true, false), outcome(false, true), outcome(false, false)];
    expect(scoreQuizQuestion(outcomes, "single", "partial_credit")).toBe(0);
    const right = [outcome(true, true), outcome(false, false), outcome(false, false)];
    expect(scoreQuizQuestion(right, "single", "partial_credit")).toBe(1);
  });
});
