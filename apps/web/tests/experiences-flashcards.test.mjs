// Flashcards (flipcardGrid), Experiences redesign: the new optional attrs,
// study mode's in-session Leitner queue, "known" persistence keys, shuffle
// and bulk paste. Old grids must load with defaults that mean "as before".
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const win = new Window();
globalThis.window = win;
globalThis.document = win.document;

const { Node, getSchema, generateHTML, generateJSON } = await import("@tiptap/core");
const { default: Document } = await import("@tiptap/extension-document");
const { default: Text } = await import("@tiptap/extension-text");
const M = await import("../components/Objects/Editor/Extensions/Flipcard/flashcardStudyModel.ts");

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/editor-blocks/experiences-scenarios-flashcards.json", import.meta.url), "utf8"));
const dbFixtures = JSON.parse(readFileSync(new URL("./fixtures/editor-blocks/db-activities.json", import.meta.url), "utf8"));
const gridsIn = (content, out = []) => {
  if (content && typeof content === "object") {
    if (content.type === "flipcardGrid") out.push(content);
    (content.content || []).forEach((c) => gridsIn(c, out));
  }
  return out;
};
const oldGrids = [...fixtures.flatMap((f) => f.nodes).filter((n) => n.type === "flipcardGrid" && !n.attrs.mode), ...dbFixtures.flatMap((f) => gridsIn(f.content))];
const newGrid = fixtures.flatMap((f) => f.nodes).find((n) => n.type === "flipcardGrid" && n.attrs.mode === "study");

// The same attrs as FlipcardGrid.ts / Flipcard.ts.
const FLIPCARD_ATTRS = { question: {}, answer: {}, color: { default: "blue" }, alignment: { default: "center" }, size: { default: "medium" }, style: { default: "solid" } };
const extensions = [
  Document.extend({ content: "block+" }),
  Text,
  Node.create({ name: "flipcard", group: "block", content: "text*", addAttributes: () => FLIPCARD_ATTRS, parseHTML: () => [{ tag: "flipcard-block" }], renderHTML: ({ HTMLAttributes }) => ["flipcard-block", HTMLAttributes, 0] }),
  Node.create({
    name: "flipcardGrid",
    group: "block",
    content: "flipcard+",
    addAttributes: () => ({
      columns: { default: 2, parseHTML: (el) => Number(el.getAttribute("data-columns") || 2), renderHTML: (a) => ({ "data-columns": a.columns }) },
      ...M.FLIPCARD_GRID_EXTRA_ATTRS,
    }),
    parseHTML: () => [{ tag: "flipcard-grid" }],
    renderHTML: ({ HTMLAttributes }) => ["flipcard-grid", HTMLAttributes, 0],
  }),
];
const schema = getSchema(extensions);

describe("flipcardGrid attrs", () => {
  test("FlipcardGrid.ts spreads the extra attrs and keeps columns", () => {
    const src = readFileSync(new URL("../components/Objects/Editor/Extensions/Flipcard/FlipcardGrid.ts", import.meta.url), "utf8");
    expect(src).toContain("...FLIPCARD_GRID_EXTRA_ATTRS");
    expect(src).toContain('name: "flipcardGrid"');
    expect(src).toContain('content: "flipcard+"');
  });

  test("old grids load unchanged, with defaults that mean the old grid", () => {
    expect(oldGrids.length).toBeGreaterThan(1);
    for (const grid of oldGrids) {
      const node = schema.nodeFromJSON(grid);
      node.check();
      const out = node.toJSON();
      for (const [k, v] of Object.entries(grid.attrs)) expect(out.attrs[k]).toEqual(v);
      expect(out.attrs).toMatchObject({ mode: "grid", title: "", shuffle: false });
      expect(M.resolveDeckAttrs(grid.attrs)).toEqual({ mode: "grid", title: "", shuffle: false });
      expect(out.content.map((c) => c.attrs.question)).toEqual(grid.content.map((c) => c.attrs.question));
    }
  });

  test("old grid HTML has no new attributes; new attrs round-trip through HTML", () => {
    const oldHtml = generateHTML({ type: "doc", content: [oldGrids[0]] }, extensions);
    expect(oldHtml).not.toContain("data-mode");
    expect(oldHtml).not.toContain("data-title");
    expect(oldHtml).not.toContain("data-shuffle");
    const html = generateHTML({ type: "doc", content: [newGrid] }, extensions);
    expect(html).toContain('data-mode="study"');
    const back = generateJSON(html, extensions).content[0];
    expect(back.attrs).toMatchObject({ columns: 3, mode: "study", title: "Refund terms", shuffle: true });
    expect(M.resolveDeckAttrs(back.attrs)).toEqual({ mode: "study", title: "Refund terms", shuffle: true });
    expect(M.resolveDeckAttrs({ mode: "carousel", title: 3, shuffle: "yes" })).toEqual({ mode: "grid", title: "", shuffle: false });
  });
});

