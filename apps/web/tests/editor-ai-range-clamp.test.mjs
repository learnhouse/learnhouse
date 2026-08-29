import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";

import {
  clampRange,
  mapRange,
} from "../components/Objects/Editor/Extensions/AISelectionHighlight/range.ts";

/**
 * The AI side panel holds ProseMirror ranges as pairs of raw integers while the
 * document keeps moving underneath them — the stream inserts, the user types,
 * an undo lands. Two different failure modes come out of that, and they need
 * two different tools:
 *
 *   READS clamp. `persistentSelection` freezes the moment the user clicks into
 *   the chat box, and reading it back out of range made `textBetween` run off
 *   the end of the fragment: "Cannot read properties of undefined (reading
 *   'nodeSize')" during render, which killed the editor page
 *   (LEARNHOUSE-WEB-64).
 *
 *   WRITES map. `selectionRangeRef` is captured in sendMessage and read in the
 *   onContentStart callback a full network round-trip later, then fed to
 *   deleteSelection. That one never threw — setTextSelection clamps internally
 *   — it silently deleted whatever text had moved into those offsets. No error,
 *   no Sentry event, real content gone.
 *
 * NOT pinned here: LEARNHOUSE-WEB-5X ("RangeError: Position -1 outside of
 * fragment"). That was tiptap's own Delete core extension calling
 * `doc.nodeAt(newStart - 1)` from its own setTimeout — `newStart` comes out of
 * tiptap's mapping, not from anything this app passes in, and the Sentry stack
 * carries no app frame at all. @tiptap/core guards it with `newStart > 0` from
 * 3.22.0 onwards (3.21.0 has the bare `nodeAt(newStart - 1)`); package.json pins
 * 3.30.2, comfortably above that floor. The guard against its return is the
 * dependency floor, not anything in this file; nothing asserted below would
 * catch it.
 */
describe("clampRange", () => {
  test("a range fully inside the document is returned unchanged", () => {
    expect(clampRange(100, { from: 10, to: 20 })).toEqual({ from: 10, to: 20 });
  });

  test("a range past the end of a shrunken document is pulled back in", () => {
    // The doc was 500 long at capture time and is 12 long now.
    expect(clampRange(12, { from: 400, to: 480 })).toBeNull();
    expect(clampRange(12, { from: 4, to: 480 })).toEqual({ from: 4, to: 12 });
  });

  test("a negative position never escapes", () => {
    expect(clampRange(100, { from: -1, to: 20 })).toEqual({ from: 0, to: 20 });
    expect(clampRange(100, { from: -8, to: -1 })).toBeNull();
  });

  test("an empty or inverted range yields null rather than a zero-width read", () => {
    expect(clampRange(100, { from: 20, to: 20 })).toBeNull();
    expect(clampRange(100, { from: 30, to: 10 })).toBeNull();
  });

  test("a document emptied to nothing leaves no readable range", () => {
    expect(clampRange(0, { from: 0, to: 40 })).toBeNull();
  });

  test("missing and non-numeric input is refused, not coerced", () => {
    expect(clampRange(100, null)).toBeNull();
    expect(clampRange(100, undefined)).toBeNull();
    expect(clampRange(100, { from: NaN, to: 10 })).toBeNull();
    expect(clampRange(100, { from: 0, to: Infinity })).toBeNull();
    expect(clampRange(NaN, { from: 0, to: 10 })).toBeNull();
  });
});

/**
 * Real ProseMirror documents, so these assert behaviour rather than the shape
 * of the source. Each one deletes through the stored range and checks what text
 * actually came out — which is the only way to tell an effective guard from an
 * ineffective one. Every case here fails with clampRange alone; the "clamping
 * is not enough" test asserts that failure directly so the difference between
 * the two helpers stays visible.
 */
