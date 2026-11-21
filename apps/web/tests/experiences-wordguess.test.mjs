import { describe, expect, test } from "bun:test";

const M = await import("../components/Objects/Editor/Extensions/Experiences/WordGuess/wordGuessModel.ts");

const fold = (s) => M.letterCells(M.answerCells(s)).map((c) => c.fold);
const play = (round, word) => {
  let r = round;
  for (const ch of word) r = M.typeLetter(r, ch);
  return M.submitGuess(r);
};

describe("word guess model: normalize and example", () => {
  test("guards junk into a usable shape", () => {
    const d = M.normalizeWordGuess({ words: [null, { id: "a", answer: 5, clue: "c" }, { id: "a", answer: "x" }], maxGuesses: 99 });
    expect(d.words.map((w) => w.id)).toEqual(["a", "a_1"]);
    expect(d.words[0].answer).toBe("5");
    expect(d.maxGuesses).toBe(8);
    expect(M.normalizeWordGuess({ maxGuesses: "abc" }).maxGuesses).toBe(6);
    expect(M.normalizeWordGuess({ maxGuesses: 1 }).maxGuesses).toBe(3);
    expect(M.normalizeWordGuess({ words: "[{\"id\":\"w\",\"answer\":\"cat\",\"clue\":\"pet\"}]" }).words[0].answer).toBe("cat");
    expect(M.normalizeWordGuess(null)).toEqual({ blockId: "", title: "", words: [], maxGuesses: 6 });
  });

  test("example uses translation keys with English fallbacks and is playable", () => {
    const keys = [];
    const ex = M.exampleWordGuess((k, f) => (keys.push(k), f));
    expect(keys.every((k) => k.startsWith("editor.experiences.word_guess.example."))).toBe(true);
    expect(ex.words.map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
    expect(M.validateWordGuess({ blockId: "", ...ex }).filter((i) => i.severity === "error")).toEqual([]);
    expect(M.playableWordGuess({ blockId: "", ...ex }).words.length).toBe(3);
  });
});

describe("word guess model: letters", () => {
  test("folds case and Latin accents, keeps Indic marks", () => {
    expect(M.foldLetter("É")).toBe("e");
    expect(M.foldLetter("ç")).toBe("c");
    expect(M.foldLetter("Ё")).toBe("е");
    expect(M.foldLetter("ά")).toBe("α");
    expect(M.foldLetter("सू")).toBe("सू");
    expect(M.foldLetter("ß")).toBe("ß");
  });

  test("splits answers into letters and fixed gaps", () => {
    const cells = M.answerCells("  Big  bang-theory ");
    expect(cells.filter((c) => c.kind === "fixed").map((c) => c.char)).toEqual([" ", "-"]);
    expect(M.letterCells(cells).length).toBe(13);
    expect(fold("Café")).toEqual(["c", "a", "f", "e"]);
    expect(fold("सूरज")).toEqual(["सू", "र", "ज"]);
    expect(M.isRtlText("ذرة")).toBe(true);
    expect(M.isRtlText("atom")).toBe(false);
    expect(M.displayLetter("a")).toBe("A");
    expect(M.displayLetter("ß")).toBe("ß");
  });

  test("validation flags bad answers", () => {
    const v = (words) => M.validateWordGuess(M.normalizeWordGuess({ words })).map((i) => `${i.code}:${i.id ?? ""}`);
    expect(v([])).toEqual(["too_few_words:"]);
    expect(v([{ id: "a", answer: "", clue: "x" }])).toEqual(["empty_answer:a"]);
    expect(v([{ id: "a", answer: "r2d2", clue: "x" }])).toEqual(["bad_characters:a"]);
    expect(v([{ id: "a", answer: "a", clue: "x" }])).toEqual(["too_short:a"]);
    expect(v([{ id: "a", answer: "supercalifragilistic", clue: "x" }])).toEqual(["too_long:a"]);
    expect(v([{ id: "a", answer: "Café", clue: "" }, { id: "b", answer: "cafe", clue: "y" }])).toEqual(["empty_clue:a", "duplicate_answer:b"]);
    expect(v(Array.from({ length: 9 }, (_, i) => ({ id: `w${i}`, answer: "cat" + "s".repeat(i), clue: "c" })))[0]).toBe("too_many_words:");
    expect(M.badCharacters("hi!")).toEqual(["!"]);
    expect(M.isPlayableWord({ id: "x", answer: "ok", clue: "" })).toBe(true);
  });

  test("author edits", () => {
    let d = M.normalizeWordGuess({ words: [{ id: "a", answer: "cat", clue: "pet" }] });
    expect(M.removeWord(d, "a")).toBe(d);
    d = M.addWord(d, "b");
    expect(d.words.length).toBe(2);
    d = M.updateWord(d, "b", { answer: "dog", explanation: "woof" });
    expect(d.words[1]).toEqual({ id: "b", answer: "dog", clue: "", explanation: "woof" });
    expect(M.updateWord(d, "b", { explanation: "" }).words[1].explanation).toBeUndefined();
    expect(M.moveWord(d, "b", -1).words.map((w) => w.id)).toEqual(["b", "a"]);
    expect(M.moveWord(d, "a", -1)).toBe(d);
    expect(M.removeWord(d, "a").words.map((w) => w.id)).toEqual(["b"]);
    expect(M.setMaxGuesses(d, 4).maxGuesses).toBe(4);
    let full = d;
    for (let i = 0; i < 10; i++) full = M.addWord(full, `x${i}`);
    expect(full.words.length).toBe(8);
  });
});

describe("word guess model: scoring", () => {
  test("Wordle rules with duplicates", () => {
    expect(M.scoreGuess(fold("apple"), fold("apple"))).toEqual(["hit", "hit", "hit", "hit", "hit"]);
    expect(M.scoreGuess(fold("apple"), fold("paper"))).toEqual(["near", "near", "hit", "near", "miss"]);
    // Only one L left after the hit: the first L is a miss.
    expect(M.scoreGuess(fold("world"), fold("hello"))).toEqual(["miss", "miss", "miss", "hit", "near"]);
    expect(M.scoreGuess(fold("abbey"), fold("babes"))).toEqual(["near", "near", "hit", "hit", "miss"]);
    expect(M.scoreGuess(fold("crane"), fold("eerie"))).toEqual(["miss", "miss", "near", "miss", "hit"]);
    expect(M.scoreGuess(fold("café"), fold("CAFE"))).toEqual(["hit", "hit", "hit", "hit"]);
  });

  test("key states keep the best known state", () => {
    const s = M.keyStates([["a", "b"], ["b", "a"]], [["miss", "near"], ["hit", "miss"]]);
    expect(s).toEqual({ a: "miss", b: "hit" });
  });
});

describe("word guess model: a round", () => {
  test("typing, backspace, submit and solving", () => {
    let r = M.newRound("Cat", 3);
    expect(r.current).toEqual(["", "", ""]);
    r = M.typeLetter(r, "D");
    r = M.typeLetter(r, "o");
    expect(M.rowComplete(r)).toBe(false);
    expect(M.submitGuess(r).ok).toBe(false);
    r = M.backspace(M.typeLetter(r, "g"));
    expect(r.current).toEqual(["d", "o", ""]);
    r = M.typeLetter(M.typeLetter(r, "g"), "x");
    expect(r.current).toEqual(["d", "o", "g"]);
    const res = M.submitGuess(r);
    expect(res.ok).toBe(true);
    expect(res.round.scores[0]).toEqual(["miss", "miss", "miss"]);
    expect(res.round.current).toEqual(["", "", ""]);
    const won = play(res.round, "cât");
    expect(won.round.status).toBe("solved");
    expect(M.typeLetter(won.round, "a")).toBe(won.round);
    expect(M.backspace(won.round)).toBe(won.round);
    expect(M.backspace(M.newRound("ab", 3)).current).toEqual(["", ""]);
  });

  test("running out of guesses fails the word", () => {
    let r = M.newRound("cat", 3);
    for (const w of ["dog", "pig", "cow"]) r = play(r, w).round;
    expect(r.status).toBe("failed");
    expect(r.guesses.length).toBe(3);
    expect(M.submitGuess(r).ok).toBe(false);
    expect(M.canHint(r)).toBe(false);
  });

  test("hints reveal a letter in place, lock it and keep typed letters", () => {
    let r = M.newRound("atom", 6);
    r = M.typeLetter(r, "x");
    r = M.revealHint(r);
    expect(r.revealed).toEqual([0]);
    expect(r.current).toEqual(["a", "x", "", ""]);
    r = M.backspace(M.backspace(r));
    expect(r.current).toEqual(["a", "", "", ""]);
    r = M.revealHint(r, (n) => n - 1);
    expect(r.revealed).toEqual([0, 3]);
    r = M.typeLetter(M.typeLetter(r, "t"), "o");
    expect(r.current).toEqual(["a", "t", "o", "m"]);
    const after = M.submitGuess(r).round;
    expect(after.status).toBe("solved");
    // Letters already guessed in place are not hint candidates; one unknown left means no hint.
    let p = M.newRound("ab", 6);
    expect(M.canHint(p)).toBe(true);
    p = M.revealHint(p);
    expect(M.canHint(p)).toBe(false);
    expect(M.revealHint(p)).toBe(p);
    let q = play(M.newRound("abc", 6), "abx").round;
    expect(M.hintCandidates(q)).toEqual([2]);
    expect(M.canHint(q)).toBe(false);
    q = M.newRound("abcd", 6);
    expect(M.submitGuess(q).round.revealed).toEqual([]);
  });

  test("stars", () => {
    expect(M.wordStars(true, 0)).toBe(3);
    expect(M.wordStars(true, 1)).toBe(2);
    expect(M.wordStars(true, 5)).toBe(1);
    expect(M.wordStars(false, 0)).toBe(0);
    expect(M.blockStars([])).toBe(0);
    expect(M.blockStars([{ solved: true, hints: 0 }, { solved: true, hints: 0 }])).toBe(3);
    expect(M.blockStars([{ solved: true, hints: 0 }, { solved: true, hints: 0 }, { solved: true, hints: 1 }])).toBe(2);
    expect(M.blockStars([{ solved: true, hints: 0 }, { solved: false, hints: 0 }])).toBe(1);
  });
});

describe("word guess model: keyboard", () => {
  test("QWERTY for Latin, plus extra letters", () => {
    const rows = M.keyboardRows(["Straße", "café"]);
    expect(rows.slice(0, 3).map((r) => r.join(""))).toEqual(["qwertyuiop", "asdfghjkl", "zxcvbnm"]);
    expect(rows[3]).toEqual(["ß"]);
    expect(M.keyboardRows([])).toHaveLength(3);
  });

  test("full alphabet for Cyrillic, answers plus fillers for Indic, stable", () => {
    const ru = M.keyboardRows(["атом"]).flat();
    expect(ru).toContain("я");
    expect(ru).not.toContain("ґ");
    expect(M.keyboardRows(["атом"])).toEqual(M.keyboardRows(["атом"]));
    const uk = M.keyboardRows(["їжак"]).flat();
    expect(uk).toContain("ї");
    const hi = M.keyboardRows(["सूरज"]).flat();
    for (const g of ["सू", "र", "ज"]) expect(hi).toContain(g);
    expect(hi.length).toBeGreaterThanOrEqual(12);
    const ja = M.keyboardRows(["ほし"]).flat();
    expect(ja).toContain("ほ");
    expect(ja.indexOf("し")).toBeLessThan(ja.indexOf("ほ"));
    expect(M.keyboardRows(["ⴰⴱ"]).flat()).toEqual(["ⴰ", "ⴱ"]);
  });
});
