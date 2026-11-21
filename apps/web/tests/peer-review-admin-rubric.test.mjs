import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_SETTINGS,
  OUTLIER_SPREAD,
  PEER_REVIEW_LIMITS,
  TEMPLATE_KEYS,
  buildTemplate,
  defaultPrompts,
  isOutlierSpread,
  maxRubricPoints,
  normalizeSettings,
  peerScoreMedians,
  pruneSampleScores,
  reviewPercentage,
  samePrompts,
  templateKeys,
  validatePrompts,
  validateRubric,
  validateSamples,
  validateSettings,
} from "../lib/assignments/peerReviewRubric.ts";

const LOCALES = join(import.meta.dir, "..", "locales");
const locale = (code) => JSON.parse(readFileSync(join(LOCALES, `${code}.json`), "utf8"));
const lookup = (dict, key) => key.split(".").reduce((node, part) => (node == null ? undefined : node[part]), dict);
const codes = (issues) => issues.map((i) => i.code);

let seq = 0;
const id = (p) => `${p}_${++seq}`;
const level = (points, label = `L${points}`) => ({ id: id("l"), points, label, description: "" });
const criterion = (title = "Idea", levels = [level(2), level(1), level(0)]) => ({ id: id("c"), title, description: "", levels });

describe("validateRubric", () => {
  test("a filled rubric passes", () => {
    expect(validateRubric([criterion(), criterion("Style")])).toEqual([]);
  });

  test("needs 1 to 10 criteria", () => {
    expect(codes(validateRubric([]))).toEqual(["criteria_min"]);
    const many = Array.from({ length: PEER_REVIEW_LIMITS.criteriaMax + 1 }, () => criterion());
    expect(codes(validateRubric(many))).toContain("criteria_max");
  });

  test("needs 2 to 6 levels per criterion", () => {
    expect(validateRubric([criterion("A", [level(1)])])).toEqual([{ code: "levels_min", criterion: 0 }]);
    const seven = Array.from({ length: 7 }, (_, i) => level(i));
    expect(codes(validateRubric([criterion("A", seven)]))).toContain("levels_max");
  });

  test("flags blank titles, blank labels and bad points with their position", () => {
    const bad = criterion("  ", [level(1, ""), level(-1), level(1001), { ...level(1), points: NaN }]);
    const issues = validateRubric([criterion(), bad]);
    expect(issues).toContainEqual({ code: "criterion_title", criterion: 1 });
    expect(issues).toContainEqual({ code: "level_label", criterion: 1, level: 0 });
    expect(issues).toContainEqual({ code: "level_points", criterion: 1, level: 1 });
    expect(issues).toContainEqual({ code: "level_points", criterion: 1, level: 2 });
    expect(issues).toContainEqual({ code: "level_points", criterion: 1, level: 3 });
  });

  test("flags duplicate ids", () => {
    const a = criterion();
    const dupLevel = criterion("B", [{ ...level(1), id: "same" }, { ...level(0), id: "same" }]);
    const issues = codes(validateRubric([a, { ...a }, dupLevel]));
    expect(issues).toContain("criterion_duplicate_id");
    expect(issues).toContain("level_duplicate_id");
  });
});

describe("validatePrompts", () => {
  test("null means translated defaults and is valid", () => {
    expect(validatePrompts(null)).toEqual([]);
  });

  test("enforces 1 to 5 prompts, labels and min_chars 0..2000", () => {
    expect(codes(validatePrompts([]))).toEqual(["prompts_min"]);
    const six = Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, label: "Q", min_chars: 0 }));
    expect(codes(validatePrompts(six))).toContain("prompts_max");
    const issues = validatePrompts([
      { key: "a", label: "", min_chars: 0 },
      { key: "b", label: "Q", min_chars: 2001 },
      { key: "c", label: "Q", min_chars: 1.5 },
      { key: "c", label: "Q", min_chars: 0 },
    ]);
    expect(issues).toContainEqual({ code: "prompt_label", prompt: 0 });
    expect(issues).toContainEqual({ code: "prompt_min_chars", prompt: 1 });
    expect(issues).toContainEqual({ code: "prompt_min_chars", prompt: 2 });
    expect(issues).toContainEqual({ code: "prompt_duplicate_key", prompt: 3 });
  });
});

describe("validateSamples and pruneSampleScores", () => {
  const rubric = [criterion("A"), criterion("B")];
  const full = { [rubric[0].id]: rubric[0].levels[0].id, [rubric[1].id]: rubric[1].levels[2].id };

  test("a sample needs a title, content and a level for every criterion", () => {
    expect(validateSamples([{ id: "s", title: "T", content: "x", scores: full }], rubric)).toEqual([]);
    const issues = codes(validateSamples([{ id: "s", title: "", content: " ", scores: { [rubric[0].id]: "gone" } }], rubric));
    expect(issues).toEqual(["sample_title", "sample_content", "sample_levels"]);
  });

  test("pruning drops removed criteria and levels", () => {
    const [sample] = pruneSampleScores([{ id: "s", title: "T", content: "x", scores: { ...full, removed: "l_x", [rubric[1].id]: "gone" } }], rubric);
    expect(sample.scores).toEqual({ [rubric[0].id]: rubric[0].levels[0].id });
  });
});

