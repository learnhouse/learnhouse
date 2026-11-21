import { describe, expect, test } from "bun:test";

const M = await import("../components/Objects/Editor/Extensions/Experiences/Matrix/matrixModel.ts");

const grid = (extra = {}) =>
  M.normalizeMatrix({
    rows: [{ id: "r1", label: "Cat" }, { id: "r2", label: "Bird" }],
    columns: [{ id: "c1", label: "Fur" }, { id: "c2", label: "Wings" }, { id: "c3", label: "Legs" }],
    cells: { "r1:c1": true, "r1:c3": true, "r2:c2": true, "r2:c3": true },
    ...extra,
  });

describe("matrix model: normalize and example", () => {
  test("guards junk into a usable shape", () => {
    const d = M.normalizeMatrix({ rows: [null, { id: "a:b", label: 2 }, { id: "a_b" }], columns: "x", cells: "{\"a_b:c\":true}", mode: "weird" });
    expect(d.rows.map((r) => r.id)).toEqual(["a_b", "a_b_1"]);
    expect(d.rows[0].label).toBe("2");
    expect(d.columns).toEqual([]);
    expect(d.cells).toEqual({});
    expect(d.mode).toBe("multi");
    const g = M.normalizeMatrix({ rows: [{ id: "r" }], columns: [{ id: "c" }], cells: { "r:c": true, "r:x": true, "q:c": true, "r:c2": "yes", bad: true }, mode: "single" });
    expect(g.cells).toEqual({ "r:c": true });
    expect(g.mode).toBe("single");
    expect(M.normalizeMatrix({ cells: "{bad" }).cells).toEqual({});
    expect(M.normalizeMatrix({ cells: [1] }).cells).toEqual({});
  });

  test("example uses translation keys and validates clean", () => {
    const keys = [];
    const ex = M.exampleMatrix((k, f) => (keys.push(k), f));
    expect(keys.every((k) => k.startsWith("editor.experiences.matrix.example."))).toBe(true);
    const d = M.normalizeMatrix(ex);
    expect(d.cells).toEqual(ex.cells);
    expect(M.validateMatrix(d)).toEqual([]);
    expect(M.isPlayable(d)).toBe(true);
  });
});

describe("matrix model: validation", () => {
  test("flags shape and label problems", () => {
    const codes = (d) => M.validateMatrix(d).map((i) => `${i.code}:${i.id ?? ""}`);
    expect(codes(M.normalizeMatrix({}))).toEqual(["too_few_rows:", "too_few_columns:"]);
    const d = grid({ rows: [{ id: "r1", label: "Cat" }, { id: "r2", label: "" }, { id: "r3", label: "cat" }], columns: [{ id: "c1", label: "Fur" }, { id: "c2", label: "" }, { id: "c3", label: "Legs" }], cells: { "r1:c1": true } });
    expect(codes(d)).toEqual(["empty_row:r2", "row_no_tick:r2", "row_no_tick:r3", "empty_column:c2", "unused_column:c3", "duplicate_row:r3"]);
    const s = grid({ mode: "single" });
    expect(codes(s)).toEqual(["row_not_one:r1", "row_not_one:r2"]);
    const many = M.normalizeMatrix({ rows: Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, label: `R${i}` })), columns: Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, label: i ? `C${i}` : "R0" })), cells: {} });
    expect(codes(many).slice(0, 2)).toEqual(["too_many_rows:", "too_many_columns:"]);
    expect(codes(grid({ columns: [{ id: "c1", label: "Fur" }, { id: "c2", label: "fur" }] }))).toContain("duplicate_column:c2");
  });

  test("playable skips unnamed rows and unanswerable single rows", () => {
    const s = grid({ mode: "single", cells: { "r1:c1": true, "r2:c2": true, "r2:c3": true } });
    expect(M.playableMatrix(s).rows.map((r) => r.id)).toEqual(["r1"]);
    expect(M.isPlayable(s)).toBe(false);
    const p = M.playableMatrix(grid({ columns: [{ id: "c1", label: "Fur" }, { id: "c2", label: " " }, { id: "c3", label: "Legs" }] }));
    expect(p.columns.map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(p.cells).toEqual({ "r1:c1": true, "r1:c3": true, "r2:c3": true });
  });
});

