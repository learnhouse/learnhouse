// Editor Plus tables (EDITOR_PLUS_SPEC.md, section A): the extended table
// nodes render stored tables exactly as the stock nodes did, typed cells keep
// their value in their text and render their visual from the schema (so the
// editor, DynamicCanva and the static renderer all draw it), and the learner
// sort, totals, paste and editing commands behave.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const domWindow = new Window({ url: "http://localhost/" });
for (const key of [
  "document", "navigator", "HTMLElement", "Element", "Node", "Text", "DocumentFragment", "MutationObserver", "Range",
  "Selection", "DOMParser", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "CustomEvent", "Event",
  "KeyboardEvent", "MouseEvent", "InputEvent", "NodeFilter", "DOMException", "localStorage", "sessionStorage",
]) {
  if (domWindow[key] !== undefined && globalThis[key] === undefined) globalThis[key] = domWindow[key];
}
globalThis.window ??= domWindow;
document.documentElement.lang = "en";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { Editor, getSchema, getHTMLFromFragment } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const { Table } = await import("@tiptap/extension-table");
const { default: TableRow } = await import("@tiptap/extension-table-row");
const { default: TableCell } = await import("@tiptap/extension-table-cell");
const { default: TableHeader } = await import("@tiptap/extension-table-header");
const { ReactNodeViewContentProvider } = await import("@tiptap/react");
const { renderToHTMLString } = await import("@tiptap/static-renderer/pm/html-string");
const { CellSelection } = await import("@tiptap/pm/tables");
const { DOMParser: PMDOMParser } = await import("@tiptap/pm/model");

const TABLES = "../components/Objects/Editor/Extensions/Plus/tables/";
const A = await import(`${TABLES}tableAttrs.ts`);
const M = await import(`${TABLES}tableModel.ts`);
const { createTableNodes } = await import(`${TABLES}tableNodes.ts`);
const { tableFromText, typedCellsKey } = await import(`${TABLES}tablePlugins.ts`);
const C = await import(`${TABLES}tableCommands.ts`);
const { makeStaticTable } = await import(`${TABLES}StaticTable.tsx`);
const { DEFAULT_TABLE_LABELS } = await import(`${TABLES}tableView.ts`);
const T = await import(`${TABLES}templates.tsx`);
const { tableExtensions } = await import(`${TABLES}index.ts`);
const { tableTemplateItems: tableSlashItems } = await import(`${TABLES}templates.tsx`);

const base = StarterKit.configure({ codeBlock: false, undoRedo: false });
const stockSchema = getSchema([base, Table, TableRow, TableHeader, TableCell]);
const plusExtensions = (mode = "editor") => [base, ...createTableNodes({ mode })];
const plusSchema = getSchema(plusExtensions());

