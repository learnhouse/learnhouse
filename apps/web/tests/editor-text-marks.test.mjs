// Text marks from the selection menu: schema, HTML render (what learners get),
// HTML round-trip, token safety, and the selection-menu helpers.
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const domWindow = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "Element", "Node", "Text", "DocumentFragment", "MutationObserver", "Range", "DOMParser"]) {
  if (!(key in globalThis)) globalThis[key] = domWindow[key];
}
globalThis.window ??= domWindow;

const { getSchema } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const { generateHTML, generateJSON } = await import("@tiptap/html");
const M = await import("../components/Objects/Editor/Blocks/marks/textMarks.ts");
const T = await import("../components/Objects/Editor/Blocks/bubble/selectionTools.ts");

const extensions = [StarterKit, ...M.TEXT_MARKS];
const schema = getSchema(extensions);
const doc = (...content) => ({ type: "doc", content: [{ type: "paragraph", content }] });
const txt = (text, ...marks) => (marks.length ? { type: "text", text, marks } : { type: "text", text });

describe("text marks", () => {
  test("all marks are in the schema with their attrs", () => {
    for (const name of ["superscript", "subscript", "textColor", "highlight", "textEffect", "kbd", "spoiler", "definition"]) {
      expect(schema.marks[name]).toBeDefined();
    }
    expect(M.TEXT_MARK_NAMES).toHaveLength(8);
  });

  test("render to learner-safe HTML with tokens only", () => {
    const html = generateHTML(
      doc(
        txt("A", { type: "textColor", attrs: { color: "purple" } }),
        txt("B", { type: "highlight", attrs: { color: "green", style: "marker" } }),
        txt("C", { type: "textEffect", attrs: { effect: "gradient-ocean" } }),
        txt("D", { type: "kbd" }),
        txt("E", { type: "spoiler" }),
        txt("F", { type: "definition", attrs: { note: "A note" } }),
        txt("2", { type: "superscript" }),
        txt("o", { type: "subscript" }),
      ),
      extensions,
    );
    expect(html).toContain('<span data-text-color="purple" class="lh-text-purple">A</span>');
    expect(html).toContain('<mark data-highlight="green" data-highlight-style="marker" class="lh-hl lh-hl-marker lh-hl-green">B</mark>');
    expect(html).toContain('class="lh-fx lh-fx-gradient-ocean"');
    expect(html).toContain('<kbd class="lh-kbd">D</kbd>');
    expect(html).toMatch(/<span data-spoiler="" class="lh-spoiler" tabindex="0" role="button" aria-pressed="false">E<\/span>/);
    expect(html).toContain('data-note="A note"');
    expect(html).toContain("<sup>2</sup>");
    expect(html).toContain("<sub>o</sub>");
  });

  test("unknown tokens never reach class names or styles", () => {
    const html = generateHTML(
      doc(
        txt("x", { type: "textColor", attrs: { color: "red;background:url(x)" } }),
        txt("y", { type: "textEffect", attrs: { effect: "<script>" } }),
        txt("z", { type: "highlight", attrs: { color: "nope", style: "evil" } }),
      ),
      extensions,
    );
    expect(html).not.toContain("url(");
    expect(html).not.toContain("<script>");
    expect(html).toContain('class="lh-hl lh-hl-fill lh-hl-amber"');
  });

  test("definition notes are capped and escaped", () => {
    const html = generateHTML(doc(txt("t", { type: "definition", attrs: { note: '"><img src=x onerror=1>' + "a".repeat(600) } })), extensions);
    // Attribute values are escaped by the DOM serializer: no element is created.
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("[data-note]").getAttribute("data-note").length).toBeLessThanOrEqual(500);
  });

  test("HTML round-trip keeps every mark and attr (copy/paste between editors)", () => {
    const json = doc(
      txt("A", { type: "textColor", attrs: { color: "teal" } }),
      txt("B", { type: "highlight", attrs: { color: "pink", style: "underline" } }),
      txt("C", { type: "textEffect", attrs: { effect: "wavy" } }),
      txt("D", { type: "kbd" }),
      txt("E", { type: "spoiler" }),
      txt("F", { type: "definition", attrs: { note: "Gloss" } }),
      txt("G", { type: "superscript" }),
    );
    const back = generateJSON(generateHTML(json, extensions), extensions);
    expect(back).toEqual(json);
  });

  test("a document without the new marks is unchanged by the extended schema", () => {
    const plain = doc(txt("Hello "), txt("world", { type: "bold" }));
    expect(schema.nodeFromJSON(plain).toJSON()).toEqual(plain);
  });

  test("superscript and subscript exclude each other", () => {
    expect(schema.marks.superscript.excludes(schema.marks.subscript)).toBe(true);
  });
});

