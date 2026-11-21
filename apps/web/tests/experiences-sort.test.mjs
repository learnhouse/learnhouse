import { describe, expect, test } from "bun:test";

const M = await import("../components/Objects/Editor/Extensions/Experiences/Sort/sortModel.ts");

const seq = (...vals) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

describe("sort model: normalize", () => {
  test("guards junk into a usable shape", () => {
    const d = M.normalizeSort({ categories: [null, { id: "a", label: 3 }, { id: "a", label: "B", color: "pink" }], items: "x", shuffle: false });
    expect(d.categories.map((c) => c.id)).toEqual(["a", "a_1"]);
    expect(d.categories[0].label).toBe("3");
    expect(d.categories[1].color).toBe("rose");
    const colors = M.normalizeSort({ categories: [{ id: "a", color: "green" }, { id: "b", color: "Orange" }, { id: "c", color: "mauve" }, { id: "d", color: "sky" }] });
    expect(colors.categories.map((c) => c.color)).toEqual(["emerald", "amber", "emerald", "sky"]);
    expect(d.items).toEqual([]);
    expect(d.shuffle).toBe(false);
    expect(d.blockId).toBe("");
  });

  test("shuffle defaults to true; explanations kept only when set", () => {
    const d = M.normalizeSort({ items: [{ id: "x", text: "t", categoryId: "c", explanation: "" }, { text: "u", categoryId: "c", explanation: "why" }, { id: "x" }] });
    expect(d.shuffle).toBe(true);
    expect(d.items[0]).toEqual({ id: "x", text: "t", categoryId: "c" });
    expect(d.items[1].id).toBe("i2");
    expect(d.items[1].explanation).toBe("why");
    expect(d.items[2].id).toBe("x_2");
    expect(M.normalizeSort(undefined).categories).toEqual([]);
  });

  test("example is valid and translated through t", () => {
    const ex = M.exampleSort();
    expect(M.validateSort({ ...ex, blockId: "b" }).filter((i) => i.severity === "error")).toEqual([]);
    const keys = [];
    M.exampleSort((k, f) => (keys.push(k), f));
    expect(keys.every((k) => k.startsWith("editor.experiences.sort.example."))).toBe(true);
  });
});

describe("sort model: validation", () => {
  const base = () => ({ ...M.exampleSort(), blockId: "b" });
  test("flags counts, blanks, orphans, unused and duplicates", () => {
    const codes = (d) => M.validateSort(d).map((i) => i.code);
    expect(codes({ ...base(), categories: [base().categories[0]] })).toContain("too_few_categories");
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, label: `L${i}`, color: "sky" }));
    expect(codes({ ...base(), categories: many })).toContain("too_many_categories");
    expect(codes({ ...base(), items: [base().items[0]] })).toContain("too_few_items");
    const lots = Array.from({ length: 21 }, (_, i) => ({ id: `i${i}`, text: `t${i}`, categoryId: "c1" }));
    expect(codes({ ...base(), items: lots })).toContain("too_many_items");
    const d = base();
    d.categories[0].label = " ";
    d.items[1].text = "";
    d.items[2].categoryId = "nope";
    d.items[4].text = "natural GAS";
    const issues = M.validateSort(d);
    expect(issues).toContainEqual({ code: "empty_category", id: "c1", severity: "error" });
    expect(issues).toContainEqual({ code: "empty_item", id: "i2", severity: "error" });
    expect(issues).toContainEqual({ code: "item_no_category", id: "i3", severity: "error" });
    expect(issues).toContainEqual({ code: "duplicate_item", id: "i5", severity: "warning" });
    const unused = { ...base(), items: base().items.filter((i) => i.categoryId === "c1") };
    expect(M.validateSort(unused)).toContainEqual({ code: "unused_category", id: "c2", severity: "warning" });
  });

  test("playable drops blanks and orphans", () => {
    const d = base();
    d.items[0].text = "";
    d.items[1].categoryId = "zzz";
    const p = M.playableSort(d);
    expect(p.items.length).toBe(4);
    expect(M.isPlayable(d)).toBe(true);
    expect(M.isPlayable({ ...d, categories: [d.categories[0]] })).toBe(false);
  });
});

