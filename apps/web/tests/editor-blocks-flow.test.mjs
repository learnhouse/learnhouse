// Scenarios, Conditional and Magic blocks (agent "blocks-flow" redesign).
//
// Pure helpers behind the new editors, plus backward compatibility against
// REAL stored nodes (tests/fixtures/editor-blocks/db-flow-blocks.json, dumped
// from a local database): old content must read and render exactly as before.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  MAX_CHOICES,
  addChoice,
  addStep,
  deleteChoice,
  deleteStep,
  excerpt,
  layoutScenario,
  linkChoiceToNewStep,
  moveStep,
  nextStepId,
  normalizeScenario,
  reachableFrom,
  startIdOf,
  updateChoice,
  validateScenario,
} from "../components/Objects/Editor/Extensions/Scenarios/scenarioModel.ts";
import { branchRole, sameRules } from "../components/Objects/Editor/Extensions/Dynamic/conditionalBranch.ts";
import { describeRules, negateRules, parseRules, stringifyRules } from "../components/Objects/Editor/Extensions/Dynamic/dynamicRules.ts";
import { buildMagicDocument, classifyMagicError, MAGIC_CREDIT_COST } from "../components/Objects/Editor/Extensions/MagicBlocks/magicModel.ts";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/editor-blocks/db-flow-blocks.json", import.meta.url), "utf8"));
const realNodes = (type) => fixtures.flatMap((f) => f.nodes.filter((n) => n.type === type));
const codes = (report) => report.issues.map((i) => `${i.code}${i.stepId ? ":" + i.stepId : ""}`).sort();

const step = (id, text, options = []) => ({ id, text, imageUrl: "", options });
const opt = (id, text, next) => ({ id, text, nextScenarioId: next });
const data = (scenarios, start = "1", title = "T") => ({ title, scenarios, currentScenarioId: start });

// The block's default content (Scenarios.ts / toolbar starter).
const DEFAULT = data([
  step("1", "Welcome", [opt("opt1", "Continue", "2"), opt("opt2", "Learn more", "3")]),
  step("2", "Exploring", [opt("opt3", "Back", "1"), opt("opt4", "Finish", null)]),
  step("3", "Info", [opt("opt5", "Back", "1"), opt("opt6", "Finish", null)]),
]);

describe("scenarios: stored content", () => {
  test("fixtures include real scenario, magic and conditional nodes", () => {
    expect(realNodes("scenarios").length).toBeGreaterThan(0);
    expect(realNodes("blockMagic").length).toBeGreaterThan(1);
    expect(realNodes("conditionalBlock").length).toBeGreaterThan(0);
  });

  test("normalising real stored scenarios keeps every stored value", () => {
    for (const node of realNodes("scenarios")) {
      const n = normalizeScenario(node.attrs);
      expect(n.title).toBe(node.attrs.title);
      expect(n.currentScenarioId).toBe(node.attrs.currentScenarioId);
      expect(n.scenarios.map((s) => [s.id, s.text, s.imageUrl])).toEqual(node.attrs.scenarios.map((s) => [s.id, s.text, s.imageUrl ?? ""]));
      expect(n.scenarios.map((s) => s.options)).toEqual(node.attrs.scenarios.map((s) => s.options));
    }
  });

  test("a stored step with no options is an ending, not an error (old player left learners stuck)", () => {
    const n = normalizeScenario(realNodes("scenarios")[0].attrs);
    const r = validateScenario(n);
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.canFinish.has("2")).toBe(true);
  });

  test("the default starter scenario is valid", () => {
    expect(validateScenario(DEFAULT).issues).toEqual([]);
  });

  test("normalize guards garbage from peers / AI output", () => {
    const n = normalizeScenario({ title: 5, scenarios: [null, { id: 7, text: null, options: [{ text: "x", nextScenarioId: "" }, 3] }] });
    expect(n.title).toBe("5");
    expect(n.scenarios).toEqual([{ id: "7", text: "", imageUrl: "", options: [{ id: "opt_0_0", text: "x", nextScenarioId: null }] }]);
    expect(n.currentScenarioId).toBe("7");
    expect(normalizeScenario(undefined)).toEqual({ title: "", scenarios: [], currentScenarioId: "1" });
  });

  test("the start falls back to the first step when the stored start is gone", () => {
    expect(startIdOf(data([step("a", "A")], "zzz"))).toBe("a");
    expect(startIdOf(data([], "1"))).toBe(null);
  });
});

