import { describe, expect, test } from "bun:test";

import {
  buildSteps,
  computeGaps,
  defaultStep,
  isPast,
  jsonToLines,
  median,
  peerScoreMedians,
  promptStatus,
  resolvePrompts,
  reviewPercentage,
  reviewProgress,
  unlockDisplay,
  validateReview,
} from "../components/Objects/Activities/Assignment/PeerReview/peerReviewLogic.ts";

const rubric = [
  {
    id: "clarity",
    title: "Clarity",
    levels: [
      { id: "c0", points: 0, label: "Unclear" },
      { id: "c2", points: 2, label: "Mostly clear" },
      { id: "c4", points: 4, label: "Crystal clear" },
    ],
  },
  {
    id: "evidence",
    title: "Evidence",
    levels: [
      { id: "e0", points: 0, label: "None" },
      { id: "e1", points: 1, label: "Some" },
      { id: "e2", points: 2, label: "Strong" },
    ],
  },
];
const prompts = [
  { key: "strength", label: "What works", min_chars: 10 },
  { key: "question", label: "A question", min_chars: 0 },
];

describe("min chars", () => {
  test("counts trimmed characters and what is left", () => {
    expect(promptStatus("  hello  ", 10)).toEqual({ count: 5, min: 10, remaining: 5, ok: false });
    expect(promptStatus("0123456789", 10).ok).toBe(true);
    expect(promptStatus(undefined, 0)).toEqual({ count: 0, min: 0, remaining: 0, ok: true });
  });

  test("whitespace alone never satisfies a minimum", () => {
    expect(promptStatus("            ", 3).ok).toBe(false);
  });

  test("validateReview lists unscored criteria and short prompts", () => {
    const v = validateReview(rubric, prompts, { clarity: "c2" }, { strength: "too short" });
    expect(v.ok).toBe(false);
    expect(v.missingCriteria).toEqual(["evidence"]);
    expect(v.shortPrompts).toEqual(["strength"]);
    expect(validateReview(rubric, prompts, { clarity: "c2", evidence: "e1" }, { strength: "long enough text" }).ok).toBe(true);
  });

  test("a level id from another criterion does not count", () => {
    expect(validateReview(rubric, [], { clarity: "e2", evidence: "e2" }, {}).missingCriteria).toEqual(["clarity"]);
  });

  test("instructor prompts win over defaults, empty falls back", () => {
    expect(resolvePrompts(null, prompts)).toBe(prompts);
    expect(resolvePrompts([], prompts)).toBe(prompts);
    const custom = [{ key: "x", label: "X", min_chars: 5 }];
    expect(resolvePrompts(custom, prompts)).toBe(custom);
  });
});

describe("scores and gaps", () => {
  test("percentage and median", () => {
    expect(reviewPercentage(rubric, { clarity: "c4", evidence: "e1" })).toBe(83);
    expect(reviewPercentage(rubric, {})).toBe(null);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(null);
  });

  test("peer_score criteria accepts an array or a map", () => {
    expect(peerScoreMedians({ criteria: [{ criterion_id: "clarity", median: 2 }] })).toEqual({ clarity: 2 });
    expect(peerScoreMedians({ criteria: { clarity: 4, evidence: 1.5 } })).toEqual({ clarity: 4, evidence: 1.5 });
    expect(peerScoreMedians(null)).toEqual({});
  });

  test("gap uses peer_score medians against the self-review", () => {
    const rows = computeGaps(rubric, { criteria: { clarity: 2, evidence: 2 } }, [], { clarity: "c4", evidence: "e2" });
    expect(rows[0]).toMatchObject({ criterionId: "clarity", peer: 2, self: 4, gap: 2, peerPct: 50, selfPct: 100, direction: "self_higher" });
    expect(rows[1]).toMatchObject({ peer: 2, self: 2, gap: 0, direction: "aligned" });
  });

  test("without a published score the median comes from submitted reviews", () => {
    const received = [
      { status: "submitted", scores: { clarity: "c0" } },
      { status: "submitted", scores: { clarity: "c2" } },
      { status: "submitted", scores: { clarity: "c2" } },
      { status: "discarded", scores: { clarity: "c4" } },
    ];
    const rows = computeGaps(rubric, null, received, { clarity: "c0" });
    expect(rows[0]).toMatchObject({ peer: 2, self: 0, gap: -2, direction: "self_lower" });
    expect(rows[1]).toMatchObject({ peer: null, self: null, gap: null, direction: null });
  });
});

