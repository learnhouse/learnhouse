// After "Incorrect email or password" only ~3 in 10 people ever signed in. The
// notice offers the ways back in (reset password, login link) and tracks which
// one is used. It stays short: one translated line, one row of actions.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { AnalyticsEvent } from "../services/analytics/events.ts";

const src = readFileSync(new URL("../app/auth/login/login.tsx", import.meta.url), "utf8");
const keys = ["wrong_email_password", "login_failed_reset_password", "login_failed_email_link"];
const removed = ["login_failed_forgot", "login_failed_reset", "login_failed_magic", "login_failed_google_hint"];

describe("login recovery after a wrong password", () => {
  test("only for INVALID_CREDENTIALS, with tracked actions", () => {
    expect(src).toMatch(/errorType === 'INVALID_CREDENTIALS' && \(/);
    expect(src).toContain("LoginRecoveryClicked, { action: 'reset_password' }");
    expect(src).toContain("LoginRecoveryClicked, { action: 'magic_link' }");
    expect(AnalyticsEvent.LoginRecoveryClicked).toBe("login_recovery_clicked");
  });

  test("shows the translated message, not the API's English text", () => {
    expect(src).toContain("{errorType === 'INVALID_CREDENTIALS' ? t('auth.wrong_email_password') : error}");
  });

  test("the login link follows the org's allowed methods; no extra hints", () => {
    expect(src).toMatch(/\{magicLoginAllowed && \(\s*<>\s*\{' · '\}/);
    for (const k of removed) expect(src).not.toMatch(new RegExp(`auth\\.${k}['"]`));
  });

  test("every locale has the strings, and the old ones are gone", () => {
    const dir = new URL("../locales/", import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const auth = JSON.parse(readFileSync(new URL(file, dir), "utf8")).auth;
      for (const k of keys) expect(typeof auth[k], `${file} auth.${k}`).toBe("string");
      for (const k of removed) expect(auth[k], `${file} auth.${k}`).toBeUndefined();
    }
  });
});