describe("scenarios: validation", () => {
  const D = data([
    step("1", "Start", [opt("a", "to 2", "2"), opt("b", "end", null), opt("c", "to 3", "3")]),
    step("2", "Ending"),
    step("3", "Busy", [opt("d", "wait", "4"), opt("e", "back", "1")]),
    step("4", "Loop", [opt("f", "again", "4")]),
    step("5", "Orphan", [opt("g", "broken", "99")]),
    step("6", "", [opt("h", "", null)]),
  ]);

  test("finds dead ends, unreachable steps, broken links and empty text", () => {
    expect(codes(validateScenario(D))).toEqual([
      "broken_link:5",
      "dead_end:4",
      "empty_choice:6",
      "empty_text:6",
      "unreachable:5",
      "unreachable:6",
    ]);
  });

  test("errors vs warnings", () => {
    const r = validateScenario(D);
    expect(r.issues.filter((i) => i.level === "error").map((i) => i.code).sort()).toEqual(["broken_link", "dead_end"]);
    expect(r.byStep["4"].map((i) => i.code)).toEqual(["dead_end"]);
  });

  test("a scenario where no path ends is flagged as a whole", () => {
    const loop = data([step("1", "A", [opt("a", "x", "2")]), step("2", "B", [opt("b", "y", "1")])]);
    expect(codes(validateScenario(loop))).toEqual(["dead_end:1", "dead_end:2", "no_ending"]);
  });

  test("reachability follows choices from the start only", () => {
    expect([...reachableFrom(D, "1")].sort()).toEqual(["1", "2", "3", "4"]);
    expect(reachableFrom(D, "nope").size).toBe(0);
  });

  test("no steps at all", () => {
    expect(codes(validateScenario(data([])))).toEqual(["no_steps"]);
  });
});

describe("scenarios: edits", () => {
  test("ids: numeric stays numeric, mixed gets step_n, never a duplicate or NaN", () => {
    expect(nextStepId(DEFAULT.scenarios)).toBe("4");
    expect(nextStepId([step("1", ""), step("9", "")])).toBe("10");
    expect(nextStepId([step("intro", ""), step("step_2", "")])).toBe("step_3");
    expect(nextStepId([])).toBe("1");
    // The old editor did Math.max(...ids.map(parseInt)) + 1 → "NaN" for AI ids.
    expect(nextStepId([step("abc", "")])).not.toContain("NaN");
  });

  test("deleting a step re-points its incoming choices to the end and moves the start", () => {
    const d = deleteStep(DEFAULT, "1");
    expect(d.scenarios.map((s) => s.id)).toEqual(["2", "3"]);
    expect(d.scenarios[0].options[0]).toEqual(opt("opt3", "Back", null));
    expect(d.currentScenarioId).toBe("2");
  });

  test("add step after a step, link a choice to a new step", () => {
    const a = addStep(DEFAULT, { text: "New" }, "1");
    expect(a.data.scenarios.map((s) => s.id)).toEqual(["1", "4", "2", "3"]);
    const l = linkChoiceToNewStep(DEFAULT, "2", "opt4");
    expect(l.id).toBe("4");
    expect(l.data.scenarios.find((s) => s.id === "2").options[1].nextScenarioId).toBe("4");
    expect(l.data.scenarios.findIndex((s) => s.id === "4")).toBe(2);
  });

  test("first step added to an empty scenario becomes the start", () => {
    const r = addStep(data([], "x"));
    expect(r.data.currentScenarioId).toBe(r.id);
  });

  test("choices: add (max 4), update, delete; edits are immutable", () => {
    let d = DEFAULT;
    d = addChoice(d, "1", "C");
    d = addChoice(d, "1", "D");
    expect(addChoice(d, "1", "E")).toBe(d);
    expect(d.scenarios[0].options.length).toBe(MAX_CHOICES);
    const id = d.scenarios[0].options[2].id;
    d = updateChoice(d, "1", id, { nextScenarioId: "3" });
    expect(d.scenarios[0].options[2].nextScenarioId).toBe("3");
    d = deleteChoice(d, "1", id);
    expect(d.scenarios[0].options.map((o) => o.text)).toEqual(["Continue", "Learn more", "D"]);
    expect(DEFAULT.scenarios[0].options.length).toBe(2);
  });

  test("move steps up and down, clamped at the ends", () => {
    expect(moveStep(DEFAULT, "2", -1).scenarios.map((s) => s.id)).toEqual(["2", "1", "3"]);
    expect(moveStep(DEFAULT, "1", -1)).toBe(DEFAULT);
    expect(moveStep(DEFAULT, "3", 1)).toBe(DEFAULT);
  });

  test("excerpt flattens whitespace and truncates", () => {
    expect(excerpt("  a\n\n b  ")).toBe("a b");
    expect(excerpt("x".repeat(100), 10)).toBe("xxxxxxxxx…");
  });
});