describe("validateSettings", () => {
  test("defaults are valid while off, but turning on needs a rubric", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual([]);
    expect(codes(validateSettings({ ...DEFAULT_SETTINGS, enabled: true }))).toEqual(["criteria_min"]);
  });

  test("on plus a template is enough to save", () => {
    const rubric = buildTemplate("writing", (k) => k);
    expect(validateSettings({ ...DEFAULT_SETTINGS, enabled: true, rubric })).toEqual([]);
  });

  test("reviews per learner and min reviews stay in 1..10", () => {
    const issues = codes(validateSettings({ ...DEFAULT_SETTINGS, reviews_required: 11, min_reviews_for_score: 0 }));
    expect(issues).toContain("reviews_range");
    expect(issues).toContain("min_reviews_range");
  });

  test("normalizeSettings fills gaps", () => {
    const s = normalizeSettings({ enabled: true, rubric: null, prompts: "x" });
    expect(s.reviews_required).toBe(3);
    expect(s.rubric).toEqual([]);
    expect(s.prompts).toBeNull();
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("templates", () => {
  for (const key of TEMPLATE_KEYS) {
    test(`${key}: 4 criteria with 3-4 levels, valid, fresh ids`, () => {
      const rubric = buildTemplate(key, (k) => `t:${k}`);
      expect(rubric).toHaveLength(4);
      for (const c of rubric) {
        expect(c.levels.length).toBeGreaterThanOrEqual(3);
        expect(c.levels.length).toBeLessThanOrEqual(4);
        expect(c.title.startsWith("t:peer_review.instructor.templates.")).toBe(true);
      }
      expect(validateRubric(rubric)).toEqual([]);
      const ids = rubric.flatMap((c) => [c.id, ...c.levels.map((l) => l.id)]);
      expect(new Set(ids).size).toBe(ids.length);
      // A second build never reuses ids.
      const again = buildTemplate(key, (k) => k).flatMap((c) => [c.id, ...c.levels.map((l) => l.id)]);
      expect(again.some((i) => ids.includes(i))).toBe(false);
    });
  }

  test("every template string exists in all 22 locales", () => {
    const files = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(22);
    const keys = TEMPLATE_KEYS.flatMap(templateKeys);
    for (const file of files) {
      const dict = locale(file.replace(".json", ""));
      const missing = keys.filter((k) => typeof lookup(dict, k) !== "string" || !lookup(dict, k).trim());
      expect({ file, missing }).toEqual({ file, missing: [] });
    }
  });

  test("default prompts use the shared learner labels", () => {
    const en = locale("en");
    const prompts = defaultPrompts((k) => lookup(en, k));
    expect(prompts.map((p) => [p.key, p.min_chars])).toEqual([["strength", 40], ["suggestion", 40], ["question", 0]]);
    expect(prompts.every((p) => typeof p.label === "string" && p.label.length > 0)).toBe(true);
    expect(samePrompts(prompts, prompts.map((p) => ({ ...p, label: ` ${p.label} ` })))).toBe(true);
    expect(samePrompts(prompts, prompts.slice(1))).toBe(false);
  });
});

describe("outlier rule and scores", () => {
  test("spread of 25 points or more is an outlier", () => {
    expect(OUTLIER_SPREAD).toBe(25);
    expect(isOutlierSpread(25)).toBe(true);
    expect(isOutlierSpread(40.5)).toBe(true);
    expect(isOutlierSpread(24.9)).toBe(false);
    expect(isOutlierSpread(null)).toBe(false);
    expect(isOutlierSpread(undefined)).toBe(false);
    expect(isOutlierSpread(NaN)).toBe(false);
    expect(isOutlierSpread(10, 10)).toBe(true);
  });

  test("review percentage follows sum(points) / sum(max)", () => {
    const rubric = [criterion("A", [level(4), level(2)]), criterion("B", [level(2), level(0)])];
    expect(maxRubricPoints(rubric)).toBe(6);
    const scores = { [rubric[0].id]: rubric[0].levels[1].id, [rubric[1].id]: rubric[1].levels[0].id };
    expect(reviewPercentage(scores, rubric)).toBeCloseTo(66.67, 1);
    expect(reviewPercentage(scores, rubric, 12)).toBe(12);
    expect(reviewPercentage({}, rubric)).toBeNull();
  });

  test("peer score medians accept both API shapes", () => {
    expect(peerScoreMedians({ criteria: [{ criterion_id: "a", median: 2.5 }], percentage: 50, review_count: 3, spread: 0 })).toEqual({ a: 2.5 });
    expect(peerScoreMedians({ criteria: { a: 1 }, percentage: 50, review_count: 3, spread: 0 })).toEqual({ a: 1 });
    expect(peerScoreMedians(null)).toEqual({});
  });
});