describe("matrix model: author edits", () => {
  test("rows and columns keep the cells consistent", () => {
    let d = grid();
    d = M.addRow(d, "r3", "Fish");
    expect(d.rows.length).toBe(3);
    d = M.updateRow(d, "r3", "Shark");
    expect(d.rows[2].label).toBe("Shark");
    d = M.removeRow(d, "r1");
    expect(Object.keys(d.cells).sort()).toEqual(["r2:c2", "r2:c3"]);
    expect(M.removeRow(M.removeRow(d, "r2"), "r3").rows.length).toBe(2);
    d = M.addColumn(d, "c4", "Fins");
    d = M.updateColumn(d, "c4", "Gills");
    expect(d.columns[3].label).toBe("Gills");
    d = M.removeColumn(d, "c3");
    expect(Object.keys(d.cells)).toEqual(["r2:c2"]);
    let full = d;
    for (let i = 0; i < 10; i++) full = M.addColumn(M.addRow(full, `x${i}`), `y${i}`);
    expect(full.rows.length).toBe(8);
    expect(full.columns.length).toBe(6);
    const two = M.normalizeMatrix({ rows: [{ id: "a" }, { id: "b" }], columns: [{ id: "x" }, { id: "y" }] });
    expect(M.removeColumn(two, "x")).toBe(two);
  });

  test("toggling answer cells (multi and single)", () => {
    let d = grid();
    d = M.toggleAnswerCell(d, "r1", "c1");
    expect(d.cells["r1:c1"]).toBeUndefined();
    d = M.toggleAnswerCell(d, "r1", "c2");
    expect(M.rowTicks(d, "r1")).toEqual(["c2", "c3"]);
    const s = M.toggleAnswerCell({ ...d, mode: "single" }, "r1", "c1");
    expect(M.rowTicks(s, "r1")).toEqual(["c1"]);
    expect(M.rowTicks(s, "r2")).toEqual(["c2", "c3"]);
  });
});

describe("matrix model: learner", () => {
  test("toggle, check, retry (multi)", () => {
    const d = grid();
    let a = {};
    expect(M.canCheck(d, a)).toBe(false);
    a = M.toggleAnswer(d, a, "r1", "c1");
    a = M.toggleAnswer(d, a, "r1", "c2");
    a = M.toggleAnswer(d, a, "r2", "c3");
    a = M.toggleAnswer(d, a, "r2", "c1");
    a = M.toggleAnswer(d, a, "r2", "c1");
    expect(a).toEqual({ "r1:c1": true, "r1:c2": true, "r2:c3": true });
    expect(M.canCheck(d, a)).toBe(true);
    const c = M.checkMatrix(d, a);
    expect(c.results).toEqual({ "r1:c1": "tick", "r1:c2": "wrong", "r1:c3": "missed", "r2:c1": "blank", "r2:c2": "missed", "r2:c3": "tick" });
    expect(c.correct).toBe(3);
    expect(c.total).toBe(6);
    expect(c.stars).toBe(1);
    expect(c.perfect).toBe(false);
    expect(c.rowsCorrect).toEqual({ r1: false, r2: false });
    expect(M.retryWrong(d, a, c)).toEqual({ "r1:c1": true, "r2:c3": true });
    const perfect = M.checkMatrix(d, d.cells);
    expect(perfect.perfect).toBe(true);
    expect(perfect.stars).toBe(3);
  });

  test("single mode scores rows and replaces the pick", () => {
    const d = grid({ mode: "single", cells: { "r1:c1": true, "r2:c2": true } });
    let a = M.toggleAnswer(d, {}, "r1", "c3");
    a = M.toggleAnswer(d, a, "r1", "c1");
    expect(a).toEqual({ "r1:c1": true });
    expect(M.canCheck(d, a)).toBe(false);
    expect(M.toggleAnswer(d, a, "r1", "c1")).toEqual({});
    a = M.toggleAnswer(d, a, "r2", "c3");
    expect(M.canCheck(d, a)).toBe(true);
    const c = M.checkMatrix(d, a);
    expect(c.correct).toBe(1);
    expect(c.total).toBe(2);
    expect(c.stars).toBe(1);
    expect(M.retryWrong(d, a, c)).toEqual({ "r1:c1": true });
    expect(M.checkMatrix(M.normalizeMatrix({}), {}).stars).toBe(0);
  });

  test("arrow keys move across the grid, RTL aware", () => {
    expect(M.moveFocus({ r: 0, c: 0 }, "ArrowRight", 2, 3)).toEqual({ r: 0, c: 1 });
    expect(M.moveFocus({ r: 0, c: 0 }, "ArrowRight", 2, 3, true)).toBeNull();
    expect(M.moveFocus({ r: 0, c: 1 }, "ArrowLeft", 2, 3, true)).toEqual({ r: 0, c: 2 });
    expect(M.moveFocus({ r: 0, c: 1 }, "ArrowDown", 2, 3)).toEqual({ r: 1, c: 1 });
    expect(M.moveFocus({ r: 0, c: 1 }, "ArrowUp", 2, 3)).toBeNull();
    expect(M.moveFocus({ r: 1, c: 1 }, "End", 2, 3)).toEqual({ r: 1, c: 2 });
    expect(M.moveFocus({ r: 1, c: 1 }, "Home", 2, 3)).toEqual({ r: 1, c: 0 });
    expect(M.moveFocus({ r: 1, c: 1 }, "a", 2, 3)).toBeNull();
  });
});