describe("mapRange keeps a stored range on the user's own text", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block", toDOM: () => ["p", 0] },
      text: { group: "inline" },
    },
  });

  const stateWith = (text) =>
    EditorState.create({
      doc: schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text(text)]),
      ]),
    });

  /** Select `word` in `state`, the way the user would before hitting send. */
  const selectWord = (state, word) => {
    const at = state.doc.textContent.indexOf(word);
    expect(at).toBeGreaterThan(-1);
    return { from: at + 1, to: at + 1 + word.length };
  };

  /** Delete `range` from `state` and report the text that survives. */
  const textAfterDeleting = (state, range) => {
    const tr = state.tr.setSelection(
      TextSelection.create(state.doc, range.from, range.to),
    );
    return state.apply(tr.deleteSelection()).doc.textContent;
  };

  test("an insertion before the selection shifts it, and mapping follows", () => {
    const before = stateWith("alpha bravo charlie");
    const stored = selectWord(before, "bravo");

    // The user types at the very start while the AI request is in flight.
    const tr = before.tr.insertText("XXXX ", 1);
    const after = before.apply(tr);

    const mapped = mapRange(tr.mapping, tr.doc.content.size, stored);
    expect(textAfterDeleting(after, mapped)).toBe("XXXX alpha  charlie");
  });

  test("clamping alone is not enough — it deletes the wrong words", () => {
    const before = stateWith("alpha bravo charlie");
    const stored = selectWord(before, "bravo");

    const tr = before.tr.insertText("XXXX ", 1);
    const after = before.apply(tr);

    // Same stored range, clamped instead of mapped. It is in range, so nothing
    // throws and nothing is reported — it just eats the wrong text. This is the
    // silent-corruption case; if this assertion ever matches the mapped result
    // above, the test below it has stopped proving anything.
    const clamped = clampRange(after.doc.content.size, stored);
    expect(clamped).not.toBeNull();
    expect(textAfterDeleting(after, clamped)).toBe("XXXX abravo charlie");

    // And the two really do disagree — the guard is doing work, not agreeing
    // with the thing it replaced.
    const mapped = mapRange(tr.mapping, tr.doc.content.size, stored);
    expect(mapped).not.toEqual(clamped);
  });

  test("a deletion earlier in the document pulls the range back", () => {
    const before = stateWith("alpha bravo charlie");
    const stored = selectWord(before, "charlie");

    // The user deletes "alpha " (positions 1..7) while waiting.
    const tr = before.tr.delete(1, 7);
    const after = before.apply(tr);

    const mapped = mapRange(tr.mapping, tr.doc.content.size, stored);
    expect(textAfterDeleting(after, mapped)).toBe("bravo ");
  });

  test("a selection the user deleted themselves maps to null, not to a neighbour", () => {
    const before = stateWith("alpha bravo charlie");
    const stored = selectWord(before, "bravo");

    const tr = before.tr.delete(stored.from, stored.to);

    expect(mapRange(tr.mapping, tr.doc.content.size, stored)).toBeNull();
    // Clamping would have handed back a live range over "alpha " / " charlie".
    expect(clampRange(tr.doc.content.size, stored)).not.toBeNull();
  });

  test("text inserted at a boundary is not swallowed into the range", () => {
    const before = stateWith("alpha bravo charlie");
    const stored = selectWord(before, "bravo");

    // Typed immediately after "bravo" — the user's own word, not the selection.
    const tr = before.tr.insertText("ZZZ", stored.to);
    const after = before.apply(tr);

    const mapped = mapRange(tr.mapping, tr.doc.content.size, stored);
    expect(textAfterDeleting(after, mapped)).toBe("alpha ZZZ charlie");
  });

  test("bad input is refused before it reaches the mapping", () => {
    const neverCalled = {
      map() {
        throw new Error("mapping should not be consulted");
      },
    };
    expect(mapRange(neverCalled, 100, null)).toBeNull();
    expect(mapRange(neverCalled, 100, { from: NaN, to: 4 })).toBeNull();
  });
});

/**
 * The actual guard against LEARNHOUSE-WEB-5X. Its throw lives in @tiptap/core's
 * Delete extension, and the `newStart > 0` guard that makes it unreachable
 * first shipped in 3.22.0 — verified against the published tarballs: 3.21.0 has
 * the bare `nodeAt(newStart - 1)`, 3.22.0 onwards has the guard. So 3.22.0 is
 * the floor asserted below, not the 3.30.2 that package.json currently pins.
 *
 * Asserting the true floor rather than the current pin is the point: a Renovate
 * downgrade or a lower resolution would reopen 5X silently, with a stack
 * containing none of our code to point at, and a test that fails on any routine
 * downgrade would just get relaxed. This one fails only when the guard is
 * actually gone.
 */
describe("@tiptap/core stays at or above the version that guards nodeAt(-1)", () => {
  const GUARD_FLOOR = [3, 22, 0];

  const pkg = JSON.parse(
    readFileSync(join(import.meta.dir, "../package.json"), "utf8"),
  );
  const declared = pkg.dependencies?.["@tiptap/core"];

  test("the pinned version is 3.22.0 or newer", () => {
    expect(declared).toBeDefined();
    const parts = declared.replace(/^[^\d]*/, "").split(".").map(Number);
    expect(parts).toHaveLength(3);
    expect(parts.some(Number.isNaN)).toBe(false);

    // Lexicographic compare on [major, minor, patch]: the first component that
    // differs decides, and no difference means an exact match on the floor.
    const firstDiff = parts.findIndex((part, i) => part !== GUARD_FLOOR[i]);
    const atOrAbove = firstDiff === -1 || parts[firstDiff] > GUARD_FLOOR[firstDiff];
    expect(atOrAbove).toBe(true);
  });
});

