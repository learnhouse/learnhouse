import { describe, expect, test } from "bun:test";

const M = await import("../components/Objects/Editor/Extensions/Experiences/Match/matchModel.ts");

const data = () => ({ ...M.exampleMatch(), blockId: "b" });

describe("match model: normalize, example, validation", () => {
  test("guards junk", () => {
    const d = M.normalizeMatch({ pairs: [1, { left: "a", right: 2 }, { id: "p1" }], mode: "memory" });
    expect(d.pairs).toEqual([{ id: "p1", left: "a", right: "2" }, { id: "p1_1", left: "", right: "" }]);
    expect(d.mode).toBe("memory");
    expect(M.normalizeMatch({}).mode).toBe("connect");
  });

  test("example is valid and uses editor keys", () => {
    expect(M.validateMatch(data())).toEqual([]);
    const keys = [];
    M.exampleMatch((k, f) => (keys.push(k), f));
    expect(keys.every((k) => k.startsWith("editor.experiences.match.example."))).toBe(true);
  });

  test("flags counts, blanks and duplicates", () => {
    const codes = (d) => M.validateMatch(d).map((i) => i.code);
    expect(codes({ ...data(), pairs: data().pairs.slice(0, 1) })).toContain("too_few_pairs");
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `${i}`, left: `l${i}`, right: `r${i}` }));
    expect(codes({ ...data(), pairs: many })).toContain("too_many_pairs");
    const d = data();
    d.pairs[0].left = "";
    d.pairs[1].right = " ";
    d.pairs[3] = { id: "p4", left: "kenya", right: "x" };
    d.pairs.push({ id: "p5", left: "Kenya", right: "Nairobi" });
    const issues = M.validateMatch(d);
    expect(issues).toContainEqual({ code: "empty_left", id: "p1", severity: "error" });
    expect(issues).toContainEqual({ code: "empty_right", id: "p2", severity: "error" });
    expect(issues).toContainEqual({ code: "duplicate_left", id: "p4", severity: "warning" });
    expect(issues).toContainEqual({ code: "duplicate_pair", id: "p5", severity: "warning" });
  });

  test("playable and edits", () => {
    const d = data();
    d.pairs[0].right = "";
    expect(M.playableMatch(d).pairs.length).toBe(3);
    expect(M.isPlayable(d)).toBe(true);
    expect(M.isPlayable({ ...d, pairs: d.pairs.slice(0, 2) })).toBe(false);
    let e = M.addPair(data(), "n");
    expect(e.pairs.at(-1)).toEqual({ id: "n", left: "", right: "" });
    e = M.updatePair(e, "n", { left: "Peru" });
    expect(e.pairs.at(-1).left).toBe("Peru");
    expect(M.removePair(e, "n").pairs.length).toBe(4);
    const two = { ...data(), pairs: data().pairs.slice(0, 2) };
    expect(M.removePair(two, "p1")).toBe(two);
    const full = { ...data(), pairs: Array.from({ length: 8 }, (_, i) => ({ id: `${i}`, left: "a", right: "b" })) };
    expect(M.addPair(full, "z")).toBe(full);
  });
});

describe("match model: shared helpers", () => {
  test("shuffleIds and isMatch with shared right texts", () => {
    expect(M.shuffleIds([1])).toEqual([1]);
    expect(M.shuffleIds([1, 2, 3], () => 0.9999)).toEqual([2, 3, 1]);
    for (let i = 0; i < 30; i++) expect(M.shuffleIds([1, 2, 3])).not.toEqual([1, 2, 3]);
    const d = { ...data(), pairs: [{ id: "a", left: "2+2", right: "4" }, { id: "b", left: "3+1", right: "4 " }, { id: "c", left: "1+1", right: "2" }] };
    expect(M.isMatch(d, "a", "a")).toBe(true);
    expect(M.isMatch(d, "a", "b")).toBe(true);
    expect(M.isMatch(d, "a", "c")).toBe(false);
    expect(M.isMatch(d, "zz", "zz")).toBe(false);
    expect(M.isMatch(d, "zz", "a")).toBe(false);
  });
});