describe("card identity", () => {
  test("keys follow content, not position; duplicates stay distinct", () => {
    expect(M.cardKey("A", "B")).toBe(M.cardKey(" A ", "B "));
    expect(M.cardKey("A", "B")).not.toBe(M.cardKey("A", "C"));
    const cards = M.toStudyCards([{ question: "A", answer: "B" }, { question: "A", answer: "B" }, { question: 4 }]);
    expect(new Set(cards.map((c) => c.key)).size).toBe(3);
    expect(cards[2]).toMatchObject({ question: "", answer: "" });
    expect(M.hashString("x")).toBe(M.hashString("x"));
  });

  test("shuffle is a permutation; seeded order is stable", () => {
    const items = [1, 2, 3, 4, 5, 6];
    const a = M.shuffled(items, M.seededRandom(7));
    expect([...a].sort()).toEqual(items);
    expect(M.shuffled(items, M.seededRandom(7))).toEqual(a);
    expect(items).toEqual([1, 2, 3, 4, 5, 6]);
    expect(M.shuffleOrder(1, "k")).toBe(M.shuffleOrder(1, "k"));
    expect(Number.isInteger(M.shuffleOrder(2, "k"))).toBe(true);
  });
});

describe("study session (in-session Leitner)", () => {
  const cards = M.toStudyCards("abcdefgh".split("").map((q) => ({ question: q, answer: q.toUpperCase() })));
  const keys = cards.map((c) => c.key);

  test("Again comes back soon, Hard later, Got it leaves the queue", () => {
    let s = M.createSession(cards);
    expect(M.currentCard(s)).toBe(keys[0]);
    s = M.rateCard(s, "again");
    expect(s.queue.indexOf(keys[0])).toBe(M.AGAIN_GAP);
    s = M.createSession(cards);
    s = M.rateCard(s, "hard");
    expect(s.queue.indexOf(keys[0])).toBe(M.HARD_GAP);
    s = M.rateCard(M.createSession(cards), "good");
    expect(s.queue).not.toContain(keys[0]);
    expect(s.known).toEqual([keys[0]]);
    expect(M.sessionProgress(s)).toEqual({ known: 1, total: 8, pct: 13 });
  });

  test("a full pass finishes; missed cards are tracked and can be studied again", () => {
    let s = M.createSession(cards);
    let guard = 0;
    const seen = new Map();
    while (!M.isFinished(s) && guard++ < 100) {
      const k = M.currentCard(s);
      seen.set(k, (seen.get(k) ?? 0) + 1);
      s = M.rateCard(s, k === keys[1] && seen.get(k) === 1 ? "again" : k === keys[2] && seen.get(k) === 1 ? "hard" : "good");
    }
    expect(M.isFinished(s)).toBe(true);
    expect(M.currentCard(s)).toBeNull();
    expect(s.reviews).toBe(10);
    expect(s.missed).toEqual([keys[1], keys[2]]);
    expect(M.sessionProgress(s).known).toBe(8);
    expect(M.rateCard(s, "good")).toBe(s);
    const again = M.createSession(cards, { only: s.missed, known: s.known });
    expect(again.queue).toEqual([keys[1], keys[2]]);
    expect(again.known.length).toBe(6);
  });

  test("the last card rated Again comes straight back", () => {
    let s = M.createSession(cards.slice(0, 1));
    s = M.rateCard(s, "again");
    expect(s.queue).toEqual([keys[0]]);
  });

  test("remembered known cards start out of the queue; unknown keys are ignored", () => {
    const s = M.createSession(cards, { known: [keys[0], keys[3], "cgone"] });
    expect(s.queue).not.toContain(keys[0]);
    expect(s.known).toEqual([keys[0], keys[3]]);
    expect(M.sessionProgress(s).known).toBe(2);
    // Again on a known card drops it from known.
    const allKnown = M.createSession(cards.slice(0, 2), { known: [keys[0]], only: [keys[0]] });
    expect(M.rateCard(allKnown, "again").known).toEqual([]);
  });

  test("shuffle option shuffles the queue, deterministic with a seed", () => {
    const s1 = M.createSession(cards, { shuffle: true, rand: M.seededRandom(3) });
    const s2 = M.createSession(cards, { shuffle: true, rand: M.seededRandom(3) });
    expect(s1.queue).toEqual(s2.queue);
    expect([...s1.queue].sort()).toEqual([...keys].sort());
    expect(s1.total).toEqual(keys);
  });

  test("mergeKnown keeps other decks' cards, adds new known, drops cards missed now", () => {
    let s = M.createSession(cards.slice(0, 3), { known: [keys[0]] });
    s = M.rateCard(s, "again"); // keys[1] missed
    s = M.rateCard(s, "good"); // keys[2]
    const out = M.mergeKnown(["cother", keys[0], keys[1]], s);
    expect(out).toEqual(["cother", keys[0], keys[2]]);
    expect(M.mergeKnown(Array.from({ length: 10 }, (_, i) => `k${i}`), M.createSession([]), 4)).toEqual(["k6", "k7", "k8", "k9"]);
    expect(M.sessionProgress(M.createSession([]))).toEqual({ known: 0, total: 0, pct: 0 });
  });

  test("keys 1 / 2 / 3 rate the card", () => {
    expect(["1", "2", "3", "4", " "].map(M.ratingFromKey)).toEqual(["again", "hard", "good", null, null]);
  });
});

