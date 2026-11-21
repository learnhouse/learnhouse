import { describe, expect, test } from "bun:test";
import {
  normalizeMythFact,
  validateMythFact,
  playable,
  newDeck,
  answerCard,
  isRevealed,
  nextCard,
  isFinished,
  correctCount,
  misses,
  starsFor,
  swipeDistance,
  swipeDecision,
  tiltFor,
  swipeProgress,
  keyDecision,
  MAX_TILT_DEG,
  MAX_STATEMENTS,
} from "../components/Objects/Editor/Extensions/Experiences/MythFact/mythFactModel.ts";

const deck = [
  { id: "a", text: "Water boils at 100°C at sea level", isTrue: true, explanation: "" },
  { id: "b", text: "Goldfish have 3-second memory", isTrue: false, explanation: "Months." },
  { id: "c", text: "Bats are blind", isTrue: false, explanation: "" },
];

describe("normalizeMythFact", () => {
  test("tolerates junk and fills ids", () => {
    const d = normalizeMythFact({ statements: [null, { text: "x", isTrue: "true" }, { id: "x", text: 3 }], labels: 5 });
    expect(d.statements).toHaveLength(2);
    expect(d.statements[0]).toEqual({ id: "s1", text: "x", isTrue: true, explanation: "" });
    expect(d.statements[1].text).toBe("");
    expect(d.labels).toEqual({ true: "", false: "" });
    expect(normalizeMythFact(undefined).statements).toEqual([]);
  });
  test("dedupes ids and caps the count", () => {
    const many = Array.from({ length: 30 }, () => ({ id: "same", text: "t", isTrue: false }));
    const d = normalizeMythFact({ statements: many });
    expect(d.statements).toHaveLength(MAX_STATEMENTS);
    expect(new Set(d.statements.map((s) => s.id)).size).toBe(MAX_STATEMENTS);
  });
});

describe("validateMythFact", () => {
  test("flags too few, empty and one-sided decks", () => {
    expect(validateMythFact({ statements: [deck[0]] }).map((i) => i.kind)).toEqual(["tooFew"]);
    const kinds = validateMythFact({ statements: [{ ...deck[1], text: " " }, deck[2]] }).map((i) => i.kind);
    expect(kinds).toEqual(["emptyText", "oneSided"]);
    expect(validateMythFact({ statements: deck })).toEqual([]);
    expect(validateMythFact({ statements: Array.from({ length: 21 }, (_, i) => ({ ...deck[i % 3], id: `${i}` })) }).map((i) => i.kind)).toContain("tooMany");
  });
  test("playable skips blank statements", () => {
    expect(playable({ statements: [...deck, { id: "z", text: "", isTrue: true }] })).toHaveLength(3);
  });
});

describe("deck flow", () => {
  test("streak, reveal, next, finish, misses", () => {
    let s = newDeck();
    expect(isRevealed(s)).toBe(false);
    expect(nextCard(s)).toBe(s);
    s = answerCard(s, deck, true);
    expect(isRevealed(s)).toBe(true);
    expect(s.streak).toBe(1);
    s = nextCard(s);
    s = answerCard(s, deck, true); // wrong
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(1);
    s = nextCard(answerCard(nextCard(s), deck, false));
    expect(isFinished(s, deck)).toBe(true);
    expect(correctCount(s)).toBe(2);
    expect(misses(s, deck).map((m) => m.id)).toEqual(["b"]);
    expect(answerCard(s, deck, true)).toBe(s);
    expect(isFinished(newDeck(), [])).toBe(false);
  });
  test("stars", () => {
    expect(starsFor(3, 3)).toBe(3);
    expect(starsFor(7, 10)).toBe(2);
    expect(starsFor(4, 10)).toBe(1);
    expect(starsFor(1, 10)).toBe(0);
    expect(starsFor(0, 0)).toBe(0);
  });
});

describe("swipe", () => {
  test("threshold scales with width and is capped", () => {
    expect(swipeDistance(200)).toBeCloseTo(56);
    expect(swipeDistance(2000)).toBe(120);
    expect(swipeDistance(0)).toBeCloseTo(84);
  });
  test("decision respects threshold and direction", () => {
    expect(swipeDecision(30, 300)).toBe(null);
    expect(swipeDecision(100, 300)).toBe(true);
    expect(swipeDecision(-100, 300)).toBe(false);
    expect(swipeDecision(-100, 300, true)).toBe(true);
    expect(swipeDecision(NaN, 300)).toBe(null);
  });
  test("tilt is clamped and signed", () => {
    expect(tiltFor(0, 300)).toBe(0);
    expect(tiltFor(10_000, 300)).toBe(MAX_TILT_DEG);
    expect(tiltFor(-10_000, 300)).toBe(-MAX_TILT_DEG);
    expect(tiltFor(NaN, 300)).toBe(0);
    expect(swipeProgress(42, 300)).toBeCloseTo(0.5);
    expect(swipeProgress(1000, 300)).toBe(1);
    expect(swipeProgress(NaN, 300)).toBe(0);
  });
  test("arrow keys follow the inline end", () => {
    expect(keyDecision("ArrowRight")).toBe(true);
    expect(keyDecision("ArrowLeft")).toBe(false);
    expect(keyDecision("ArrowLeft", true)).toBe(true);
    expect(keyDecision("ArrowRight", true)).toBe(false);
    expect(keyDecision("Enter")).toBe(null);
  });
});