describe("scenarios: map layout", () => {
  test("columns by distance from the start, orphans in their own column, one End marker", () => {
    const D = data([
      step("1", "S", [opt("a", "", "2"), opt("b", "", "3")]),
      step("2", "", [opt("c", "", null)]),
      step("3", "", [opt("d", "", "1")]),
      step("4", "orphan", [opt("e", "", "77")]),
    ]);
    const L = layoutScenario(D);
    const col = Object.fromEntries(L.nodes.map((n) => [n.id, n.col]));
    expect(col).toEqual({ 1: 0, 2: 1, 3: 1, 4: 2 });
    expect(L.nodes.find((n) => n.id === "4").reachable).toBe(false);
    expect(L.edges.map((e) => e.to)).toEqual(["2", "3", "end", "1", "broken"]);
    expect(L.end).not.toBe(null);
    // The canvas covers every card and the End marker.
    for (const n of L.nodes) {
      expect(n.x + 220).toBeLessThanOrEqual(L.width);
      expect(n.y + 92).toBeLessThanOrEqual(L.height);
    }
    expect(L.end.x).toBeLessThan(L.width);
  });

  test("no End marker when nothing ends by choice; empty scenario still has a canvas", () => {
    const L = layoutScenario(data([step("1", "only")]));
    expect(L.end).toBe(null);
    expect(L.width).toBeGreaterThan(0);
    expect(layoutScenario(data([])).nodes).toEqual([]);
  });
});

describe("conditional: if / otherwise pairs", () => {
  const node = (rules) => ({ type: { name: "conditionalBlock" }, attrs: { rules } });
  const half = { match: "all", conditions: [{ field: "user.bucket", op: "lt", value: 50 }] };

  test("a block followed by its exact opposite is an if/otherwise pair (insertABTest shape)", () => {
    const a = node(half);
    const b = node(negateRules(half));
    expect(branchRole(null, a, b)).toBe("if");
    expect(branchRole(a, b, null)).toBe("else");
  });

  test("unrelated neighbours, rule-less blocks and other node types don't pair", () => {
    const a = node(half);
    const other = node({ match: "all", conditions: [{ field: "course.completed", op: "is_true" }] });
    expect(branchRole(null, a, other)).toBe(null);
    expect(branchRole(null, node({ match: "all", conditions: [] }), node({ match: "all", conditions: [], negate: true }))).toBe(null);
    expect(branchRole({ type: { name: "paragraph" }, attrs: {} }, a, null)).toBe(null);
  });

  test("sameRules ignores a missing match / negate", () => {
    expect(sameRules({ conditions: [] }, { match: "all", negate: false, conditions: [] })).toBe(true);
    expect(sameRules(half, negateRules(half))).toBe(false);
  });

  test("real stored conditional rules still describe and round-trip the same", () => {
    for (const n of realNodes("conditionalBlock")) {
      expect(describeRules(n.attrs.rules)).toBe("Everyone");
      expect(parseRules(stringifyRules(n.attrs.rules))).toEqual({ match: "all", conditions: [] });
    }
  });
});

describe("magic block", () => {
  test("stored full documents render byte-for-byte as before", () => {
    const stored = realNodes("blockMagic").filter((n) => n.attrs.htmlContent);
    expect(stored.length).toBeGreaterThan(0);
    for (const n of stored) expect(buildMagicDocument(n.attrs.htmlContent)).toBe(n.attrs.htmlContent.trim());
  });

  test("empty stored blocks have nothing to render", () => {
    for (const n of realNodes("blockMagic").filter((x) => !x.attrs.htmlContent)) expect(buildMagicDocument(n.attrs.htmlContent)).toBe(null);
  });

  test("fragments and fenced output get wrapped in a sandbox document with the CSP", () => {
    const doc = buildMagicDocument("```html\n<div>Hi</div>\n```");
    expect(doc.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(doc).toContain("<div>Hi</div>");
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).not.toContain("```");
  });

  test("API errors map to the explanations the block shows", () => {
    expect(classifyMagicError("AI credit limit reached. You have used all 500 credits.").kind).toBe("credits");
    expect(classifyMagicError("Too many AI requests. Please slow down.").kind).toBe("rate");
    expect(classifyMagicError("Maximum iterations (6) reached").kind).toBe("limit");
    expect(classifyMagicError("AI is not enabled for this organization").kind).toBe("disabled");
    expect(classifyMagicError("AI credit store temporarily unavailable. Please retry.").kind).toBe("other");
    expect(classifyMagicError("stopped: the generation ended before it finished").kind).toBe("stopped");
    expect(classifyMagicError("HTTP error 500").kind).toBe("other");
  });

  test("the fallback credit cost mirrors the published price", () => {
    // The UI reads the price from GET /ai-credits/prices; MAGIC_CREDIT_COST is
    // only the fallback before that loads, so it must match pricing.FEATURES.
    const pricing = readFileSync(new URL("../../api/src/services/ai/pricing.py", import.meta.url), "utf8");
    expect(pricing).toMatch(new RegExp(`_f\\("magic_block", "[^"]+", ${MAGIC_CREDIT_COST},`));
  });
});