describe("selection menu helpers", () => {
  test("word diff marks additions and deletions", () => {
    const d = T.wordDiff("the quick brown fox", "the slow brown fox jumps");
    expect(d.map((p) => p.kind)).toEqual(["same", "del", "add", "same", "add"]);
    expect(d.filter((p) => p.kind !== "del").map((p) => p.text).join("")).toBe("the slow brown fox jumps");
    expect(d.filter((p) => p.kind !== "add").map((p) => p.text).join("").trim()).toBe("the quick brown fox");
    expect(T.wordDiff("", "new")).toEqual([{ kind: "add", text: "new" }]);
  });

  test("prompts carry the passage and ask for result-only output", () => {
    const p = T.buildAIPrompt("shorten", "Some text");
    expect(p).toContain("Some text");
    expect(p).toContain("Return only the result");
    expect(T.buildAIPrompt("translate", "Hola", "French")).toContain("into French");
    expect(T.buildAIPrompt("quiz", "x")).toContain('"correct": boolean');
  });

  test("cleans fences and quotes from AI text", () => {
    expect(T.cleanAIText('```\nHello\n```')).toBe("Hello");
    expect(T.cleanAIText('"Quoted"')).toBe("Quoted");
    expect(T.cleanAIText("  plain  ")).toBe("plain");
  });

  test("AI quiz JSON becomes a valid blockQuiz", () => {
    const node = T.quizNodeFromAI('Here: [{"question":"2+2?","answers":[{"answer":"4","correct":true},{"answer":"5","correct":false}]},{"question":"bad","answers":[]}]');
    expect(node.type).toBe("blockQuiz");
    expect(node.attrs.questions).toHaveLength(1);
    const q = node.attrs.questions[0];
    expect(q).toMatchObject({ question: "2+2?", type: "multiple_choice", response_type: "single" });
    expect(q.answers.map((a) => a.correct)).toEqual([true, false]);
    expect(q.question_id).toMatch(/^question_/);
    expect(T.quizNodeFromAI("not json")).toBeNull();
    expect(T.quizNodeFromAI('[{"question":"q","answers":[{"answer":"a","correct":false},{"answer":"b","correct":false}]}]')).toBeNull();
  });

  test("AI flashcards become flipcards (grid when several)", () => {
    const one = T.flashcardNodesFromAI('[{"question":"Q","answer":"A"}]');
    expect(one).toMatchObject({ type: "flipcard", attrs: { question: "Q", answer: "A" } });
    const many = T.flashcardNodesFromAI('[{"question":"Q1","answer":"A1"},{"question":"Q2","answer":"A2"},{"question":"","answer":"x"}]');
    expect(many.type).toBe("flipcardGrid");
    expect(many.content).toHaveLength(2);
    expect(many.attrs.columns).toBe(2);
  });

  test("AI text becomes text or paragraphs", () => {
    expect(T.textToContent("One line")).toEqual([{ type: "text", text: "One line" }]);
    expect(T.textToContent("A\n\nB")).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "A" }] },
      { type: "paragraph", content: [{ type: "text", text: "B" }] },
    ]);
    expect(T.textToContent("   ")).toEqual([]);
  });

  test("word counts (incl. CJK)", () => {
    expect(T.countWords("Hello  big world")).toEqual({ words: 3, chars: 16 });
    expect(T.countWords("")).toEqual({ words: 0, chars: 0 });
    expect(T.countWords("日本語").words).toBe(3);
  });

  test("passage links use URL text fragments", () => {
    expect(T.passageLink("https://x.test/course/a/activity/b#top", "light energy")).toBe("https://x.test/course/a/activity/b#:~:text=light%20energy");
    const long = T.passageLink("https://x.test/p", "one two three four five six seven eight nine ten");
    expect(long).toBe("https://x.test/p#:~:text=one%20two%20three%20four,seven%20eight%20nine%20ten");
    expect(T.passageLink("https://x.test/p", "co-op")).toContain("co%2Dop");
  });
});
