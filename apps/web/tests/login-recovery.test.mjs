// After "Incorrect email or password" only ~3 in 10 people ever signed in. The
// notice now offers the ways back in (reset, login link, Google hint) and
// tracks which one is used.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { AnalyticsEvent } from "../services/analytics/events.ts";

const src = readFileSync(new URL("../app/auth/login/login.tsx", import.meta.url), "utf8");
const keys = ["login_failed_forgot", "login_failed_reset", "login_failed_magic", "login_failed_google_hint"];

describe("login recovery after a wrong password", () => {
  test("only for INVALID_CREDENTIALS, with tracked actions", () => {
    expect(src).toMatch(/errorType === 'INVALID_CREDENTIALS' && \(/);
    expect(src).toContain("LoginRecoveryClicked, { action: 'reset_password' }");
    expect(src).toContain("LoginRecoveryClicked, { action: 'magic_link' }");
    expect(AnalyticsEvent.LoginRecoveryClicked).toBe("login_recovery_clicked");
  });

  test("magic link and Google hint follow the org's allowed methods", () => {
    expect(src).toMatch(/\{magicLoginAllowed && \(\s*<>\s*\{' · '\}/);
    expect(src).toMatch(/\{googleAllowed && \(\s*<span className="mt-1 block opacity-80">/);
  });

  test("every locale has the strings", () => {
    const dir = new URL("../locales/", import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const auth = JSON.parse(readFileSync(new URL(file, dir), "utf8")).auth;
      for (const k of keys) expect(typeof auth[k], `${file} auth.${k}`).toBe("string");
    }
  });
});
