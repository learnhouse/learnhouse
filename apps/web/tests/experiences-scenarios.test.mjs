// Scenarios, Experiences redesign: the story builder's "Then…" select, step
// titles, endings and feedback, and the learner player's state machine.
// Old content (no new fields) must normalise to exactly what was stored.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  DEFAULT_OUTCOME,
  addStep,
  applyThen,
  backPlay,
  continuePlay,
  displayOf,
  followingStep,
  moveStep,
  normalizeScenario,
  pickChoice,
  setChoiceFeedback,
  setStepEnding,
  startPlay,
  stepNumber,
  stepTitle,
  thenOf,
  updateChoice,
  validateScenario,
} from "../components/Objects/Editor/Extensions/Scenarios/scenarioModel.ts";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/editor-blocks/experiences-scenarios-flashcards.json", import.meta.url), "utf8"));
const flowFixtures = JSON.parse(readFileSync(new URL("./fixtures/editor-blocks/db-flow-blocks.json", import.meta.url), "utf8"));
const nodesOf = (list, type) => list.flatMap((f) => f.nodes.filter((n) => n.type === type));
const [OLD, NEW] = nodesOf(fixtures, "scenarios");

const step = (id, text, options = [], extra = {}) => ({ id, text, imageUrl: "", options, ...extra });
const opt = (id, text, next, extra = {}) => ({ id, text, nextScenarioId: next, ...extra });
const data = (scenarios, start = "1") => ({ title: "T", scenarios, currentScenarioId: start });

describe("backward compatibility", () => {
  test("old stored scenarios normalise to exactly what was stored (no new keys added)", () => {
    for (const node of [OLD, ...nodesOf(flowFixtures, "scenarios")]) {
      const n = normalizeScenario(node.attrs);
      // Strict: no `feedback`, `outcome`, `ending` or `display` keys appear.
      expect(n.scenarios).toStrictEqual(node.attrs.scenarios.map((s) => ({ ...s, imageUrl: s.imageUrl ?? "" })));
      expect("display" in n).toBe(false);
      expect(displayOf(n)).toBe("story");
    }
  });

  test("new fields survive a round trip; invalid values are dropped", () => {
    const n = normalizeScenario(NEW.attrs);
    expect(n.display).toBe("chat");
    expect(n.scenarios).toStrictEqual(NEW.attrs.scenarios);
    const junk = normalizeScenario({
      display: "slides",
      scenarios: [step("1", "x", [opt("a", "a", null, { outcome: "great", feedback: 4 })], { ending: { tone: "meh" } })],
    });
    expect(junk.display).toBeUndefined();
    expect(junk.scenarios[0]).toStrictEqual(step("1", "x", [opt("a", "a", null)]));
  });

  test("the renderer tolerates the API's larger limits (100 steps, 12 choices)", () => {
    const steps = Array.from({ length: 100 }, (_, i) =>
      step(String(i + 1), `Step ${i + 1}`, Array.from({ length: 12 }, (_, j) => opt(`o${i}_${j}`, `c${j}`, i === 99 ? null : String(i + 2)))),
    );
    const n = normalizeScenario(data(steps));
    expect(n.scenarios.length).toBe(100);
    expect(n.scenarios[0].options.length).toBe(12);
    expect(validateScenario(n).issues.filter((i) => i.level === "error")).toEqual([]);
    let s = startPlay(n);
    for (let i = 0; i < 99; i++) s = pickChoice(n, s, `o${i}_11`);
    expect(stepNumber(s)).toBe(100);
    s = pickChoice(n, s, "o99_11");
    expect(s.ended).toMatchObject({ via: "choice", toned: false, tone: DEFAULT_OUTCOME });
  });
});