const p = (text) => (text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" });
const cell = (text, attrs, type = "tableCell") => ({ type, ...(attrs ? { attrs } : {}), content: [p(text)] });
const row = (...cells) => ({ type: "tableRow", content: cells });
const doc = (...content) => ({ type: "doc", content });
const html = (schema, json) => getHTMLFromFragment(schema.nodeFromJSON(json).content, schema);

// Every table stored in the real activity fixtures.
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/editor-blocks/db-activities.json", import.meta.url), "utf8"));
const storedTables = [];
(function collect(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(collect);
  if (node.type === "table") storedTables.push(node);
  collect(node.content);
})(fixtures.map((f) => f.content));

const loadable = (schema) =>
  storedTables.filter((t) => {
    try {
      schema.nodeFromJSON(doc(t)).check();
      return true;
    } catch {
      return false;
    }
  });

describe("stored tables render exactly as before", () => {
  const tables = loadable(stockSchema);

  test("the fixtures hold real tables", () => {
    expect(storedTables.length).toBeGreaterThan(0);
    expect(tables.length).toBe(storedTables.length);
  });

  test("same HTML as the stock table nodes", () => {
    for (const t of tables) expect(html(plusSchema, doc(t))).toBe(html(stockSchema, doc(t)));
  });

  test("same HTML through the static renderer (@learnhouse/react, old clients)", () => {
    for (const t of tables) {
      const stock = renderToHTMLString({ content: doc(t), extensions: [base, Table, TableRow, TableHeader, TableCell] });
      const plus = renderToHTMLString({ content: doc(t), extensions: plusExtensions("learner") });
      expect(plus).toBe(stock);
    }
  });

  test("stored attrs survive and the new ones sit at their defaults", () => {
    for (const t of tables) {
      const out = plusSchema.nodeFromJSON(doc(t)).toJSON().content[0];
      expect(out.attrs).toMatchObject({ ...(t.attrs || {}), ...A.TABLE_ATTR_DEFAULTS });
      out.content.forEach((r, ri) =>
        r.content.forEach((c, ci) => {
          const old = t.content[ri].content[ci];
          expect(c.attrs).toMatchObject({ ...(old.attrs || {}) });
          for (const [k, v] of Object.entries(A.CELL_ATTR_DEFAULTS)) if (!(k in (old.attrs || {}))) expect([k, c.attrs[k]]).toEqual([k, v]);
          expect(c.content).toEqual(old.content);
        }),
      );
    }
  });

  test("HTML written by the new nodes parses back to the same document", () => {
    const parse = (schema, markup) => {
      const el = document.createElement("div");
      el.innerHTML = markup;
      return PMDOMParser.fromSchema(schema).parse(el).toJSON();
    };
    const typed = doc({
      type: "table",
      attrs: { variant: "striped", caption: "Q3 plan", totals: "sum", sortable: true, stickyHeader: true, compact: true, headerColumn: false },
      content: [
        row(cell("Task", null, "tableHeader"), cell("Points", null, "tableHeader")),
        row(cell("Draft", { cellType: "status", tone: "green", background: "teal", valign: "middle" }), cell("8", { cellType: "number", numberFormat: "currency", currency: "EUR", align: "end" })),
      ],
    });
    const node = plusSchema.nodeFromJSON(typed);
    const reparsed = parse(plusSchema, html(plusSchema, typed));
    expect(reparsed).toEqual(node.toJSON());
  });
});

describe("typed cell values", () => {
  test("numbers in common notations", () => {
    expect(A.parseNumber("1,234.5")).toBe(1234.5);
    expect(A.parseNumber("1.234,5")).toBe(1234.5);
    expect(A.parseNumber("1,5")).toBe(1.5);
    expect(A.parseNumber("$ 12")).toBe(12);
    expect(A.parseNumber("-3")).toBe(-3);
    expect(A.parseNumber("12 %")).toBe(12);
    expect(A.parseNumber("1.000.000")).toBe(1000000);
    expect(A.parseNumber("abc")).toBeNull();
    expect(A.parseNumber("")).toBeNull();
  });

  test("progress from a percentage, a share or a fraction, clamped", () => {
    expect(A.parseProgress("75")).toBe(75);
    expect(A.parseProgress("75%")).toBe(75);
    expect(A.parseProgress("0.5")).toBe(50);
    expect(A.parseProgress("3/4")).toBe(75);
    expect(A.parseProgress("140")).toBe(100);
    expect(A.parseProgress("-5")).toBe(0);
    expect(A.parseProgress("soon")).toBeNull();
  });

  test("checkboxes, ratings, dates", () => {
    for (const s of ["yes", "True", "1", "✓", "x"]) expect(A.parseCheckbox(s)).toBe(true);
    for (const s of ["no", "FALSE", "0", "✗", ""]) expect(A.parseCheckbox(s)).toBe(false);
    expect(A.parseCheckbox("maybe")).toBeNull();
    expect(A.toggledCheckboxText("yes")).toBe("no");
    expect(A.toggledCheckboxText("No")).toBe("Yes");
    expect(A.toggledCheckboxText("✓")).toBe("✗");
    expect(A.toggledCheckboxText("")).toBe("✓");
    expect(A.parseRating("4")).toEqual({ value: 4, max: 5 });
    expect(A.parseRating("7/10")).toEqual({ value: 7, max: 10 });
    expect(A.parseRating("★★★☆☆")).toEqual({ value: 3, max: 5 });
    expect(A.parseRating("great")).toBeNull();
    expect(A.parseDate("2026-03-01").toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(A.parseDate("2026-02-31")).toBeNull();
    expect(A.parseDate("no date")).toBeNull();
  });

  test("what each type shows", () => {
    const v = (type, text, attrs = {}) => A.typedCellView(type, attrs, text, "en");
    expect(v("progress", "75")).toMatchObject({ display: "75%", percent: 75, tone: "blue" });
    expect(v("progress", "100").tone).toBe("green");
    expect(v("checkbox", "yes")).toMatchObject({ display: "✓", state: "on" });
    expect(v("checkbox", "no")).toMatchObject({ display: "✗", state: "off" });
    expect(v("rating", "4/5").display).toBe("★★★★☆");
    expect(v("status", "Done").tone).toBe("green");
    expect(v("status", "Blocked").tone).toBe("red");
    expect(v("status", "In progress", { tone: "purple" }).tone).toBe("purple");
    expect(v("number", "1234.5").display).toBe("1,234.5");
    expect(v("number", "1234.5", { numberFormat: "currency", currency: "EUR" }).display).toBe("€1,234.50");
    expect(v("number", "25", { numberFormat: "percent" }).display).toBe("25%");
    expect(v("number", "1500000", { numberFormat: "compact" }).display).toBe("1.5M");
    expect(v("date", "2026-03-01").display).toBe("Mar 1, 2026");
    expect(v("text", "hello").display).toBeNull();
  });

  test("a text cell renders no extra attributes; a typed one renders its visual", () => {
    expect(A.typedCellAttrs({ cellType: "text" }, "75")).toEqual({});
    expect(A.typedCellAttrs({}, "75")).toEqual({});
    expect(A.typedCellAttrs({ cellType: "progress" }, "75", "en")).toEqual({
      "aria-label": "75",
      "data-lh-display": "75%",
      "data-lh-tone": "blue",
      style: "background-size: 75% 6px, 100% 6px",
    });
    expect(A.typedCellAttrs({ cellType: "checkbox", tone: "pink" }, "yes", "en")).toEqual({ "aria-label": "yes", "data-lh-display": "✓", "data-lh-state": "on" });
  });

  test("default attrs add nothing to the table element", () => {
    expect(A.tableDataAttrs(A.TABLE_ATTR_DEFAULTS)).toEqual({});
    expect(A.tableDataAttrs({ variant: "cards", sortable: true, totals: "average", stickyHeader: true, compact: true, headerColumn: true })).toEqual({
      "data-variant": "cards",
      "data-sortable": "",
      "data-totals": "average",
      "data-sticky-header": "",
      "data-compact": "",
      "data-header-column": "",
    });
  });
});

const TRACKER = doc({
  type: "table",
  attrs: { sortable: true, totals: "sum", caption: "Sprint", variant: "cards" },
  content: [
    row(cell("Task", null, "tableHeader"), cell("Points", null, "tableHeader"), cell("Progress", null, "tableHeader")),
    row(cell("B"), cell("5", { cellType: "number" }), cell("50", { cellType: "progress" })),
    row(cell("A"), cell("", { cellType: "number" }), cell("100", { cellType: "progress" })),
    row(cell("C"), cell("2", { cellType: "number" }), cell("0", { cellType: "progress" })),
    row(cell("D"), cell("5", { cellType: "number" }), cell("", { cellType: "progress" })),
  ],
});

describe("table model", () => {
  const model = M.readTableModel(plusSchema.nodeFromJSON(TRACKER).firstChild);

  test("columns, header rows and labels", () => {
    expect(model.width).toBe(3);
    expect(model.headerRows).toBe(1);
    expect(model.columnTypes).toEqual(["text", "number", "progress"]);
    expect(model.columnLabels).toEqual(["Task", "Points", "Progress"]);
    expect(model.canSort).toBe(true);
  });

  test("stable sort by type, header first, empty values last both ways", () => {
    expect(M.sortRowOrder(model, 1, "asc")).toEqual([0, 3, 1, 4, 2]);
    expect(M.sortRowOrder(model, 1, "desc")).toEqual([0, 1, 4, 3, 2]);
    expect(M.sortRowOrder(model, 0, "desc")).toEqual([0, 4, 3, 1, 2]);
    expect(M.sortRowOrder(model, 2, "asc")).toEqual([0, 3, 1, 2, 4]);
  });

  test("row spans disable sorting", () => {
    const spanned = plusSchema.nodeFromJSON(doc({ type: "table", content: [row(cell("a", { rowspan: 2 }), cell("b")), row(cell("c"))] })).firstChild;
    const m = M.readTableModel(spanned);
    expect(m.canSort).toBe(false);
    expect(M.sortRowOrder(m, 0, "asc")).toEqual([0, 1]);
  });

  test("totals: sum or average of number columns, progress always averages", () => {
    expect(M.computeTotals(model, "sum", "en")).toEqual({ labelCol: 0, values: [null, "12", "50%"] });
    expect(M.computeTotals(model, "average", "en")).toEqual({ labelCol: 0, values: [null, "4", "50%"] });
    expect(M.computeTotals(model, "none")).toBeNull();
    const plain = M.readTableModel(plusSchema.nodeFromJSON(doc({ type: "table", content: [row(cell("a"), cell("b"))] })).firstChild);
    expect(M.computeTotals(plain, "sum")).toBeNull();
  });

  test("card labels are escaped CSS strings", () => {
    const css = M.cardLabelsCss("lh-table-1", { ...model, columnLabels: ['Say "hi"', "", "</style>"] });
    const r1 = '#lh-table-1 tr > :nth-child(1)::before{content:"Say \\"hi\\""}';
    const r3 = '#lh-table-1 tr > :nth-child(3)::before{content:"\\3C /style>"}';
    const narrow = ".lh-bt:is([data-lh-bt-size='xs'],[data-lh-bt-size='sm'])";
    expect(css).toBe(`@media (max-width: 640px){${r1}${r3}}${narrow} ${r1}${narrow} ${r3}`);
  });

  test("card labels only apply where rows become cards", () => {
    expect(M.cardLabelsCss("t", { ...model, columnLabels: ["", ""] })).toBe("");
    expect(M.cardLabelsCss("t", { ...model, columnLabels: ["A"] }).startsWith("@media (max-width: 640px){#t tr")).toBe(true);
  });
});

describe("renderHTML carries the visuals (static renderer, old clients)", () => {
  const out = html(plusSchema, TRACKER);

  test("table attrs, caption and totals footer", () => {
    expect(out).toContain('data-variant="cards"');
    expect(out).toContain('data-sortable=""');
    expect(out).toContain("<caption>Sprint</caption><colgroup>");
    expect(out).toContain('<tfoot data-lh-totals="" class="lh-table-totals"><tr><td class="lh-table-totals-label">Total</td><td class="lh-table-totals-value">12</td><td class="lh-table-totals-value">50%</td></tr></tfoot>');
  });

  test("typed cells keep their text and add the visual attributes", () => {
    expect(out).toContain('<td data-cell-type="progress" aria-label="50" data-lh-display="50%" data-lh-tone="blue" style="background-size: 50% 6px, 100% 6px;"><p>50</p></td>');
    expect(out).toContain('<td data-cell-type="number" aria-label="5" data-lh-display="5"><p>5</p></td>');
  });

  test("the static string renderer gives the same markup", () => {
    const s = renderToHTMLString({ content: TRACKER, extensions: plusExtensions("learner") });
    expect(s).toContain('data-lh-display="50%"');
    expect(s).toContain("lh-table-totals");
  });
});

describe("StaticTable (StaticCanva, @learnhouse/react)", () => {
  const StaticTable = makeStaticTable(() => DEFAULT_TABLE_LABELS);
  const node = plusSchema.nodeFromJSON(TRACKER).firstChild;
  const rows = [];
  node.forEach((r, _o, i) => rows.push(React.createElement("tr", { key: i, "data-row": i })));
  const markup = renderToStaticMarkup(
    React.createElement(ReactNodeViewContentProvider, { content: rows }, React.createElement(StaticTable, { node })),
  );

  test("same structure as the editor view: wrapper, caption, sort bar, rows, totals", () => {
    expect(markup).toMatch(/^<div class="tableWrapper lh-table-cards">/);
    expect(markup).toContain('class="lh-table-caption"');
    expect(markup).toContain('<div class="lh-table-sortbar">');
    expect(markup).toContain("Original order</option><option value=\"0\">Task</option>");
    expect(markup).toContain('data-variant="cards"');
    expect(markup.match(/data-row="(\d)"/g)).toEqual(['data-row="0"', 'data-row="1"', 'data-row="2"', 'data-row="3"', 'data-row="4"']);
    expect(markup).toContain('<td class="lh-table-totals-label">Total</td>');
    expect(markup).toContain('::before{content:"Points"}');
  });

  test("a plain table gets the plain wrapper and no extras", () => {
    const plain = plusSchema.nodeFromJSON(doc({ type: "table", content: [row(cell("a"), cell("b"))] })).firstChild;
    const m = renderToStaticMarkup(
      React.createElement(ReactNodeViewContentProvider, { content: [React.createElement("tr", { key: 0 })] }, React.createElement(StaticTable, { node: plain })),
    );
    expect(m).toBe('<div class="tableWrapper"><table id="' + m.match(/id="([^"]+)"/)[1] + '" style="min-width:50px"><colgroup><col style="min-width:25px"/><col style="min-width:25px"/></colgroup><tbody><tr></tr></tbody></table></div>');
  });
});

describe("paste", () => {
  test("tab-separated text with a header", () => {
    const rows = M.parseDelimited("Name\tScore\nAna\t9\nLee\t7\n");
    expect(rows).toEqual([["Name", "Score"], ["Ana", "9"], ["Lee", "7"]]);
    expect(M.looksLikeHeader(rows)).toBe(true);
  });

  test("CSV with quotes, embedded commas and newlines", () => {
    expect(M.parseDelimited('a,b\n"x, y","line1\nline2"\n1,"say ""hi"""')).toEqual([["a", "b"], ["x, y", "line1\nline2"], ["1", 'say "hi"']]);
  });

  test("prose and single lines are not tables", () => {
    expect(M.parseDelimited("Hello, world")).toBeNull();
    expect(M.parseDelimited("First, we mix.\nThen we bake, slowly, for an hour.")).toBeNull();
    expect(M.parseDelimited("just a line\nanother line")).toBeNull();
  });

  test("a numeric first row is not a header", () => {
    expect(M.looksLikeHeader([["1", "2"], ["3", "4"]])).toBe(false);
    expect(M.looksLikeHeader([["a", "a"], ["3", "4"]])).toBe(false);
  });

  test("builds a table node with header cells", () => {
    const table = tableFromText(plusSchema, "Name,Score\nAna,9");
    expect(table.type.name).toBe("table");
    expect(table.firstChild.firstChild.type.name).toBe("tableHeader");
    expect(table.child(1).firstChild.type.name).toBe("tableCell");
    expect(tableFromText(plusSchema, "nope")).toBeNull();
  });
});

describe("slash templates", () => {
  test("three table templates, typed cells, all valid", () => {
    expect(tableSlashItems.map((i) => i.id)).toEqual(["table-progress", "table-comparison", "table-rubric"]);
    for (const i of tableSlashItems) {
      expect(i.category).toBe("tables");
      expect(i.titleKey).toStartWith("editor.blocks_v2.table.templates.");
    }
    for (const build of [T.progressTrackerTable, T.comparisonTable, T.rubricTable]) {
      const node = plusSchema.nodeFromJSON(build());
      expect(() => node.check()).not.toThrow();
      const types = new Set();
      node.descendants((n) => void (n.attrs.cellType && types.add(n.attrs.cellType)));
      expect([...types].some((t) => t !== "text")).toBe(true);
    }
  });
});

function makeEditor(content, mode = "editor") {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({ element, content, extensions: [base, ...tableExtensions({ mode })] });
}

describe("editor", () => {
  test("typed cells get live decorations and a checkbox toggle", () => {
    const editor = makeEditor(
      doc({ type: "table", content: [row(cell("Done?", null, "tableHeader"), cell("Progress", null, "tableHeader")), row(cell("yes", { cellType: "checkbox" }), cell("40", { cellType: "progress" }))] }),
    );
    const td = () => editor.view.dom.querySelectorAll("td");
    expect(td()[1].getAttribute("data-lh-display")).toBe("40%");
    expect(td()[1].getAttribute("style")).toContain("background-size: 40% 6px");
    // Typing updates the visual (renderHTML alone would not).
    let pos = -1;
    editor.state.doc.descendants((n, at) => {
      if (n.isText && n.text === "40") pos = at;
    });
    editor.view.dispatch(editor.state.tr.insertText("90", pos, pos + 2));
    expect(td()[1].getAttribute("data-lh-display")).toBe("90%");
    expect(td()[1].getAttribute("style")).toContain("background-size: 90% 6px");
    // The checkbox widget flips the text.
    const button = editor.view.dom.querySelector(".lh-cell-check");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(editor.state.doc.textContent).toContain("no");
    expect(typedCellsKey.getState(editor.state)).toBeTruthy();
    editor.destroy();
  });

  test("commands: type a whole column, style cells, table attrs, duplicate, distribute, header column", () => {
    const editor = makeEditor(
      doc({
        type: "table",
        content: [
          row(cell("Task", null, "tableHeader"), cell("Score", { colwidth: [200] }, "tableHeader")),
          row(cell("a"), cell("1", { colwidth: [200] })),
          row(cell("b"), cell("2", { colwidth: [200] })),
        ],
      }),
    );
    let first = -1;
    editor.state.doc.descendants((n, at) => {
      if (n.isText && n.text === "1" && first < 0) first = at;
    });
    editor.commands.setTextSelection(first);
    expect(C.setCellType(editor, "number", "column")).toBe(true);
    const types = [];
    editor.state.doc.descendants((n) => void ((n.type.name === "tableCell" || n.type.name === "tableHeader") && types.push(n.attrs.cellType)));
    expect(types).toEqual(["text", "text", "text", "number", "text", "number"]);
    expect(C.setCellsAttrs(editor, { background: "teal", align: "center" }, "selection")).toBe(true);
    expect(C.currentCellAttrs(editor.state)).toMatchObject({ background: "teal", align: "center", cellType: "number" });
    expect(C.setTableAttrs(editor, { variant: "striped", totals: "sum", caption: "Scores" })).toBe(true);
    expect(C.findTable(editor.state).node.attrs).toMatchObject({ variant: "striped", totals: "sum", caption: "Scores" });
    expect(editor.view.dom.querySelector(".lh-table-caption").textContent).toBe("Scores");
    expect(editor.view.dom.querySelector("tfoot .lh-table-totals-value").textContent).toBe("3");
    expect(C.duplicateRow(editor)).toBe(true);
    expect(C.findTable(editor.state).node.childCount).toBe(4);
    expect(C.findTable(editor.state).node.child(2).textContent).toBe("a1");
    expect(C.distributeColumns(editor)).toBe(true);
    C.findTable(editor.state).node.descendants((n) => {
      if (n.type.name === "tableCell") expect(n.attrs.colwidth).toBeNull();
    });
    expect(C.toggleHeaderColumn(editor)).toBe(true);
    expect(C.findTable(editor.state).node.attrs.headerColumn).toBe(true);
    expect(C.hasHeaderColumn(editor.state)).toBe(true);
    expect(C.hasHeaderRow(editor.state)).toBe(true);
    editor.destroy();
  });

  test("a cell selection targets its cells and their columns", () => {
    const editor = makeEditor(doc({ type: "table", content: [row(cell("a"), cell("b"), cell("c")), row(cell("d"), cell("e"), cell("f"))] }));
    const cells = [];
    editor.state.doc.descendants((n, at) => void (n.type.name === "tableCell" && cells.push(at)));
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[1])));
    expect(C.targetCellPositions(editor.state, "selection")).toEqual([cells[0], cells[1]]);
    expect(C.targetCellPositions(editor.state, "column").sort((x, y) => x - y)).toEqual([cells[0], cells[1], cells[3], cells[4]]);
    editor.destroy();
  });

  test("pasting TSV on an empty line inserts a table", () => {
    const editor = makeEditor(doc(p("")));
    const plugin = editor.state.plugins.find((pl) => pl.key.startsWith("lhTablePaste"));
    const event = { clipboardData: { getData: (type) => (type === "text/plain" ? "Name\tScore\nAna\t9" : "") } };
    expect(plugin.props.handlePaste(editor.view, event)).toBe(true);
    const table = editor.state.doc.firstChild;
    expect(table.type.name).toBe("table");
    expect(table.firstChild.firstChild.type.name).toBe("tableHeader");
    // Not on a line that has text, and not when the clipboard has an HTML table.
    editor.commands.setContent(doc(p("text")));
    expect(plugin.props.handlePaste(editor.view, event)).toBe(false);
    editor.commands.setContent(doc(p("")));
    const htmlEvent = { clipboardData: { getData: (type) => (type === "text/html" ? "<table><tr><td>a</td></tr></table>" : "a\tb\nc\td") } };
    expect(plugin.props.handlePaste(editor.view, htmlEvent)).toBe(false);
    editor.destroy();
  });

  test("the learner view sorts rows in the DOM only", () => {
    const editor = makeEditor(TRACKER, "learner");
    const before = JSON.stringify(editor.getJSON());
    const select = editor.view.dom.querySelector(".lh-table-sortbar select");
    expect(select).toBeTruthy();
    const firstCells = () => [...editor.view.dom.querySelectorAll("tbody > tr")].map((tr) => tr.firstElementChild.textContent);
    expect(firstCells()).toEqual(["Task", "B", "A", "C", "D"]);
    select.value = "1";
    select.dispatchEvent(new window.Event("change"));
    expect(firstCells()).toEqual(["Task", "C", "B", "D", "A"]);
    editor.view.dom.querySelector(".lh-table-sortdir").dispatchEvent(new window.MouseEvent("click"));
    expect(firstCells()).toEqual(["Task", "B", "D", "C", "A"]);
    // Clicking a header sorts by that column.
    editor.view.dom.querySelector("tbody > tr > th").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(firstCells()).toEqual(["Task", "A", "B", "C", "D"]);
    select.value = "";
    select.dispatchEvent(new window.Event("change"));
    expect(firstCells()).toEqual(["Task", "B", "A", "C", "D"]);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    expect(editor.view.dom.querySelector("table").getAttribute("data-lh-sort-col")).toBeNull();
    editor.destroy();
  });

  test("the editor view has no sort bar (authors edit, learners sort)", () => {
    const editor = makeEditor(TRACKER);
    expect(editor.view.dom.querySelector(".lh-table-sortbar")).toBeNull();
    expect(editor.view.dom.querySelector("tfoot.lh-table-totals")).toBeTruthy();
    editor.destroy();
  });
});
