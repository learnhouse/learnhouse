import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import { Window } from "happy-dom";
import StarterKit from "@tiptap/starter-kit";

import { LessonDetails } from "../components/Objects/Editor/Extensions/Details/LessonDetails.ts";

const testWindow = new Window();
globalThis.window = testWindow;
globalThis.document = testWindow.document;
globalThis.Node = testWindow.Node;
globalThis.HTMLElement = testWindow.HTMLElement;
globalThis.Event = testWindow.Event;

const sample = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "La fonction exponentielle" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Définition visible par défaut." }],
    },
    {
      type: "details",
      attrs: { open: false },
      content: [
        {
          type: "detailsSummary",
          content: [{ type: "text", text: "Exemple facultatif" }],
        },
        {
          type: "detailsContent",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Étapes supplémentaires." }],
            },
          ],
        },
      ],
    },
  ],
};

function createEditor(content) {
  return new Editor({
    element: null,
    extensions: [StarterKit, ...LessonDetails],
    content,
  });
}

describe("shared lesson disclosure schema", () => {
  test("renders a focusable disclosure button and toggles hidden reader content", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const reader = new Editor({
      element: host,
      editable: false,
      extensions: [StarterKit, ...LessonDetails],
      content: sample,
    });

    const button = host.querySelector("button[data-details-toggle]");
    const detailsContent = host.querySelector('[data-type="detailsContent"]');

    expect(button?.tagName).toBe("BUTTON");
    expect(button?.getAttribute("type")).toBe("button");
    expect(button?.tabIndex).toBe(0);
    expect(button?.getAttribute("aria-label")).toBe("Exemple facultatif");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(detailsContent?.hasAttribute("hidden")).toBe(true);

    button.focus();
    expect(document.activeElement).toBe(button);
    button.click();

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(detailsContent.hasAttribute("hidden")).toBe(false);

    button.click();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(detailsContent.hasAttribute("hidden")).toBe(true);
    reader.destroy();
    host.remove();
  });

  test("supports Enter and Space without losing focus from the disclosure button", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new Editor({
      element: host,
      editable: true,
      extensions: [StarterKit, ...LessonDetails],
      content: sample,
    });
    const button = host.querySelector("button[data-details-toggle]");

    button.focus();
    button.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(button);

    button.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
    editor.destroy();
    host.remove();
  });

  test("updates the toggle's accessible name when an author changes its summary", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new Editor({
      element: host,
      editable: true,
      extensions: [StarterKit, ...LessonDetails],
      content: sample,
    });
    const button = host.querySelector("button[data-details-toggle]");
    let summaryPosition = -1;
    let summaryLength = 0;

    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "detailsSummary") {
        summaryPosition = position;
        summaryLength = node.textContent.length;
      }
    });
    editor.commands.setTextSelection({
      from: summaryPosition + 1,
      to: summaryPosition + 1 + summaryLength,
    });
    editor.commands.insertContent("Complément facultatif");
    await Promise.resolve();

    expect(host.querySelector(".lesson-disclosure__summary")?.textContent).toBe("Complément facultatif");
    expect(button.getAttribute("aria-label")).toBe("Complément facultatif");
    editor.destroy();
    host.remove();
  });

  test("preserves official details nodes and a closed default through save and reopen", () => {
    const editor = createEditor(sample);
    const saved = JSON.parse(JSON.stringify(editor.getJSON()));
    editor.destroy();

    const reopened = createEditor(saved);
    expect(reopened.getJSON()).toEqual(saved);
    expect(reopened.getJSON().content[0].type).toBe("heading");
    expect(reopened.getJSON().content[1].type).toBe("paragraph");
    expect(reopened.getJSON().content[2].attrs.open).toBe(false);
    expect(reopened.getJSON().content[2].content[0].type).toBe("detailsSummary");
    expect(reopened.getJSON().content[2].content[1].type).toBe("detailsContent");
    reopened.destroy();
  });

  test("setDetails wraps selected lesson blocks without converting their text", () => {
    const editor = createEditor({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "Un exemple à masquer." }],
      }],
    });

    expect(editor.commands.setDetails()).toBe(true);

    const details = editor.getJSON().content[0];
    expect(details.type).toBe("details");
    expect(details.attrs.open).toBe(false);
    expect(details.content[0].type).toBe("detailsSummary");
    expect(details.content[1].type).toBe("detailsContent");
    expect(details.content[1].content[0].content[0].text).toBe("Un exemple à masquer.");
    editor.destroy();
  });

  test("preserves an explicitly open disclosure state across save and reopen", () => {
    const openSample = structuredClone(sample);
    openSample.content[2].attrs.open = true;

    const editor = createEditor(openSample);
    const saved = JSON.parse(JSON.stringify(editor.getJSON()));
    editor.destroy();

    const reopened = createEditor(saved);
    expect(reopened.getJSON().content[2].attrs.open).toBe(true);
    reopened.destroy();
  });
});
