// AI credits shown to customers: estimates come from the published price
// table, "Used N credits" from the API (header or stream event), and the
// out-of-credits / low-balance states from the balance summary.

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  balanceState,
  creditsFromEvent,
  creditsUsedFromResponse,
  estimateCredits,
  isOutOfCreditsError,
  minutesFromText,
} from "../services/ai/credits.ts";

const prices = {
  low_balance_pct: 20,
  critical_balance_pct: 5,
  features: [
    { key: "image_generation", label: "Image generation", credits: 9, unit: "image", metered: false, group: "media", edition: "oss" },
    { key: "podcast_audio", label: "Audio", credits: 4, unit: "minute", metered: true, group: "media", edition: "oss" },
    { key: "ai_grading", label: "AI grading", credits: 2, unit: "submission", metered: true, group: "learners", edition: "oss", extra: { media_minutes: 1, images: 1 } },
    { key: "rag_indexing", label: "Indexing", credits: 0, unit: "page", metered: true, group: "learners", edition: "oss", absorbed: true },
  ],
};

describe("estimateCredits", () => {
  test("published price times units, rounded up", () => {
    expect(estimateCredits(prices, "image_generation")).toBe(9);
    expect(estimateCredits(prices, "image_generation", 3)).toBe(27);
    expect(estimateCredits(prices, "podcast_audio", 2.5)).toBe(10);
  });
  test("adds per-unit extras", () => {
    expect(estimateCredits(prices, "ai_grading", 1, { media_minutes: 3, images: 1 })).toBe(6);
    expect(estimateCredits(prices, "ai_grading", 1, { unknown: 5 })).toBe(2);
  });
  test("unknown features and missing tables give null, absorbed ones 0", () => {
    expect(estimateCredits(prices, "nope")).toBeNull();
    expect(estimateCredits(undefined, "image_generation")).toBeNull();
    expect(estimateCredits(prices, "rag_indexing", 10)).toBe(0);
    // A metered feature shows its typical request, not just its minimum.
    const withTypical = { ...prices, features: [{ key: "atlas_chat", label: "Atlas", credits: 3, typical: 18, unit: "message", metered: true, group: "atlas", edition: "ee" }] };
    expect(estimateCredits(withTypical, "atlas_chat")).toBe(18);
    expect(estimateCredits(prices, "image_generation", 0)).toBe(0);
  });
});

describe("minutesFromText", () => {
  test("started minutes at 140 words per minute, at least one", () => {
    expect(minutesFromText("")).toBe(1);
    expect(minutesFromText("word ".repeat(140))).toBe(1);
    expect(minutesFromText("word ".repeat(141))).toBe(2);
    expect(minutesFromText("a b c", 1)).toBe(3);
  });
});

describe("credits used", () => {
  const res = (v) => ({ headers: { get: (n) => (n === "X-AI-Credits-Used" ? v : null) } });
  test("reads the response header", () => {
    expect(creditsUsedFromResponse(res("7"))).toBe(7);
    expect(creditsUsedFromResponse(res(null))).toBeNull();
    expect(creditsUsedFromResponse(res("x"))).toBeNull();
    expect(creditsUsedFromResponse(null)).toBeNull();
  });
  test("reads stream events", () => {
    expect(creditsFromEvent({ type: "credits", credits: 4 })).toBe(4);
    expect(creditsFromEvent({ type: "done", credits: 3 })).toBe(3);
    expect(creditsFromEvent({ type: "done" })).toBeNull();
    expect(creditsFromEvent({ type: "chunk", credits: 2 })).toBeNull();
    expect(creditsFromEvent(null)).toBeNull();
  });
});

describe("out of credits", () => {
  test("recognizes the API's credit errors", () => {
    expect(isOutOfCreditsError("AI credit limit reached. You have used all 500 credits.", 403)).toBe(true);
    expect(isOutOfCreditsError("AI credits are not available on the free plan. Please upgrade.", 403)).toBe(true);
    expect(isOutOfCreditsError({ code: "out_of_credits", message: "Atlas stopped" })).toBe(true);
    expect(isOutOfCreditsError({ detail: "AI credit limit reached." })).toBe(true);
  });
  test("ignores other errors", () => {
    expect(isOutOfCreditsError("AI is not enabled for this organization", 403)).toBe(false);
    expect(isOutOfCreditsError("AI credit limit reached.", 500)).toBe(false);
    expect(isOutOfCreditsError(undefined)).toBe(false);
  });
});

describe("balanceState", () => {
  const sum = (remaining, total, extra = {}) => ({ plan: "standard", base_credits: total, purchased_credits: 0, total_credits: total, used_credits: 0, remaining_credits: remaining, ...extra });
  test("uses the API's state when present", () => {
    expect(balanceState(sum(900, 1000, { balance_state: "critical" }))).toBe("critical");
  });
  test("derives it otherwise: 20% low, 5% critical, 0 empty", () => {
    expect(balanceState(sum(500, 1000))).toBe("ok");
    expect(balanceState(sum(200, 1000))).toBe("low");
    expect(balanceState(sum(50, 1000))).toBe("critical");
    expect(balanceState(sum(0, 1000))).toBe("empty");
    expect(balanceState(sum("unlimited", "unlimited"))).toBe("unlimited");
    expect(balanceState(undefined)).toBe("ok");
  });
});

// Atlas: the approval card carries the estimate, the turn the credits used.
const webRoot = path.resolve(import.meta.dirname, "..");
const turnsPath = path.join(webRoot, "ee/components/Atlas/atlasTurns.ts");
const hasEE = fs.existsSync(turnsPath);
describe.skipIf(!hasEE)("Atlas credits", () => {
  test("a preview.action keeps its estimate_credits on the card", async () => {
    const { applyEventToParts } = await import(turnsPath);
    const parts = applyEventToParts([], {
      type: "preview.action",
      pending_id: "p1",
      tool: "generate_course_thumbnails",
      tier: "edit",
      target: { kind: "course" },
      summary: "Generate 3 thumbnails",
      estimate_credits: 24,
    });
    const card = parts.find((p) => p.kind === "action");
    expect(card.estimateCredits).toBe(24);
  });
});