describe("sort model: edits", () => {
  const base = () => ({ ...M.exampleSort(), blockId: "b" });
  test("add / update / remove categories within limits", () => {
    let d = M.addCategory(base(), "c3", "Maybe");
    expect(d.categories[2]).toEqual({ id: "c3", label: "Maybe", color: "sky" });
    d = M.addCategory(d, "c4");
    expect(d.categories[3].color).toBe("rose");
    expect(M.addCategory(d, "c5")).toBe(d);
    d = M.updateCategory(d, "c4", { label: "X" });
    expect(d.categories[3].label).toBe("X");
    const removed = M.removeCategory(base(), "c1");
    expect(removed).toEqual(base());
    const three = M.addCategory(base(), "c3");
    const r = M.removeCategory(three, "c1");
    expect(r.categories.map((c) => c.id)).toEqual(["c2", "c3"]);
    expect(r.items.every((it) => it.categoryId !== "c1")).toBe(true);
    expect(M.removeCategory(three, "nope")).toBe(three);
  });

  test("nextColor cycles when all are used", () => {
    const cats = M.SORT_COLORS.map((c, i) => ({ id: String(i), label: "", color: c }));
    expect(M.nextColor(cats)).toBe("sky");
  });

  test("add / update / remove items within limits", () => {
    let d = M.addItem(base(), "n", "c2", "Sun");
    expect(d.items.at(-1)).toEqual({ id: "n", text: "Sun", categoryId: "c2" });
    expect(M.addItem(base(), "m", "bad").items.at(-1).categoryId).toBe("c1");
    expect(M.addItem({ ...base(), categories: [] }, "m").items.at(-1).categoryId).toBe("");
    d = M.updateItem(d, "n", { explanation: "star" });
    expect(d.items.at(-1).explanation).toBe("star");
    d = M.updateItem(d, "n", { explanation: "" });
    expect("explanation" in d.items.at(-1)).toBe(false);
    expect(M.removeItem(d, "n").items.length).toBe(6);
    const two = { ...base(), items: base().items.slice(0, 2) };
    expect(M.removeItem(two, "i1")).toBe(two);
    const full = { ...base(), items: Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, text: "t", categoryId: "c1" })) };
    expect(M.addItem(full, "x")).toBe(full);
  });
});

describe("sort model: learner", () => {
  const data = () => ({ ...M.exampleSort(), blockId: "b" });

  test("shuffleIds never returns the original order", () => {
    const ids = ["a", "b", "c", "d"];
    for (let s = 0; s < 50; s++) expect(M.shuffleIds(ids)).not.toEqual(ids);
    expect(M.shuffleIds(["a", "b"], () => 0.999)).toEqual(["b", "a"]);
    // A degenerate rng that keeps the order falls back to a rotation.
    expect(M.shuffleIds(ids, () => 0.9999)).not.toEqual(ids);
    expect(M.shuffleIds(["x"])).toEqual(["x"]);
    expect(M.shuffleIds([])).toEqual([]);
  });

  test("trayOrder respects the shuffle flag", () => {
    const d = data();
    expect(M.trayOrder({ ...d, shuffle: false })).toEqual(d.items.map((i) => i.id));
    expect(M.trayOrder(d, seq(0.1, 0.5, 0.9))).not.toEqual(d.items.map((i) => i.id));
  });

  test("placing, checking, stars and retrying wrong ones", () => {
    const d = data();
    let p = {};
    expect(M.allPlaced(d, p)).toBe(false);
    p = M.place(p, "i1", "c1");
    p = M.place(p, "i2", "c1");
    expect(M.unplacedIds(["i1", "i2", "i3"], p)).toEqual(["i3"]);
    let c = M.checkSort(d, p);
    expect(c.results).toMatchObject({ i1: "correct", i2: "wrong", i3: "unplaced" });
    expect(c.correct).toBe(1);
    expect(c.stars).toBe(0);
    const all = Object.fromEntries(d.items.map((i) => [i.id, i.categoryId]));
    c = M.checkSort(d, all);
    expect(c.perfect).toBe(true);
    expect(c.stars).toBe(3);
    const almost = { ...all, i2: "c1" };
    c = M.checkSort(d, almost);
    expect(c.stars).toBe(2);
    expect(M.allPlaced(d, almost)).toBe(true);
    const back = M.retryWrong(almost, c);
    expect(back.i2).toBeUndefined();
    expect(back.i1).toBe("c1");
    expect(M.place(back, "i1", null).i1).toBeNull();
  });

  test("starsForRatio thresholds", () => {
    expect(M.starsForRatio(0, 0)).toBe(0);
    expect(M.starsForRatio(10, 10)).toBe(3);
    expect(M.starsForRatio(7, 10)).toBe(2);
    expect(M.starsForRatio(4, 10)).toBe(1);
    expect(M.starsForRatio(3, 10)).toBe(0);
    expect(M.checkSort({ ...data(), items: [] }, {}).perfect).toBe(false);
  });
});
