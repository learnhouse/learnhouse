import { describe, expect, test } from "bun:test";

const M = await import("../components/Objects/Editor/Extensions/Experiences/Label/labelModel.ts");

const seq = (...vals) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

describe("label model: normalize", () => {
  test("guards junk into a usable shape", () => {
    const d = M.normalizeLabel({ pins: [null, { id: "a", x: 140, y: -3, label: 7 }, { id: "a", x: "x", label: "B" }], distractors: ["s", 4, null, {}], imageObject: [] });
    expect(d.pins).toEqual([
      { id: "a", x: 100, y: 0, label: "7" },
      { id: "a_1", x: 50, y: 50, label: "B" },
    ]);
    expect(d.distractors).toEqual(["s", "4"]);
    expect(d.imageObject).toBe(null);
    expect(d.imageUrl).toBe("");
    expect(d.blockId).toBe("");
  });

  test("example plays without an image and is translatable", () => {
    const ex = M.exampleLabel();
    expect(ex.imageUrl).toBe("");
    expect(M.isPlayable({ blockId: "", ...ex })).toBe(true);
    const codes = M.validateLabel({ blockId: "", ...ex }).map((i) => i.code);
    expect(codes).toEqual(["no_image"]);
    const tr = M.exampleLabel((key) => `T:${key}`);
    expect(tr.pins[0].label).toBe("T:editor.experiences.label.example.flower");
    expect(tr.distractors[0]).toBe("T:editor.experiences.label.example.seed");
  });
});

describe("label model: validation and authoring", () => {
  test("flags too few pins, empty and duplicate labels, distractor clashes", () => {
    const d = M.normalizeLabel({ imageUrl: "x.png", pins: [{ id: "1", label: "Leaf" }], distractors: ["leaf", "a", "b", "c", "d"] });
    const issues = M.validateLabel(d);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("too_few_pins");
    expect(codes).toContain("too_many_distractors");
    expect(issues.find((i) => i.code === "distractor_is_label").index).toBe(0);
    const dup = M.normalizeLabel({ imageUrl: "x", pins: [{ id: "1", label: "A" }, { id: "2", label: " a " }, { id: "3", label: "" }] });
    const dupIssues = M.validateLabel(dup);
    expect(dupIssues.find((i) => i.code === "duplicate_label").id).toBe("2");
    expect(dupIssues.find((i) => i.code === "empty_label").id).toBe("3");
  });

  test("playable skips empty pins and clashing / blank distractors", () => {
    const d = M.normalizeLabel({ pins: [{ id: "1", label: "A" }, { id: "2", label: "" }, { id: "3", label: "B" }], distractors: ["a", " ", "C", "D", "E", "F", "G"] });
    const p = M.playableLabel(d);
    expect(p.pins.map((x) => x.id)).toEqual(["1", "3"]);
    expect(p.distractors).toEqual(["C", "D", "E", "F"]);
    expect(M.isPlayable(M.normalizeLabel({ pins: [{ id: "1", label: "A" }] }))).toBe(false);
  });

  test("pin and distractor edits", () => {
    let d = M.normalizeLabel({ pins: [] });
    d = M.addPin(d, "a", 10.123, 120);
    expect(d.pins[0]).toEqual({ id: "a", x: 10.12, y: 100, label: "" });
    d = M.nudgePin(d, "a", -20, -5);
    expect(d.pins[0]).toMatchObject({ x: 0, y: 95 });
    d = M.movePin(d, "a", 40, 40);
    d = M.updatePin(d, "a", { label: "Leaf" });
    expect(d.pins[0]).toEqual({ id: "a", x: 40, y: 40, label: "Leaf" });
    expect(M.nudgePin(d, "nope", 1, 1)).toBe(d);
    for (let i = 0; i < 15; i++) d = M.addPin(d, `p${i}`, 1, 1);
    expect(d.pins.length).toBe(12);
    d = M.removePin(d, "a");
    expect(d.pins.length).toBe(11);
    let x = M.normalizeLabel({});
    for (let i = 0; i < 6; i++) x = M.addDistractor(x, `d${i}`);
    expect(x.distractors).toEqual(["d0", "d1", "d2", "d3"]);
    x = M.updateDistractor(x, 1, "z");
    x = M.removeDistractor(x, 0);
    expect(x.distractors).toEqual(["z", "d2", "d3"]);
  });

  test("pointToPercent", () => {
    expect(M.pointToPercent(150, 75, { left: 100, top: 50, width: 200, height: 100 })).toEqual({ x: 25, y: 25 });
    expect(M.pointToPercent(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 50, y: 50 });
  });
});

describe("label model: learner", () => {
  const d = M.normalizeLabel({ blockId: "b", ...M.exampleLabel() });

  test("bank has every label plus the distractors, shuffled", () => {
    const bank = M.labelBank(d);
    expect(bank.length).toBe(6);
    expect(bank[0]).toEqual({ id: "p:p1", text: "Flower" });
    expect(bank.at(-1)).toEqual({ id: "d:1", text: "Thorn" });
    const order = M.bankOrder(d, seq(0.999999));
    expect(order).not.toEqual(bank.map((c) => c.id));
    expect([...order].sort()).toEqual(bank.map((c) => c.id).sort());
  });

  test("placing keeps one chip per pin and one pin per chip", () => {
    let p = {};
    p = M.placeLabel(p, "p:p1", "p1");
    p = M.placeLabel(p, "p:p2", "p1"); // replaces: p:p1 goes back
    expect(p).toEqual({ p1: "p:p2" });
    p = M.placeLabel(p, "p:p2", "p3"); // moves
    expect(p).toEqual({ p3: "p:p2" });
    expect(M.pinOfChip(p, "p:p2")).toBe("p3");
    expect(M.pinOfChip(p, "p:p1")).toBe(null);
    expect(M.unplacedChips(["p:p1", "p:p2"], p)).toEqual(["p:p1"]);
    p = M.placeLabel(p, "p:p2", null);
    expect(p).toEqual({});
  });

  test("check by text, stars, retry", () => {
    const perfect = { p1: "p:p1", p2: "p:p2", p3: "p:p3", p4: "p:p4" };
    expect(M.allLabelled(d, perfect)).toBe(true);
    const c = M.checkLabel(d, perfect);
    expect(c.perfect).toBe(true);
    expect(c.stars).toBe(3);
    const mixed = { p1: "p:p1", p2: "d:0", p3: "p:p3", p4: "p:p2" };
    const m = M.checkLabel(d, mixed);
    expect(m.correct).toBe(2);
    expect(m.results.p2).toBe("wrong");
    expect(m.stars).toBe(1);
    expect(M.retryWrong(mixed, m)).toEqual({ p1: "p:p1", p3: "p:p3" });
    expect(M.checkLabel(d, {}).results.p1).toBe("empty");
    // Same label on two pins: either chip counts.
    const twin = M.normalizeLabel({ pins: [{ id: "a", label: "Bone" }, { id: "b", label: "bone" }] });
    expect(M.checkLabel(twin, { a: "p:b", b: "p:a" }).perfect).toBe(true);
  });
});
