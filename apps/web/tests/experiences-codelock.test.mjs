import { describe, expect, test } from "bun:test";
import {
  normalizeCodeLock,
  validateCodeLock,
  playableClues,
  normalizeAnswer,
  answersMatch,
  newLock,
  tryClue,
  takeHint,
  isOpen,
  starsFor,
  dialFace,
  MAX_CLUES,
} from "../components/Objects/Editor/Extensions/Experiences/CodeLock/codeLockModel.ts";

const clues = [
  { id: "a", question: "Planets in the solar system?", answer: "8", hint: "Pluto is out" },
  { id: "b", question: "Capital of Iceland?", answer: "Reykjavík", hint: "" },
];

describe("normalize + validate", () => {
  test("coerces and caps", () => {
    const d = normalizeCodeLock({ clues: [{ answer: 7 }, null, ...Array.from({ length: 9 }, () => ({ id: "x" }))], reward: 1 });
    expect(d.clues).toHaveLength(MAX_CLUES);
    expect(d.clues[0]).toEqual({ id: "c1", question: "", answer: "7", hint: "" });
    expect(d.clues[2].id).toBe("x_");
    expect(d.reward).toBe("1");
    expect(normalizeCodeLock(null).clues).toEqual([]);
  });
  test("issues", () => {
    expect(validateCodeLock({ clues: [], reward: "" }).map((i) => i.kind)).toEqual(["noClues", "emptyReward"]);
    const kinds = validateCodeLock({ clues: [{ id: "x", question: "", answer: "" }, { id: "y", question: "q", answer: "x".repeat(41) }], reward: "ok" }).map((i) => i.kind);
    expect(kinds).toEqual(["emptyQuestion", "emptyAnswer", "longAnswer"]);
    expect(validateCodeLock({ clues, reward: "Well done" })).toEqual([]);
    expect(playableClues({ clues: [...clues, { id: "z", question: "q", answer: " " }] })).toHaveLength(2);
  });
});

describe("fuzzy match", () => {
  test("trim, case, accents, whitespace", () => {
    expect(answersMatch("  reykjavik ", "Reykjavík")).toBe(true);
    expect(answersMatch("NEW   york", "new york")).toBe(true);
    expect(answersMatch("Ångström", "angstrom")).toBe(true);
    expect(answersMatch("oslo", "Reykjavík")).toBe(false);
  });
  test("numeric equivalence", () => {
    expect(answersMatch("7.0", "7")).toBe(true);
    expect(answersMatch("07", "7")).toBe(true);
    expect(answersMatch("3,5", "3.5")).toBe(true);
    expect(answersMatch("1,000", "1000")).toBe(true);
    expect(answersMatch(".5", "0.5")).toBe(true);
    expect(answersMatch("-0", "0")).toBe(true);
    expect(answersMatch("7.1", "7")).toBe(false);
    expect(normalizeAnswer("1 000")).toBe("#1000");
    expect(normalizeAnswer(undefined)).toBe("");
  });
  test("empty answer never matches", () => {
    expect(answersMatch("", "")).toBe(false);
    expect(answersMatch("x", "  ")).toBe(false);
  });
});

describe("lock state", () => {
  test("solve, wrong attempts, hints, open", () => {
    let s = newLock();
    let r = tryClue(s, clues[0], "  ");
    expect(r.correct).toBe(false);
    expect(r.state).toBe(s);
    r = tryClue(s, clues[0], "9");
    expect(r.state.wrong.a).toBe(1);
    s = takeHint(r.state, clues[0]);
    expect(s.hints).toEqual(["a"]);
    expect(takeHint(s, clues[0])).toBe(s);
    expect(takeHint(s, clues[1])).toBe(s); // no hint text
    s = tryClue(s, clues[0], "8.0").state;
    expect(tryClue(s, clues[0], "nope").correct).toBe(true);
    expect(isOpen(s, clues)).toBe(false);
    s = tryClue(s, clues[1], "reykjavik").state;
    expect(isOpen(s, clues)).toBe(true);
    expect(isOpen(s, [])).toBe(false);
    expect(takeHint(s, clues[0])).toBe(s); // solved
  });
  test("stars: each hint costs one, floor of one", () => {
    expect(starsFor(0)).toBe(3);
    expect(starsFor(1)).toBe(2);
    expect(starsFor(5)).toBe(1);
    expect(starsFor(-1)).toBe(3);
  });
  test("dial never leaks the answer before it is solved", () => {
    expect(dialFace(clues[1], false)).toBe("?");
    expect(dialFace(clues[1], true)).toBe("Reykjav…");
    expect(dialFace(clues[0], true)).toBe("8");
  });
});
