import { describe, expect, test } from "bun:test";
import {
  normalizeEstimate,
  validateEstimate,
  decimalsOf,
  sliderRange,
  snapGuess,
  startGuess,
  offByPct,
  starsFor,
  formatPct,
  easeOutCubic,
  revealValue,
  revealAxis,
  formatValue,
  direction,
  REVEAL_MS,
} from "../components/Objects/Editor/Extensions/Experiences/Estimate/estimateModel.ts";

const base = { question: "How tall is Everest?", min: 0, max: 10000, step: 1, answer: 8849, unit: "m", tolerancePct: 10, explanation: "" };

describe("normalize + validate", () => {
  test("coerces numbers", () => {
    const d = normalizeEstimate({ min: "5", max: "x", step: null, answer: 7, tolerancePct: 500 });
    expect(d).toMatchObject({ min: 5, max: 100, step: 1, answer: 7, tolerancePct: 100 });
    expect(normalizeEstimate({ min: "  " }).min).toBe(0);
  });
  test("issues", () => {
    expect(validateEstimate(base)).toEqual([]);
    expect(validateEstimate({ ...base, question: "", min: 10, max: 5 })).toEqual(["emptyQuestion", "minNotBelowMax"]);
    expect(validateEstimate({ ...base, step: 0 })).toContain("stepNotPositive");
    expect(validateEstimate({ ...base, step: 20000 })).toContain("stepTooLarge");
    expect(validateEstimate({ ...base, step: 0.001 })).toContain("tooManySteps");
    expect(validateEstimate({ ...base, answer: 12000 })).toEqual(["answerOutside"]);
    expect(validateEstimate({ ...base, step: 10, answer: 8849 })).toEqual(["answerOffStep"]);
    expect(validateEstimate({ ...base, step: 0.1, max: 10, answer: 0.3 })).toEqual([]);
  });
});

describe("range and snapping", () => {
  test("decimals", () => {
    expect(decimalsOf(1)).toBe(0);
    expect(decimalsOf(0.25)).toBe(2);
    expect(decimalsOf(1e-7)).toBe(7);
    expect(decimalsOf(NaN)).toBe(0);
  });
  test("broken settings still give a usable slider", () => {
    expect(sliderRange({ ...base, min: 10, max: 0 })).toEqual({ min: 0, max: 10, step: 1 });
    expect(sliderRange({ ...base, min: 5, max: 5 })).toEqual({ min: 4, max: 6, step: 1 });
    expect(sliderRange({ ...base, step: -1 }).step).toBe(100);
  });
  test("snap clamps and avoids float noise", () => {
    const r = { min: 0, max: 1, step: 0.1 };
    expect(snapGuess(0.30000000000000004, r)).toBe(0.3);
    expect(snapGuess(0.26, r)).toBe(0.3);
    expect(snapGuess(-5, r)).toBe(0);
    expect(snapGuess(99, r)).toBe(1);
    expect(snapGuess(NaN, r)).toBe(0);
    expect(snapGuess(9, { min: 0, max: 10, step: 4 })).toBe(8);
    expect(startGuess({ min: 0, max: 10000, step: 1 })).toBe(5000);
  });
});

describe("scoring", () => {
  test("off by %", () => {
    expect(offByPct(90, 100, { min: 0, max: 200 })).toBe(10);
    expect(offByPct(10, 0, { min: 0, max: 200 })).toBe(5);
    expect(offByPct(1, 0, { min: 3, max: 3 })).toBe(100);
  });
  test("stars by tolerance", () => {
    expect(starsFor(10, 10)).toBe(3);
    expect(starsFor(15, 10)).toBe(2);
    expect(starsFor(35, 10)).toBe(1);
    expect(starsFor(50, 10)).toBe(0);
    expect(starsFor(0, 0)).toBe(3);
    expect(starsFor(4, 0)).toBe(2);
    expect(starsFor(10, 0)).toBe(1);
    expect(starsFor(20, 0)).toBe(0);
  });
  test("format and direction", () => {
    expect(formatPct(4.26)).toBe("4.3");
    expect(formatPct(12.6)).toBe("13");
    expect(formatPct(Infinity)).toBe("∞");
    expect(direction(1, 2)).toBe("low");
    expect(direction(3, 2)).toBe("high");
    expect(direction(2, 2)).toBe("exact");
    expect(formatValue(1234.5, 0.5, "en")).toBe("1,234.5");
    expect(formatValue(3, 1, "bad-locale-xx-yy-zz-!!")).toBe("3");
  });
});

describe("reveal animation", () => {
  test("easing endpoints", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
  });
  test("value over time", () => {
    expect(revealValue(0, 100, 0)).toBe(0);
    expect(revealValue(0, 100, REVEAL_MS)).toBe(100);
    expect(revealValue(0, 100, REVEAL_MS * 3)).toBe(100);
    expect(revealValue(0, 100, 5, 0)).toBe(100);
  });
  test("axis widens for an answer outside the range", () => {
    const a = revealAxis({ min: 0, max: 100 }, 150);
    expect(a.max).toBe(150);
    expect(a.pos(150)).toBe(1);
    expect(a.pos(75)).toBe(0.5);
    expect(a.pos(-10)).toBe(0);
    expect(revealAxis({ min: 5, max: 5 }, 5).pos(5)).toBe(0);
  });
});