const AI_DIR = join(import.meta.dir, "../components/Objects/Editor");

/**
 * Source-level pins. These cannot tell an effective guard from an ineffective
 * one — that is what the behavioural block above is for — they only stop the
 * wiring being removed quietly. Every slice anchor is asserted found first, so
 * a rename fails loudly instead of yielding a wrong-but-non-empty window.
 */
describe("stored ProseMirror ranges are routed through the helpers", () => {
  const panel = readFileSync(join(AI_DIR, "AI/AIEditorSidePanel.tsx"), "utf8");
  const highlight = readFileSync(
    join(AI_DIR, "Extensions/AISelectionHighlight/AISelectionHighlight.ts"),
    "utf8",
  );

  /** Slice between two anchors, failing if either has been renamed away. */
  const between = (source, startAnchor, endAnchor) => {
    const start = source.indexOf(startAnchor);
    const end = source.indexOf(endAnchor);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  };

  test("the selection indicator clamps before it reads the document", () => {
    const read = "textBetween(sel.from, sel.to)";
    const at = panel.indexOf(read);
    expect(at).toBeGreaterThan(-1);
    // The clamp has to happen in the same JSX callback, just above the read.
    expect(panel.slice(Math.max(0, at - 500), at)).toContain("clampRange(");
    expect(panel).not.toMatch(/textBetween\(\s*[\w.]*persistentSelection/);
  });

  test("the pending selection is mapped through every transaction", () => {
    const body = between(
      panel,
      "const onTransaction =",
      "editor.off('transaction'",
    );
    expect(body).toContain("mapRange(");
    expect(body).toContain("selectionRangeRef.current =");
    expect(body).toContain("editor.on('transaction'");
  });

  test("plugin-appended transactions are mapped too, not dropped", () => {
    // tiptap fires 'transaction' once per dispatch, after view.updateState has
    // applied the dispatched transaction AND everything appendTransaction
    // returned. Mapping only the dispatched one leaves the stored range short by
    // the appended steps and clamps it against an intermediate doc size — silent
    // corruption on the next deleteSelection, with nothing in Sentry.
    const body = between(
      panel,
      "const onTransaction =",
      "editor.off('transaction'",
    );
    expect(body).toContain("appendedTransactions");
    // The whole batch has to be walked, not just transaction.mapping once.
    expect(body).toMatch(/\[\s*transaction,\s*\.\.\.\(?appendedTransactions/);
  });

  test("cursor_position is set for a selected-text message, not only for a bare caret", () => {
    // The request payload is built synchronously in sendMessage, before any
    // stream callback runs, so onContentStart cannot repair this field. Writing
    // insertPositionRef only on the no-selection path shipped the previous
    // message's offset whenever the user sent with a selection.
    const body = between(
      panel,
      "// Store selection range for later use",
      "// Store current editor content for context",
    );
    const writes = body.match(/insertPositionRef\.current = /g) ?? [];
    expect(writes.length).toBe(2);
    expect(panel).toContain("cursor_position: insertPositionRef.current");
  });

  test("onContentStart deletes through the mapped range, never the raw ref", () => {
    const body = between(
      panel,
      "onContentStart:",
      "onContentChunk:",
    );
    // The ref must be read into a local and guarded before any write, because
    // the deleteSelection below re-enters the transaction handler.
    expect(body).toContain("clampRange(");
    expect(body).toMatch(/setTextSelection\(pendingSelection\)/);
    expect(body).not.toMatch(/setTextSelection\(\s*selectionRangeRef\.current/);
  });

  test("removeStreamingMarks clamps before dispatching", () => {
    const body = between(
      panel,
      "const removeStreamingMarks",
      "const scheduleStreamingMarkRemoval",
    );
    expect(body).toContain("clampRange(");
    expect(body).toContain("isDestroyed");
    // The raw captured integers must not reach setTextSelection.
    expect(body).not.toMatch(/setTextSelection\(\{\s*from:\s*startPos/);
  });

  test("the streaming-mark timers are tracked so they can be cleared", () => {
    expect(panel).toContain("streamingMarkTimersRef");
    expect(panel).toContain("forEach(clearTimeout)");
    // No bare setTimeout may schedule a mark removal any more.
    expect(panel).not.toMatch(/setTimeout\(\(\) => \{\s*removeStreamingMarks/);
  });

  test("a dropped AI insert is reported rather than swallowed", () => {
    expect(panel).not.toContain("// Silent fail");
    expect(panel).toContain("captureError(");
  });

  test("the highlight extension shares the same clamp", () => {
    expect(highlight).toContain("clampRange(");
  });
});
