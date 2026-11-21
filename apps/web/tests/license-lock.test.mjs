import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  isLicenseLockExemptPage,
  isLicenseLockedBody,
  licenseLockAction,
} from "../lib/license/lock.ts";
import {
  KNOWN_REASONS,
  licenseBannerItems,
  licenseBannerText,
  reasonKey,
  relativeWhen,
} from "../lib/license/banner.ts";

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const DAY = 86400;
const nowSec = NOW / 1000;

describe("licenseLockAction", () => {
  test("the login page and sign-in callbacks stay reachable", () => {
    for (const p of ["/login", "/Login", "/login/", "/auth/login", "/backoffice/login", "/auth/sso/okta/callback", "/auth/callback/google", "/auth/token-exchange", "/auth/magic", "/redirect_from_auth", "/health"]) {
      expect(licenseLockAction(p)).toBe("pass");
    }
  });

  test("every other page becomes the lock screen", () => {
    for (const p of ["/", "/dash", "/dash/courses", "/course/intro", "/signup", "/backoffice", "/home", "/account/general", "/license-locked"]) {
      expect(licenseLockAction(p)).toBe("page");
    }
  });

  test("feeds and machine-read files get a bare status", () => {
    for (const p of ["/sitemap.xml", "/robots.txt", "/llms.txt", "/feed.xml", "/podcast/abc/feed", "/course/abc/updates/feed"]) {
      expect(licenseLockAction(p)).toBe("status");
    }
  });

  test("the browser leaves only the exempt pages alone", () => {
    expect(isLicenseLockExemptPage("/login")).toBe(true);
    expect(isLicenseLockExemptPage("/dash")).toBe(false);
  });
});

describe("isLicenseLockedBody", () => {
  test("accepts the contract body and a FastAPI-wrapped one", () => {
    expect(isLicenseLockedBody({ error: "license_locked", reason: "expired" })).toBe(true);
    expect(isLicenseLockedBody({ detail: { error: "license_locked" } })).toBe(true);
    expect(isLicenseLockedBody({ detail: "license_locked" })).toBe(true);
  });

  test("ignores any other 423", () => {
    expect(isLicenseLockedBody(null)).toBe(false);
    expect(isLicenseLockedBody({ detail: "Locked" })).toBe(false);
    expect(isLicenseLockedBody("license_locked")).toBe(false);
  });
});

describe("licenseBannerItems", () => {
  test("nothing outside EE or without the admin status", () => {
    expect(licenseBannerItems(null)).toEqual([]);
    expect(licenseBannerItems({ mode: "saas", status: "unlicensed", notices: [{ code: "poc_ends", severity: "warning" }] })).toEqual([]);
    expect(licenseBannerItems({ mode: "ee", status: "inactive" })).toEqual([]);
  });

  test("maps severities, most severe first, and only info is dismissible", () => {
    const items = licenseBannerItems({
      mode: "ee",
      status: "active",
      notices: [
        { code: "poc_ends", severity: "info", ends_at: nowSec + 5 * DAY },
        { code: "payment_overdue", severity: "critical", ends_at: nowSec + 12 * DAY },
        { code: "seat_limit_exceeded", severity: "warning" },
      ],
    });
    expect(items.map((i) => [i.code, i.tone, i.dismissible])).toEqual([
      ["payment_overdue", "critical", false],
      ["seat_limit_exceeded", "warning", false],
      ["poc_ends", "neutral", true],
    ]);
  });

  test("grace adds its own bar and drops the duplicate local notice", () => {
    const items = licenseBannerItems({
      mode: "ee",
      status: "grace",
      grace_ends_at: nowSec + 3 * DAY,
      notices: [{ code: "offline_grace", severity: "warning", message: "Offline" }],
    });
    expect(items.map((i) => i.kind)).toEqual(["grace"]);
  });

  test("inactive shows a reason unless no key is configured", () => {
    expect(licenseBannerItems({ mode: "ee", status: "inactive", reason: "no_key", notices: [] })).toEqual([]);
    const [item] = licenseBannerItems({ mode: "ee", status: "inactive", reason: "expired", notices: [] });
    expect(item.kind).toBe("inactive");
    expect(item.tone).toBe("critical");
  });
});

describe("licenseBannerText", () => {
  const en = JSON.parse(readFileSync(join(import.meta.dir, "../locales/en.json"), "utf8"));
  const t = (key, opts = {}) => {
    const raw = key.split(".").reduce((o, k) => o?.[k], en);
    if (typeof raw !== "string") throw new Error(`missing ${key}`);
    return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k]));
  };
  const text = (status) => licenseBannerItems(status).map((i) => licenseBannerText(i, t, "en-US", NOW));

  test("POC countdown and overdue date read like the spec", () => {
    expect(text({ mode: "ee", status: "active", notices: [{ code: "poc_ends", severity: "warning", ends_at: nowSec + 5 * DAY }] })).toEqual(["POC ends in 5 days."]);
    expect(text({ mode: "ee", status: "active", notices: [{ code: "payment_overdue", severity: "critical", ends_at: Date.UTC(2026, 11, 3, 12) / 1000 }] })).toEqual([
      "Payment overdue — Enterprise features turn off on Dec 3.",
    ]);
  });

  test("grace and inactive", () => {
    const [grace] = text({ mode: "ee", status: "grace", grace_ends_at: Date.UTC(2026, 11, 1, 9) / 1000, notices: [] });
    expect(grace.startsWith("Can't reach the license server. Enterprise features stay on until Dec 1")).toBe(true);
    expect(text({ mode: "ee", status: "inactive", reason: "grace_expired:offline", notices: [] })).toEqual([
      "Enterprise features are off: the license server couldn't be reached for too long.",
    ]);
    expect(text({ mode: "ee", status: "inactive", reason: "weird", notices: [] })).toEqual(["Enterprise features are off: the license couldn't be verified."]);
  });

  test("unknown codes fall back to the server message", () => {
    expect(text({ mode: "ee", status: "active", notices: [{ code: "new_thing", severity: "info", message: "Hello" }] })).toEqual(["Hello"]);
  });

  test("relative time switches to hours under a day", () => {
    expect(relativeWhen(nowSec + 3 * 3600, "en-US", NOW)).toBe("in 3 hours");
    expect(relativeWhen(nowSec + DAY, "en-US", NOW)).toBe("tomorrow");
  });

  test("every reason has a phrase", () => {
    for (const r of KNOWN_REASONS) expect(() => t(reasonKey(r))).not.toThrow();
    expect(reasonKey("nope")).toBe("license.reason.unknown");
  });
});

test("every locale carries the same license keys as English", () => {
  const dir = join(import.meta.dir, "../locales");
  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  const enKeys = flat(JSON.parse(readFileSync(join(dir, "en.json"), "utf8")).license).sort();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const keys = flat(JSON.parse(readFileSync(join(dir, file), "utf8")).license ?? {}).sort();
    expect([file, keys]).toEqual([file, enKeys]);
  }
});