describe("match model: connect", () => {
  test("correct pairs lock, wrong ones count as mistakes", () => {
    const d = data();
    let s = M.emptyConnect();
    let r = M.tryConnect(d, s, "p1", "p2");
    expect(r.correct).toBe(false);
    expect(r.state.mistakes).toBe(1);
    s = r.state;
    r = M.tryConnect(d, s, "p1", "p1");
    expect(r.correct).toBe(true);
    s = r.state;
    // Already locked cards are ignored and do not count as mistakes.
    r = M.tryConnect(d, s, "p1", "p3");
    expect(r.state).toBe(s);
    expect(M.connectDone(d, s)).toBe(false);
    for (const id of ["p2", "p3", "p4"]) s = M.tryConnect(d, s, id, id).state;
    expect(M.connectDone(d, s)).toBe(true);
    expect(M.connectDone({ ...d, pairs: [] }, s)).toBe(false);
  });

  test("connect stars", () => {
    expect(M.connectStars(0, 0)).toBe(0);
    expect(M.connectStars(0, 6)).toBe(3);
    expect(M.connectStars(2, 6)).toBe(2);
    expect(M.connectStars(3, 6)).toBe(1);
  });
});

describe("match model: memory", () => {
  test("deck has both sides of each pair, shuffled", () => {
    const d = data();
    const deck = M.memoryDeck(d);
    expect(deck.length).toBe(8);
    expect(new Set(deck.map((c) => c.key)).size).toBe(8);
    expect(deck.filter((c) => c.side === "left").length).toBe(4);
  });

  test("flip, match, miss, close and done", () => {
    const d = data();
    const deck = [
      { key: "p1:l", pairId: "p1", side: "left", text: "France" },
      { key: "p2:r", pairId: "p2", side: "right", text: "Tokyo" },
      { key: "p1:r", pairId: "p1", side: "right", text: "Paris" },
      { key: "p2:l", pairId: "p2", side: "left", text: "Japan" },
    ];
    const dd = { ...d, pairs: d.pairs.slice(0, 2) };
    let s = M.emptyMemory();
    let r = M.flipCard(dd, deck, s, 0);
    expect(r.result).toBe("first");
    s = r.state;
    expect(M.flipCard(dd, deck, s, 0).result).toBe("ignored");
    r = M.flipCard(dd, deck, s, 1);
    expect(r.result).toBe("miss");
    expect(r.state.moves).toBe(1);
    s = r.state;
    expect(M.closeMiss(s).open).toEqual([]);
    expect(M.closeMiss(M.emptyMemory())).toEqual(M.emptyMemory());
    // Flipping a third card while a miss shows closes the miss first.
    r = M.flipCard(dd, deck, s, 2);
    expect(r.result).toBe("first");
    expect(r.state.open).toEqual([2]);
    s = r.state;
    r = M.flipCard(dd, deck, s, 0);
    expect(r.result).toBe("match");
    s = r.state;
    expect(s.matched).toEqual(["p1:r", "p1:l"]);
    expect(M.flipCard(dd, deck, s, 0).result).toBe("ignored");
    expect(M.flipCard(dd, deck, s, 9).result).toBe("ignored");
    // Two cards of the same side never match.
    const twoLeft = M.flipCard(dd, deck, M.flipCard(dd, deck, M.emptyMemory(), 0).state, 3);
    expect(twoLeft.result).toBe("miss");
    s = M.flipCard(dd, deck, M.flipCard(dd, deck, s, 1).state, 3).state;
    expect(M.memoryDone(deck, s)).toBe(true);
    expect(M.memoryDone([], s)).toBe(false);
    expect(s.moves).toBe(3);
  });

  test("memory stars and best moves", () => {
    expect(M.memoryStars(5, 0)).toBe(0);
    expect(M.memoryStars(6, 4)).toBe(3);
    expect(M.memoryStars(10, 4)).toBe(2);
    expect(M.memoryStars(11, 4)).toBe(1);
    expect(M.betterMoves(null, 7)).toBe(7);
    expect(M.betterMoves(5, 7)).toBe(5);
    expect(M.betterMoves(9, 7)).toBe(7);
    expect(M.betterMoves(0, 7)).toBe(7);
    expect(M.betterMoves(Number.NaN, 7)).toBe(7);
  });
});
