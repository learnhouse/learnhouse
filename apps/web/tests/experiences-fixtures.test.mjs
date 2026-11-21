import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

// Stored Experiences blocks (tests/fixtures/editor-blocks/experiences-new-blocks.json)
// must load into the real node definitions without losing an attr, and survive
// the HTML round trip copy/paste uses (JSON attrs through data-* attributes).

const domWindow = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "Element", "Node", "Text", "DocumentFragment", "DOMParser", "getComputedStyle"]) {
  if (domWindow[key] !== undefined && globalThis[key] === undefined) globalThis[key] = domWindow[key];
}
globalThis.window = domWindow;

const { getSchema } = await import("@tiptap/core");
const { DOMParser: PMDOMParser, DOMSerializer } = await import("@tiptap/pm/model");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const { EXPERIENCE_NODE_NAMES } = await import("../components/Objects/Editor/Extensions/Experiences/experienceTypes.ts");

const ext = (path) => import(`../components/Objects/Editor/Extensions/Experiences/${path}`).then((m) => m.default);
const NODES = await Promise.all(
  ["Sort/Sort", "Sequence/Sequence", "Match/Match", "Hotspot/Hotspot", "Gaps/Gaps", "MythFact/MythFact", "SpeedRound/SpeedRound", "Estimate/Estimate", "SpotMistake/SpotMistake", "CodeLock/CodeLock"].map(ext),
);
const OLDER = await Promise.all(["Flipcard/Flipcard", "Flipcard/FlipcardGrid", "Scenarios/Scenarios"].map((p) => import(`../components/Objects/Editor/Extensions/${p}`).then((m) => m.default)));
const schema = getSchema([StarterKit.configure({ codeBlock: false, link: false, undoRedo: false }), ...NODES, ...OLDER]);
const { experienceRegistry, insertExperience } = await import("../components/Objects/Editor/Extensions/Experiences/registry.tsx");
const en = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
const lookup = (key) => key.split(".").reduce((n, p) => (n && typeof n === "object" ? n[p] : undefined), en);
const t = (key, fallback) => (typeof lookup(key) === "string" ? lookup(key) : fallback ?? key);
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/editor-blocks/experiences-new-blocks.json", import.meta.url), "utf8"));

describe("Experiences fixtures", () => {
  test("every new node is in the schema and has a fixture", () => {
    const covered = new Set(fixtures.flatMap((f) => f.nodes.map((n) => n.type)));
    for (const name of EXPERIENCE_NODE_NAMES) {
      expect(schema.nodes[name]).toBeTruthy();
      expect(covered.has(name)).toBe(true);
    }
  });

  test("registry: 12 entries, each inserting a valid, filled-in, translated block", () => {
    expect(experienceRegistry.length).toBe(12);
    expect(new Set(experienceRegistry.map((e) => e.slashId)).size).toBe(12);
    for (const entry of experienceRegistry) {
      expect(typeof lookup(entry.titleKey)).toBe("string");
      expect(typeof lookup(entry.descriptionKey)).toBe("string");
      const json = entry.defaultContent(t);
      expect(json.type).toBe(entry.nodeName);
      const node = schema.nodeFromJSON(json);
      expect(() => node.check()).not.toThrow();
      expect(node.attrs).toMatchObject(json.attrs);
      if (entry.nodeName.startsWith("exp")) expect(node.attrs.blockId).toMatch(/^[0-9a-f-]{36}$/);
      // No raw i18n keys leak into the example.
      expect(JSON.stringify(json)).not.toMatch(/editor\.experiences\./);
    }
    const a = experienceRegistry[2].defaultContent(t).attrs.blockId;
    const b = experienceRegistry[2].defaultContent(t).attrs.blockId;
    expect(a).not.toBe(b);
  });

  test("insertExperience adds after a selected block instead of replacing it", () => {
    const fakeEditor = (selection) => {
      const calls = [];
      const chain = { focus: () => chain, insertContent: (c) => (calls.push(["insertContent", c.type]), chain), insertContentAt: (at, c) => (calls.push(["insertContentAt", at, c.type]), chain), run: () => true };
      return { calls, editor: { state: { selection }, chain: () => chain } };
    };
    const sort = experienceRegistry.find((e) => e.id === "sort");
    // Cursor in text: insert at the selection.
    const text = fakeEditor({ from: 3, to: 3 });
    expect(insertExperience(text.editor, sort, t)).toBe(true);
    expect(text.calls).toEqual([["insertContent", "expSort"]]);
    // A whole block selected (the one just inserted): insert after it.
    const block = fakeEditor({ from: 5, to: 9, node: { type: { name: "expMatch" } } });
    expect(insertExperience(block.editor, sort, t)).toBe(true);
    expect(block.calls).toEqual([["insertContentAt", 9, "expSort"]]);
    // Editors without state (older callers) still insert.
    const bare = fakeEditor(undefined);
    insertExperience({ chain: bare.editor.chain }, sort, t);
    expect(bare.calls).toEqual([["insertContent", "expSort"]]);
  });

  for (const fixture of fixtures) {
    test(`${fixture.name}: loads without losing attrs`, () => {
      for (const json of fixture.nodes) {
        const node = schema.nodeFromJSON(json);
        expect(() => node.check()).not.toThrow();
        expect(node.attrs).toMatchObject(json.attrs);
      }
    });

    test(`${fixture.name}: survives the HTML round trip`, () => {
      const doc = schema.nodeFromJSON({ type: "doc", content: fixture.nodes });
      const dom = DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document: domWindow.document });
      const wrap = domWindow.document.createElement("div");
      wrap.appendChild(dom);
      const back = PMDOMParser.fromSchema(schema).parse(wrap);
      expect(back.toJSON().content).toEqual(doc.toJSON().content);
    });
  }
});