describe("story builder", () => {
  test("step titles are the first words of the text, never ids", () => {
    expect(stepTitle({ text: "A customer   asks for a refund after forty days." })).toBe("A customer asks for a refund…");
    expect(stepTitle({ text: "Short one" })).toBe("Short one");
    expect(stepTitle({ text: "   " })).toBe("");
    expect(stepTitle({ text: "Supercalifragilisticexpialidocious-and-then-some-more-words" }, 6, 20).length).toBeLessThanOrEqual(21);
  });

  test("Then… reflects next step, go to, end with tone, and missing targets", () => {
    const d = data([
      step("1", "a", [opt("a", "x", "2"), opt("b", "y", "3"), opt("c", "z", null), opt("d", "w", null, { outcome: "fail" }), opt("e", "v", "gone")]),
      step("2", "b"),
      step("3", "c"),
    ]);
    const s1 = d.scenarios[0];
    expect(s1.options.map((o) => thenOf(d, "1", o))).toEqual(["next", "go:3", "end:success", "end:fail", "missing"]);
    // Moving a step turns a "next" link into a "go to" without touching ids.
    const moved = moveStep(d, "3", -1);
    expect(thenOf(moved, "1", moved.scenarios[0].options[0])).toBe("go:2");
  });

  test("applying Then… values", () => {
    const d = data([step("1", "a", [opt("a", "x", null, { outcome: "fail" })]), step("2", "b"), step("3", "c")]);
    const next = applyThen(d, "1", "a", "next").data;
    expect(next.scenarios[0].options[0]).toStrictEqual(opt("a", "x", "2"));
    const go = applyThen(d, "1", "a", "go:3").data;
    expect(go.scenarios[0].options[0].nextScenarioId).toBe("3");
    expect(applyThen(d, "1", "a", "go:nope").data).toBe(d);
    const end = applyThen(next, "1", "a", "end:neutral").data;
    expect(end.scenarios[0].options[0]).toStrictEqual(opt("a", "x", null, { outcome: "neutral" }));
    expect(applyThen(d, "1", "a", "end:bogus").data).toBe(d);
    expect(applyThen(d, "1", "a", "missing").data).toBe(d);
    expect(applyThen(d, "1", "zz", "next").data).toBe(d);
    // New step: created right after, linked, returned for scrolling.
    const created = applyThen(d, "1", "a", "new");
    expect(created.createdId).toBe("4");
    expect(created.data.scenarios.map((s) => s.id)).toEqual(["1", "4", "2", "3"]);
    expect(created.data.scenarios[0].options[0]).toStrictEqual(opt("a", "x", "4"));
    // "Next step" on the last step creates one.
    const last = data([step("1", "a", [opt("a", "x", null)])]);
    const r = applyThen(last, "1", "a", "next");
    expect(r.createdId).toBe("2");
    expect(followingStep(r.data, "1").id).toBe("2");
    expect(followingStep(r.data, "2")).toBeUndefined();
  });

  test("feedback and step endings add keys only when set", () => {
    const d = data([step("1", "a", [opt("a", "x", null)])]);
    const withFb = setChoiceFeedback(d, "1", "a", "Nice");
    expect(withFb.scenarios[0].options[0].feedback).toBe("Nice");
    expect(setChoiceFeedback(withFb, "1", "a", "  ").scenarios[0].options[0]).toStrictEqual(opt("a", "x", null));
    const ended = setStepEnding(d, "1", { tone: "fail", title: "  " });
    expect(ended.scenarios[0].ending).toStrictEqual({ tone: "fail" });
    expect(setStepEnding(ended, "1", { tone: "success", title: "Kept" }).scenarios[0].ending).toStrictEqual({ tone: "success", title: "Kept" });
    expect("ending" in setStepEnding(ended, "1", null).scenarios[0]).toBe(false);
    expect(setStepEnding(d, "nope", null)).toStrictEqual(d);
    expect(setChoiceFeedback(d, "nope", "a", "")).toBe(d);
  });

  test("new steps keep the plain old shape", () => {
    const r = addStep(data([step("1", "a")]), {}, "1");
    expect(r.data.scenarios[1]).toStrictEqual(step("2", "", []));
  });
});

describe("learner player", () => {
  const story = normalizeScenario(NEW.attrs);

  test("feedback waits for Continue, then moves on; step counter follows the path", () => {
    let s = startPlay(story);
    expect(s).toMatchObject({ stepId: "s1", pending: null, ended: null });
    expect(stepNumber(s)).toBe(1);
    s = pickChoice(story, s, "o1");
    expect(s.pending).toBe("o1");
    expect(s.stepId).toBe("s1");
    // Another pick while feedback shows is ignored.
    expect(pickChoice(story, s, "o2")).toBe(s);
    s = continuePlay(story, s);
    expect(s).toMatchObject({ stepId: "s2", pending: null });
    expect(s.path).toEqual([{ stepId: "s1", choiceId: "o1", choiceText: "Apologise and ask for the order number", feedback: "Good: you acknowledged them first." }]);
    expect(stepNumber(s)).toBe(2);
  });

  test("a choice without feedback moves at once; step endings carry tone and title", () => {
    let s = continuePlay(story, pickChoice(story, startPlay(story), "o1"));
    s = pickChoice(story, s, "o3");
    expect(s.stepId).toBe("s3");
    expect(s.ended).toEqual({ tone: "success", title: "Customer kept", toned: true, via: "step" });
    expect(pickChoice(story, s, "o3")).toBe(s);
  });

  test("ending choices carry their outcome", () => {
    let s = continuePlay(story, pickChoice(story, startPlay(story), "o2"));
    expect(s.ended).toEqual({ tone: "fail", title: "", toned: true, via: "choice" });
    expect(s.path[0].outcome).toBe("fail");
    s = continuePlay(story, pickChoice(story, startPlay(story), "o1"));
    s = pickChoice(story, s, "o4");
    expect(s.ended).toMatchObject({ tone: "neutral", via: "choice" });
  });

  test("old content ends with the old (untoned) completion", () => {
    const old = normalizeScenario(OLD.attrs);
    expect(pickChoice(old, startPlay(old), "b").ended).toEqual({ tone: DEFAULT_OUTCOME, title: "", toned: false, via: "choice" });
    expect(pickChoice(old, startPlay(old), "a").ended).toEqual({ tone: DEFAULT_OUTCOME, title: "", toned: false, via: "step" });
  });

  test("back undoes the pending pick first, then the last choice; edge cases", () => {
    let s = pickChoice(story, startPlay(story), "o1");
    expect(backPlay(s).pending).toBeNull();
    s = continuePlay(story, s);
    expect(backPlay(s)).toMatchObject({ stepId: "s1", path: [], ended: null });
    const fresh = startPlay(story);
    expect(backPlay(fresh)).toBe(fresh);
    expect(startPlay(data([]))).toEqual({ stepId: null, path: [], pending: null, ended: null });
    expect(startPlay(data([step("1", "only")])).ended).toMatchObject({ via: "step", toned: false });
    expect(pickChoice(story, fresh, "nope")).toBe(fresh);
    expect(continuePlay(story, fresh)).toEqual({ ...fresh, pending: null });
    // A choice pointing at a deleted step finishes instead of erroring.
    const broken = data([step("1", "a", [opt("a", "x", "gone")])]);
    expect(pickChoice(broken, startPlay(broken), "a").ended).toMatchObject({ via: "choice" });
    // Edits after a pick: the pending choice vanished.
    const edited = updateChoice(story, "s1", "o1", { id: "renamed" });
    expect(continuePlay(edited, pickChoice(story, fresh, "o1")).pending).toBeNull();
  });
});
