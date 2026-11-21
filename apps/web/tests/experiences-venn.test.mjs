import { describe, expect, test } from "bun:test";

const M = await import("../components/Objects/Editor/Extensions/Experiences/Venn/vennModel.ts");

const seq = (...vals) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

describe("venn model: normalize", () => {
  test("guards junk into a usable shape", () => {
    const d = M.normalizeVenn({ sets: "nope", items: [null, { id: "x", text: 3, zone: "OVERLAP" }, { id: "x", text: "b", zone: "weird" }], showNeither: "yes" });
    expect(d.sets.a.color).toBe("sky");
    expect(d.sets.b.color).toBe("amber");
    expect(d.items.map((i) => i.id)).toEqual(["x", "x_1"]);
    expect(d.items[0]).toEqual({ id: "x", text: "3", zone: "both" });
    expect(d.items[1].zone).toBe("a");
    expect(d.showNeither).toBe(false);
    expect(d.blockId).toBe("");
  });

  test("colour aliases and JSON strings", () => {
    const d = M.normalizeVenn({ sets: JSON.stringify({ a: { label: "A", color: "Green" }, b: { label: "B", color: "purple" } }), items: JSON.stringify([{ id: "i", text: "t", zone: "none", explanation: "" }]) });
    expect(d.sets.a).toEqual({ label: "A", color: "emerald" });
    expect(d.sets.b.color).toBe("violet");
    expect(d.items[0]).toEqual({ id: "i", text: "t", zone: "neither" });
  });

  test("example is valid and translatable", () => {
    const ex = M.exampleVenn();
    expect(M.validateVenn({ blockId: "", ...ex }).filter((i) => i.severity === "error")).toEqual([]);
    expect(ex.items.some((i) => i.zone === "both")).toBe(true);
    const tr = M.exampleVenn((key) => `T:${key}`);
    expect(tr.sets.a.label).toBe("T:editor.experiences.venn.example.set_a");
    expect(tr.items[0].id).toBe("i1");
  });
});

describe("venn model: validation and authoring", () => {
  const base = () => M.normalizeVenn({ blockId: "b", ...M.exampleVenn() });

  test("flags empty set names, too few items and hidden neither items", () => {
    const d = M.normalizeVenn({ sets: { a: { label: "" }, b: { label: " " } }, items: [{ id: "1", text: "x", zone: "neither" }, { id: "2", text: "X", zone: "a" }, { id: "3", text: "" }] });
    const codes = M.validateVenn(d).map((i) => i.code);
    expect(codes).toContain("empty_set_a");
    expect(codes).toContain("empty_set_b");
    expect(codes).toContain("too_few_items");
    expect(codes).toContain("neither_hidden");
    expect(codes).toContain("duplicate_item");
    expect(codes).toContain("empty_item");
    expect(M.isPlayable(d)).toBe(false);
  });

  test("warns when nothing is in the overlap and when labels match", () => {
    const d = M.normalizeVenn({ sets: { a: { label: "Cats" }, b: { label: "cats" } }, items: [{ id: "1", text: "x", zone: "a" }, { id: "2", text: "y", zone: "b" }, { id: "3", text: "z", zone: "a" }] });
    const codes = M.validateVenn(d).map((i) => i.code);
    expect(codes).toContain("no_both");
    expect(codes).toContain("same_labels");
  });

  test("add / remove respect limits; update drops empty explanation", () => {
    let d = base();
    d = M.addItem(d, "n", "both", "new");
    expect(d.items.at(-1)).toEqual({ id: "n", text: "new", zone: "both" });
    d = M.updateItem(d, "n", { explanation: "why" });
    expect(d.items.at(-1).explanation).toBe("why");
    d = M.updateItem(d, "n", { explanation: "" });
    expect("explanation" in d.items.at(-1)).toBe(false);
    d = M.removeItem(d, "n");
    expect(d.items.length).toBe(6);
    const three = M.normalizeVenn({ items: [{ id: "1" }, { id: "2" }, { id: "3" }] });
    expect(M.removeItem(three, "1").items.length).toBe(3);
    let full = three;
    for (let i = 0; i < 20; i++) full = M.addItem(full, `x${i}`);
    expect(full.items.length).toBe(16);
    expect(M.updateSet(d, "b", { label: "Z" }).sets.b.label).toBe("Z");
  });

  test("cycleColor skips the other set's colour", () => {
    expect(M.cycleColor("sky", "amber")).toBe("emerald");
    expect(M.cycleColor("violet", "sky")).toBe("amber");
  });

  test("playable drops neither items unless the well shows", () => {
    const d = M.normalizeVenn({ sets: { a: { label: "A" }, b: { label: "B" } }, items: [{ id: "1", text: "a", zone: "a" }, { id: "2", text: "b", zone: "b" }, { id: "3", text: "c", zone: "both" }, { id: "4", text: "n", zone: "neither" }] });
    expect(M.playableVenn(d).items.length).toBe(3);
    expect(M.activeZones(d)).toEqual(["a", "both", "b"]);
    const on = { ...d, showNeither: true };
    expect(M.playableVenn(on).items.length).toBe(4);
    expect(M.activeZones(on)).toEqual(["a", "both", "b", "neither"]);
  });
});

describe("venn model: learner", () => {
  const d = M.normalizeVenn({ blockId: "b", ...M.exampleVenn() });

  test("tray is shuffled, never the authored order", () => {
    const order = M.trayOrder(d, seq(0.99));
    expect(order.sort()).toEqual(d.items.map((i) => i.id).sort());
    expect(M.trayOrder(d, seq(0.999999))).not.toEqual(d.items.map((i) => i.id));
  });

  test("place, unplaced and allPlaced", () => {
    let p = {};
    p = M.place(p, "i1", "a");
    expect(M.unplacedIds(["i1", "i2"], p)).toEqual(["i2"]);
    expect(M.allPlaced(d, p)).toBe(false);
    p = M.place(p, "i1", null);
    expect(M.unplacedIds(["i1"], p)).toEqual(["i1"]);
  });

  test("check: perfect, stars and the overlap flag", () => {
    const perfect = Object.fromEntries(d.items.map((i) => [i.id, i.zone]));
    const c = M.checkVenn(d, perfect);
    expect(c.perfect).toBe(true);
    expect(c.stars).toBe(3);
    expect(c.overlapRight).toBe(true);

    const wrong = { ...perfect, i1: "both", i5: "a" };
    const w = M.checkVenn(d, wrong);
    expect(w.correct).toBe(4);
    expect(w.results.i1).toBe("wrong");
    expect(w.overlapRight).toBe(false); // an extra item crept into the overlap
    expect(w.stars).toBe(1);

    const retry = M.retryWrong(wrong, w);
    expect(retry.i1).toBeUndefined();
    expect(retry.i3).toBe("both");

    const unplaced = M.checkVenn(d, {});
    expect(unplaced.results.i1).toBe("unplaced");
    expect(unplaced.stars).toBe(0);
  });
});
