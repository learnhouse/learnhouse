import { describe, expect, test } from "bun:test";
import {
  normalizeSpeedRound,
  validateSpeedRound,
  playableQuestions,
  startClock,
  pauseClock,
  resumeClock,
  elapsedMs,
  remainingMs,
  remainingFraction,
  isTimeUp,
  secondsLeft,
  multiplierFor,
  pointsFor,
  newRound,
  answerQuestion,
  advance,
  starsForRound,
  unansweredIds,
  bestScore,
  BASE_POINTS,
  SPEED_BONUS,
  MAX_MULTIPLIER,
} from "../components/Objects/Editor/Extensions/Experiences/SpeedRound/speedRoundModel.ts";

const qs = [
  { id: "q1", prompt: "2+2", options: ["3", "4"], answer: 1 },
  { id: "q2", prompt: "Capital of France", options: ["Paris", "Rome", "Oslo"], answer: 0 },
  { id: "q3", prompt: "H2O is", options: ["Water", "Salt"], answer: 0 },
];

describe("normalize + validate", () => {
  test("clamps settings and answers", () => {
    const d = normalizeSpeedRound({ questions: [{ prompt: "p", options: ["a", "b"], answer: 9 }, null], secondsPerQuestion: 1, lives: "x" });
    expect(d.questions[0]).toEqual({ id: "q1", prompt: "p", options: ["a", "b"], answer: 1 });
    expect(d.secondsPerQuestion).toBe(3);
    expect(d.lives).toBe(3);
    expect(normalizeSpeedRound({ secondsPerQuestion: 999, lives: 0 })).toMatchObject({ secondsPerQuestion: 120, lives: 0 });
    expect(normalizeSpeedRound({ questions: [{ id: "a" }, { id: "a" }] }).questions.map((q) => q.id)).toEqual(["a", "a_"]);
  });
  test("issues", () => {
    expect(validateSpeedRound({ questions: [] }).map((i) => i.kind)).toEqual(["noQuestions"]);
    const kinds = validateSpeedRound({ questions: [{ id: "x", prompt: "", options: ["A", " a ", ""], answer: 5 }] }).map((i) => i.kind);
    expect(kinds).toEqual(["emptyPrompt", "emptyOption", "duplicateOption", "badAnswer"]);
    expect(validateSpeedRound({ questions: [{ id: "x", prompt: "p", options: ["a"], answer: 0 }] }).map((i) => i.kind)).toEqual(["fewOptions"]);
    expect(validateSpeedRound({ questions: qs })).toEqual([]);
    expect(playableQuestions({ questions: [...qs, { id: "z", prompt: "", options: ["a", "b"], answer: 0 }] })).toHaveLength(3);
  });
});

describe("clock (pure functions of time)", () => {
  test("elapsed excludes paused time", () => {
    let c = startClock(1000);
    expect(elapsedMs(c, 1500)).toBe(500);
    c = pauseClock(c, 2000);
    expect(pauseClock(c, 2500)).toBe(c);
    expect(elapsedMs(c, 9000)).toBe(1000);
    c = resumeClock(c, 5000);
    expect(resumeClock(c, 6000)).toBe(c);
    expect(elapsedMs(c, 5500)).toBe(1500);
    expect(elapsedMs(startClock(1000), 500)).toBe(0);
  });
  test("remaining, fraction, seconds left", () => {
    expect(remainingMs(2500, 10)).toBe(7500);
    expect(remainingMs(-5, 10)).toBe(10000);
    expect(remainingFraction(5000, 10)).toBe(0.5);
    expect(remainingFraction(1, 0)).toBe(0);
    expect(isTimeUp(10000, 10)).toBe(true);
    expect(isTimeUp(9999, 10)).toBe(false);
    expect(secondsLeft(800, 10)).toBe(10);
    expect(secondsLeft(10_500, 10)).toBe(0);
  });
});

describe("scoring", () => {
  test("multiplier steps and caps", () => {
    expect(multiplierFor(0)).toBe(1);
    expect(multiplierFor(3)).toBe(2);
    expect(multiplierFor(6)).toBe(3);
    expect(multiplierFor(100)).toBe(MAX_MULTIPLIER);
    expect(multiplierFor(-4)).toBe(1);
  });
  test("speed points; relaxed earns the base only", () => {
    expect(pointsFor(0, 10, 0, false)).toBe(BASE_POINTS + SPEED_BONUS);
    expect(pointsFor(5000, 10, 0, false)).toBe(BASE_POINTS + SPEED_BONUS / 2);
    expect(pointsFor(10000, 10, 3, false)).toBe(BASE_POINTS * 2);
    expect(pointsFor(0, 10, 0, true)).toBe(BASE_POINTS);
  });
});

describe("round flow", () => {
  test("combo, lives, misses, game over", () => {
    let s = newRound(2);
    s = answerQuestion(s, qs, 1, 0, 10, false);
    expect(s.score).toBe(200);
    expect(answerQuestion(s, qs, 1, 0, 10, false)).toBe(s); // already answered
    s = advance(s, qs.length);
    s = answerQuestion(s, qs, null, 10000, 10, false); // timeout
    expect(s.livesLeft).toBe(1);
    expect(s.combo).toBe(0);
    expect(s.misses).toEqual([{ questionId: "q2", choice: null }]);
    expect(unansweredIds(s, qs)).toEqual(["q3"]);
    s = advance(s, qs.length);
    s = answerQuestion(s, qs, 1, 0, 10, false);
    expect(s.livesLeft).toBe(0);
    s = advance(s, qs.length);
    expect(s.over).toBe(true);
    expect(advance(s, qs.length)).toBe(s);
    expect(answerQuestion(s, qs, 0, 0, 10, false)).toBe(s);
  });
  test("unlimited lives runs to the end", () => {
    let s = newRound(0);
    expect(s.livesLeft).toBe(null);
    for (let i = 0; i < qs.length; i++) s = advance(answerQuestion(s, qs, 99, 0, 10, false), qs.length);
    expect(s.over).toBe(true);
    expect(s.livesLeft).toBe(null);
    expect(s.misses).toHaveLength(3);
    expect(unansweredIds(s, qs)).toEqual([]);
    expect(advance(newRound(0), 3)).toEqual(newRound(0));
  });
  test("stars and best score", () => {
    expect(starsForRound(9, 10)).toBe(3);
    expect(starsForRound(6, 10)).toBe(2);
    expect(starsForRound(3, 10)).toBe(1);
    expect(starsForRound(0, 10)).toBe(0);
    expect(starsForRound(0, 0)).toBe(0);
    expect(bestScore("bad", 50)).toBe(50);
    expect(bestScore(80, 50)).toBe(80);
  });
});
