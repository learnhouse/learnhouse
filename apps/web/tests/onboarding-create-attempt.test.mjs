// Creating an org from /new: one Idempotency-Key per attempt (same name, same
// key, so a retry replays), and the org this tab just made is remembered so
// the back button shows it instead of offering to create it again.

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  ATTEMPT_KEY,
  CREATED_KEY,
  CREATED_TTL_MS,
  attemptKey,
  recentlyCreated,
  rememberCreated,
  sessionStore,
} from "../services/onboarding/createAttempt.ts";

function memory() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

describe("attemptKey", () => {
  test("is stable for the same name and new for another", () => {
    const s = memory();
    const a = attemptKey(s, "Amy Allen");
    expect(a).toBeTruthy();
    expect(attemptKey(s, "  amy   allen ")).toBe(a);
    const b = attemptKey(s, "Brightwater");
    expect(b).not.toBe(a);
    expect(JSON.parse(s.m.get(ATTEMPT_KEY))).toEqual({ key: b, name: "brightwater" });
  });

  test("still returns a key without storage or with broken storage", () => {
    expect(attemptKey(null, "x")).toBeTruthy();
    const broken = { getItem: () => "{nope", setItem: () => { throw new Error("full"); }, removeItem: () => {} };
    expect(attemptKey(broken, "x")).toBeTruthy();
  });
});

describe("rememberCreated / recentlyCreated", () => {
  test("remembers the org and starts the next attempt fresh", () => {
    const s = memory();
    const first = attemptKey(s, "Amy Allen");
    rememberCreated(s, { id: 2768, slug: "amy-allen", name: "Amy Allen" }, 1_000);
    expect(s.m.has(ATTEMPT_KEY)).toBe(false);
    expect(recentlyCreated(s, 1_000 + 27_000)).toEqual({ id: 2768, slug: "amy-allen", name: "Amy Allen", at: 1_000 });
    expect(attemptKey(s, "Amy Allen")).not.toBe(first);
  });

  test("forgets it after the TTL, ignores junk and future stamps", () => {
    const s = memory();
    rememberCreated(s, { id: 1, slug: "a", name: "A" }, 0);
    expect(recentlyCreated(s, CREATED_TTL_MS + 1)).toBeNull();
    expect(recentlyCreated(s, -5)).toBeNull();
    s.setItem(CREATED_KEY, JSON.stringify({ id: "1", slug: "a", at: 0 }));
    expect(recentlyCreated(s, 1)).toBeNull();
    s.setItem(CREATED_KEY, "{broken");
    expect(recentlyCreated(s, 1)).toBeNull();
    expect(recentlyCreated(null)).toBeNull();
    expect(() => rememberCreated({ setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("y"); } }, { id: 1, slug: "a", name: "A" })).not.toThrow();
  });

  test("sessionStore is null outside the browser", () => {
    expect(sessionStore()).toBeNull();
  });
});

describe("/new wiring", () => {
  const page = fs.readFileSync(path.join(import.meta.dir, "..", "app", "(hub)", "new", "page.tsx"), "utf8");
  const service = fs.readFileSync(path.join(import.meta.dir, "..", "services", "onboarding", "onboarding.ts"), "utf8");

  test("sends the attempt key and drops a second submit while one is in flight", () => {
    expect(page).toContain("attemptKey(sessionStore(), name)");
    expect(page).toMatch(/if \(inFlight\.current\) return\s+inFlight\.current = true/);
    expect(page).toContain("inFlight.current = false");
    expect(service).toContain("'Idempotency-Key': idempotencyKey");
  });

  test("shows the org this tab just made", () => {
    expect(page).toContain("rememberCreated(sessionStore()");
    expect(page).toContain("recentlyCreated(sessionStore())");
    expect(page).toContain("t('onb2.new.just_created', { name: recent.name })");
  });

  test("every locale has the new strings", () => {
    const dir = path.join(import.meta.dir, "..", "locales");
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const n = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).onb2.new;
      expect(n.just_created).toContain("{{name}}");
      expect(n.just_created_open).toBeTruthy();
    }
  });
});