describe("bulk paste", () => {
  test("term – definition, term - definition, term: definition and tabs", () => {
    const text = [
      "Photosynthesis – how plants make food",
      "  ",
      "Mitosis - cell division",
      "1. ATP: the cell's energy currency",
      "- Osmosis\twater crossing a membrane",
      "Enzyme—a protein catalyst",
      "Well-known term - with a hyphen inside",
      "Lonely term",
      "• Ribosome — makes proteins",
    ].join("\n");
    expect(M.parseBulkCards(text)).toEqual([
      { question: "Photosynthesis", answer: "how plants make food" },
      { question: "Mitosis", answer: "cell division" },
      { question: "ATP", answer: "the cell's energy currency" },
      { question: "Osmosis", answer: "water crossing a membrane" },
      { question: "Enzyme", answer: "a protein catalyst" },
      { question: "Well-known term", answer: "with a hyphen inside" },
      { question: "Lonely term", answer: "" },
      { question: "Ribosome", answer: "makes proteins" },
    ]);
    expect(M.parseBulkCards("")).toEqual([]);
    expect(M.parseBulkCards(undefined)).toEqual([]);
    expect(M.parseBulkCards("Windows\r\nA: b")).toEqual([{ question: "Windows", answer: "" }, { question: "A", answer: "b" }]);
  });
});