describe("progress and unlock", () => {
  test("Review N of M", () => {
    expect(reviewProgress({ required: 3, done: 1 })).toMatchObject({ current: 2, remaining: 2, complete: false, pct: 33 });
    expect(reviewProgress({ required: 3, done: 3 })).toMatchObject({ current: 4, remaining: 0, complete: true, extra: true, pct: 100 });
    expect(reviewProgress({ required: 3, done: 5 }).pct).toBe(100);
  });

  test("an effective target of 0 means nobody to review yet, not finished", () => {
    expect(reviewProgress({ required: 0, done: 0 })).toMatchObject({ complete: false, extra: false, pct: 0, remaining: 0 });
  });

  test("locked feedback says how many reviews are left and the due date", () => {
    expect(unlockDisplay({ unlocked: false, count: 0 }, { required: 3, done: 1 }, "2026-12-01")).toEqual({
      state: "locked",
      remainingReviews: 2,
      dueDate: "2026-12-01",
    });
    expect(unlockDisplay({ unlocked: true, reason: "due_date", count: 2 }, { required: 3, done: 0 }, null)).toEqual({
      state: "unlocked",
      reason: "due_date",
      count: 2,
    });
  });

  test("steps: practice gates reviews, self is optional", () => {
    const steps = {
      self: { enabled: true, done: false },
      calibration: { enabled: true, total: 2, done: 1 },
      reviews: { required: 3, done: 0, open_review_uuid: null, available: true },
      feedback: { unlocked: false, reason: null, count: 0 },
    };
    expect(buildSteps(steps)).toEqual([
      { key: "self", status: "todo" },
      { key: "calibration", status: "todo" },
      { key: "reviews", status: "locked" },
      { key: "feedback", status: "locked" },
    ]);
    const noSamples = { ...steps, self: { enabled: false, done: false }, calibration: { enabled: true, total: 0, done: 0 } };
    expect(buildSteps(noSamples).map((s) => s.key)).toEqual(["reviews", "feedback"]);
  });

  test("lands on an open review, else the first unfinished step", () => {
    const items = [
      { key: "self", status: "todo" },
      { key: "reviews", status: "todo" },
      { key: "feedback", status: "locked" },
    ];
    expect(defaultStep(items, true)).toBe("reviews");
    expect(defaultStep(items, false)).toBe("self");
    expect(defaultStep([{ key: "reviews", status: "done" }, { key: "feedback", status: "done" }], false)).toBe("feedback");
  });

  test("a date-only deadline is still open on that day", () => {
    const day = new Date(2026, 10, 21, 18, 0).getTime();
    expect(isPast("2026-11-21", day)).toBe(false);
    expect(isPast("2026-11-21T12:00", day)).toBe(true);
    expect(isPast("garbage", day)).toBe(false);
  });
});

describe("generic answer fallback", () => {
  test("turns JSON into readable lines and drops ids", () => {
    expect(jsonToLines({ answer: "42", assignment_task_submission_uuid: "x", notes: { why: "because" } })).toEqual([
      "answer: 42",
      "notes:",
      "  why: because",
    ]);
    expect(jsonToLines(null)).toEqual([]);
  });
});

describe("translations", () => {
  const { readFileSync, readdirSync } = require("node:fs");
  const { join } = require("node:path");
  const dir = join(import.meta.dir, "../components/Objects/Activities/Assignment/PeerReview");
  const used = new Set();
  for (const f of readdirSync(dir)) {
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/'peer_review\.(learner|common)\.([a-z0-9_]+)'/g)) used.add(`${m[1]}.${m[2]}`);
  }
  const locales = readdirSync(join(import.meta.dir, "../locales")).filter((f) => f.endsWith(".json"));
  const vars = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

  test("covers 22 locales", () => {
    expect(locales.length).toBe(22);
  });

  test("every key the learner UI uses exists in every locale, with the same placeholders", () => {
    const en = JSON.parse(readFileSync(join(import.meta.dir, "../locales/en.json"), "utf8")).peer_review;
    const missing = [];
    for (const file of locales) {
      const pr = JSON.parse(readFileSync(join(import.meta.dir, "../locales", file), "utf8")).peer_review ?? {};
      for (const key of used) {
        const [ns, name] = key.split(".");
        const table = pr[ns] ?? {};
        const forms = Object.keys(table).filter((k) => k === name || k.startsWith(`${name}_`) && /_(zero|one|two|few|many|other)$/.test(k));
        if (forms.length === 0) {
          missing.push(`${file}: ${key}`);
          continue;
        }
        const enText = en[ns][name] ?? en[ns][`${name}_other`];
        const want = vars(enText);
        const other = table[name] ?? table[`${name}_other`];
        if (JSON.stringify(vars(other)) !== JSON.stringify(want)) missing.push(`${file}: ${key} placeholders`);
      }
    }
    expect(missing).toEqual([]);
  }, 60_000);
});
