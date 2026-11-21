import { describe, expect, test } from "bun:test";

const M = await import("../components/Objects/Editor/Extensions/Experiences/Sequence/sequenceModel.ts");

const data = () => ({ ...M.exampleSequence(), blockId: "b" });

describe("sequence model: normalize and example", () => {
  test("guards junk", () => {
    const d = M.normalizeSequence({ items: [null, { text: 5, detail: "" }, { id: "s2", text: "b", detail: "1999" }], variant: "weird" });
    expect(d.items).toEqual([{ id: "s1", text: "5" }, { id: "s2", text: "b", detail: "1999" }]);
    expect(d.variant).toBe("list");
    expect(M.normalizeSequence({ variant: "timeline" }).variant).toBe("timeline");
    expect(M.normalizeSequence(null).items).toEqual([]);
  });

  test("example is valid and uses editor keys", () => {
    expect(M.validateSequence(data())).toEqual([]);
    const keys = [];
    M.exampleSequence((k, f) => (keys.push(k), f));
    expect(keys.every((k) => k.startsWith("editor.experiences.sequence.example."))).toBe(true);
  });
});

describe("sequence model: validation and edits", () => {
  test("flags counts, blanks, duplicates and missing timeline details", () => {
    const codes = (d) => M.validateSequence(d).map((i) => i.code);
    expect(codes({ ...data(), items: data().items.slice(0, 2) })).toContain("too_few_items");
    const many = Array.from({ length: 11 }, (_, i) => ({ id: `${i}`, text: `t${i}` }));
    expect(codes({ ...data(), items: many })).toContain("too_many_items");
    const d = data();
    d.items[0].text = " ";
    d.items[2].text = d.items[1].text.toUpperCase();
    const issues = M.validateSequence({ ...d, variant: "timeline" });
    expect(issues).toContainEqual({ code: "empty_item", id: "s1", severity: "error" });
    expect(issues).toContainEqual({ code: "duplicate_item", id: "s3", severity: "warning" });
    expect(issues).toContainEqual({ code: "missing_detail", id: "s2", severity: "warning" });
    expect(issues.find((i) => i.code === "missing_detail" && i.id === "s1")).toBeUndefined();
  });

  test("playable skips blanks", () => {
    const d = data();
    d.items[0].text = "";
    expect(M.playableSequence(d).items.length).toBe(3);
    expect(M.isPlayable(d)).toBe(true);
    expect(M.isPlayable({ ...d, items: d.items.slice(0, 3) })).toBe(false);
    expect(M.isPlayable(data())).toBe(true);
  });

  test("add / update / remove / move", () => {
    let d = M.addItem(data(), "n", "x");
    expect(d.items.at(-1)).toEqual({ id: "n", text: "x" });
    d = M.updateItem(d, "n", { detail: "1066" });
    expect(d.items.at(-1).detail).toBe("1066");
    d = M.updateItem(d, "n", { detail: "" });
    expect("detail" in d.items.at(-1)).toBe(false);
    expect(M.removeItem(d, "n").items.length).toBe(4);
    const three = { ...data(), items: data().items.slice(0, 3) };
    expect(M.removeItem(three, "s1")).toBe(three);
    const full = { ...data(), items: Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, text: `${i}` })) };
    expect(M.addItem(full, "z")).toBe(full);
    expect(M.moveItem(data(), 0, 2).items.map((i) => i.id)).toEqual(["s2", "s3", "s1", "s4"]);
    expect(M.moveInList([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
    expect(M.moveInList([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
  });
});

describe("sequence model: learner", () => {
  test("shuffleIds changes order and handles tiny lists", () => {
    expect(M.shuffleIds([1])).toEqual([1]);
    expect(M.shuffleIds([1, 2, 3], () => 0.9999)).toEqual([2, 3, 1]);
  });

  test("initialOrder is never already solved", () => {
    const d = data();
    for (let i = 0; i < 50; i++) expect(M.checkSequence(d, M.initialOrder(d)).perfect).toBe(false);
    // Duplicate texts: an id-level shuffle that is text-identical is rejected.
    const dup = { ...d, items: [{ id: "a", text: "x" }, { id: "b", text: "x" }, { id: "c", text: "y" }] };
    for (let i = 0; i < 20; i++) expect(M.checkSequence(dup, M.initialOrder(dup)).perfect).toBe(false);
    // An rng that always swaps the two "x" items forces the fallback swap.
    let k = 0;
    const forced = M.initialOrder(dup, () => (k++ % 2 === 0 ? 0.9 : 0.1));
    expect(forced).toEqual(["a", "c", "b"]);
    expect(M.checkSequence(dup, forced).perfect).toBe(false);
    const same = { ...d, items: [{ id: "a", text: "x" }, { id: "b", text: "x" }, { id: "c", text: "x" }] };
    expect(M.initialOrder(same).length).toBe(3);
    expect(M.initialOrder({ ...d, items: [{ id: "a", text: "x" }] })).toEqual(["a"]);
  });

  test("check counts in-place items by text", () => {
    const d = data();
    const ids = d.items.map((i) => i.id);
    let c = M.checkSequence(d, ids);
    expect(c).toMatchObject({ inPlace: 4, total: 4, perfect: true });
    c = M.checkSequence(d, ["s2", "s1", "s3", "s4"]);
    expect(c.inPlace).toBe(2);
    expect(c.positions).toMatchObject({ s1: false, s2: false, s3: true });
    expect(M.checkSequence(d, ["s1", "zz"]).perfect).toBe(false);
    const dup = { ...d, items: [{ id: "a", text: "x" }, { id: "b", text: "X " }, { id: "c", text: "y" }] };
    expect(M.checkSequence(dup, ["b", "a", "c"]).perfect).toBe(true);
    expect(M.correctPositions(d)).toMatchObject({ s1: 1, s4: 4 });
  });

  test("stars lose one on the second try", () => {
    const d = data();
    const perfect = M.checkSequence(d, d.items.map((i) => i.id));
    expect(M.sequenceStars(perfect, 1)).toBe(3);
    expect(M.sequenceStars(perfect, 2)).toBe(2);
    const half = M.checkSequence(d, ["s1", "s2", "s4", "s3"]);
    expect(M.sequenceStars(half, 1)).toBe(1);
    const mid = { inPlace: 4, total: 5, positions: {}, perfect: false };
    expect(M.sequenceStars(mid, 1)).toBe(2);
    expect(M.sequenceStars({ inPlace: 2, total: 5, positions: {}, perfect: false }, 1)).toBe(1);
    expect(M.sequenceStars({ inPlace: 1, total: 5, positions: {}, perfect: false }, 2)).toBe(0);
    expect(M.sequenceStars({ inPlace: 0, total: 0, positions: {}, perfect: false }, 1)).toBe(0);
    expect(M.SEQUENCE_MAX_ATTEMPTS).toBe(2);
  });
});
