// Accepting an invitation used to end on "You need an invite to join this
// organization" (Google lost the invitation), on "This invitation link has
// expired" right after joining, or on the wrong host. These pin the pieces
// that carry the invitation through sign-in. Synthetic tokens and hosts only.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import {
  OAUTH_CONTEXT_COOKIES,
  oauthContextCookieWrites,
  oauthCookieClears,
  readOAuthContextCookies,
} from "../lib/auth/oauthCookies.ts";
import {
  callbackHomeHref,
  callbackRetryHref,
  callbackTargets,
  callbackUrlToOrgRoot,
  isInviteEmailMismatch,
  mfaLoginHref,
} from "../lib/auth/oauthCallback.ts";
import {
  acceptedInvitePhase,
  inviteTokenFrom,
  invitePeekOutcome,
  isMalformedInviteParam,
  isMemberLimitError,
  isOrgMember,
} from "../lib/auth/signup.ts";
import { isInviteSignupPath, signupHrefFor } from "../lib/auth/nextParam.ts";
import { getErrorMessage } from "../services/utils/ts/errorMessage.ts";
import { copyTextFrom } from "../lib/text/clipboard.ts";

const TOKEN = "a".repeat(20) + "B_-c".repeat(6);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("OAuth context cookies", () => {
  const subdomain = { secure: true, domain: "learnhouse.test" };
  const custom = { secure: true, domain: null };

  test("every sign-in clears all four cookies, host-only and domain-wide", () => {
    const clears = oauthCookieClears(subdomain);
    for (const name of OAUTH_CONTEXT_COOKIES) {
      expect(clears).toContain(`${name}=; path=/; max-age=0`);
      expect(clears).toContain(`${name}=; path=/; max-age=0; domain=.learnhouse.test`);
    }
    expect(OAUTH_CONTEXT_COOKIES).toContain("LH_oauth_invite_token");
    expect(oauthCookieClears(custom).some((c) => c.includes("domain="))).toBe(false);
  });

  test("no org sets nothing, so a stale org from another tab can't ride along", () => {
    const writes = oauthContextCookieWrites({}, subdomain);
    expect(writes).toEqual(oauthCookieClears(subdomain));
  });

  test("clears come first, then the org and the invitation token", () => {
    const writes = oauthContextCookieWrites({ orgSlug: "acme", orgId: 7, inviteToken: TOKEN }, subdomain);
    const firstSet = writes.findIndex((c) => !c.includes("max-age=0"));
    expect(writes.slice(firstSet).every((c) => !c.includes("max-age=0"))).toBe(true);
    expect(writes).toContain("LH_oauth_orgslug=acme; path=/; SameSite=Lax; secure; domain=.learnhouse.test");
    expect(writes).toContain("LH_oauth_org_id=7; path=/; SameSite=Lax; secure; domain=.learnhouse.test");
    expect(writes).toContain(`LH_oauth_invite_token=${TOKEN}; path=/; SameSite=Lax; secure; domain=.learnhouse.test`);
    expect(writes.some((c) => c.startsWith("LH_oauth_invite_code=") && !c.includes("max-age=0"))).toBe(false);
  });

  test("host-only on custom domains", () => {
    const writes = oauthContextCookieWrites({ orgSlug: "acme", orgId: 7, inviteCode: "c o/de" }, custom);
    expect(writes).toContain("LH_oauth_invite_code=c%20o%2Fde; path=/; SameSite=Lax; secure");
  });

  test("the callback reads them back", () => {
    const jar = `other=1; LH_oauth_org_id=7; LH_oauth_orgslug=acme; LH_oauth_invite_code=c%20o%2Fde; LH_oauth_invite_token=${TOKEN}`;
    expect(readOAuthContextCookies(jar)).toEqual({ orgId: 7, orgSlug: "acme", inviteCode: "c o/de", inviteToken: TOKEN });
    expect(readOAuthContextCookies("LH_oauth_org_id=x; LH_oauth_invite_token=")).toEqual({});
    expect(readOAuthContextCookies("")).toEqual({});
  });
});

describe("Google callback destinations", () => {
  const platform = "learnhouse.test";
  const main = "https://learnhouse.test";
  const invite = `/signup?invite=${TOKEN}`;
  const cb = (origin, next) => `${origin}/redirect_from_auth?next=${encodeURIComponent(next)}`;

  test("error buttons go to the org's own site and back to the invitation", () => {
    const targets = callbackTargets(cb("https://acme.learnhouse.test", invite), main, platform);
    expect(targets).toEqual({ origin: "https://acme.learnhouse.test", next: invite });
    expect(callbackRetryHref(targets)).toBe(`https://acme.learnhouse.test${invite}`);
    expect(callbackHomeHref(targets)).toBe("https://acme.learnhouse.test/");
  });

  test("a plain sign-in retries on the sign-in page, keeping next", () => {
    const targets = callbackTargets(cb("https://acme.learnhouse.test", "/course/x"), main, platform);
    expect(callbackRetryHref(targets)).toBe("https://acme.learnhouse.test/login?next=%2Fcourse%2Fx");
  });

  test("custom domains only through the signed return origin", () => {
    const url = cb("https://learn.acme.example", invite);
    expect(callbackTargets(url, main, platform).origin).toBe(main);
    expect(callbackTargets(url, main, platform, "https://learn.acme.example").origin).toBe("https://learn.acme.example");
    expect(callbackTargets(url, "https://learn.acme.example", platform).origin).toBe("https://learn.acme.example");
  });

  test("unknown hosts, bad schemes and unsafe next fall back to this page", () => {
    expect(callbackTargets(cb("https://evil.example", invite), main, platform)).toEqual({ origin: main, next: null });
    expect(callbackTargets("javascript:alert(1)", main, platform)).toEqual({ origin: main, next: null });
    expect(callbackTargets(cb("https://acme.learnhouse.test", "//evil.example"), main, platform).next).toBeNull();
    expect(callbackTargets(null, main, platform)).toEqual({ origin: main, next: null });
    expect(callbackRetryHref({ origin: main, next: null })).toBe(`${main}/login`);
  });

  test("Google + 2FA hands off to the org's /login with next", () => {
    const targets = callbackTargets(cb("https://acme.learnhouse.test", invite), main, platform);
    const href = new URL(mfaLoginHref(targets, "mfa-123"));
    expect(href.origin + href.pathname).toBe("https://acme.learnhouse.test/login");
    expect(href.searchParams.get("mfa_token")).toBe("mfa-123");
    expect(href.searchParams.get("next")).toBe(invite);
  });

  test("an accepted invitation lands on the org root, not the used link", () => {
    const out = new URL(callbackUrlToOrgRoot(cb("https://acme.learnhouse.test", invite), main));
    expect(out.origin + out.pathname).toBe("https://acme.learnhouse.test/redirect_from_auth");
    expect(out.searchParams.get("next")).toBe("/");
    expect(callbackUrlToOrgRoot("/home", main)).toBe(`${main}/redirect_from_auth?next=%2F`);
  });

  test("INVITE_EMAIL_MISMATCH gets its own message with the masked address", () => {
    const detail = { code: "INVITE_EMAIL_MISMATCH", message: "server text", invited_email_hint: "b***@example.com" };
    expect(isInviteEmailMismatch(detail)).toBe(true);
    expect(isInviteEmailMismatch("You need an invite to join this organization")).toBe(false);
    const t = (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k);
    expect(getErrorMessage(detail, "fallback", t)).toBe('auth.errors.invite_email_mismatch_hint:{"email":"b***@example.com"}');
    expect(getErrorMessage({ code: "INVITE_EMAIL_MISMATCH" }, "fallback", t)).toBe("auth.errors.invite_email_mismatch");
    // INVITE_REQUIRED as a string or as an object.
    expect(getErrorMessage("You need an invite to join this organization", "fallback", t)).toBe("auth.errors.invite_required");
    expect(getErrorMessage({ code: "INVITE_REQUIRED", message: "x" }, "fallback", t)).toBe("auth.errors.invite_required");
    expect(getErrorMessage({ code: "INVITE_VERIFY_EMAIL", message: "x" }, "fallback", t)).toBe("auth.errors.invite_verify_email");
  });
});

describe("invitation page", () => {
  test("only a refusal shows the link as gone; anything else offers a retry", () => {
    expect(invitePeekOutcome({ ok: true, data: { status: "pending" } })).toBe("pending");
    expect(invitePeekOutcome({ ok: true, data: {} })).toBe("pending");
    expect(invitePeekOutcome({ ok: true, data: { status: "accepted" } })).toBe("accepted");
    expect(invitePeekOutcome({ ok: false, status: 404 })).toBe("invalid");
    expect(invitePeekOutcome({ ok: false, status: 422 })).toBe("invalid");
    for (const status of [0, 408, 429, 500, 502, 503]) expect(invitePeekOutcome({ ok: false, status })).toBe("retry");
  });

  test("an accepted link sends only a member on to the org", () => {
    const roles = [{ org: { id: 7 } }];
    expect(acceptedInvitePhase(true, roles, 7)).toBe("to_org");
    // Removed since, or signed in as someone else: the link was used.
    expect(acceptedInvitePhase(true, [], 7)).toBe("invalid");
    expect(acceptedInvitePhase(true, [{ org: { id: 8 } }], 7)).toBe("invalid");
    expect(acceptedInvitePhase(true, undefined, 7)).toBe("invalid");
    expect(acceptedInvitePhase(false, roles, 7)).toBe("accepted");
  });

  test("a token pasted from chat loses its trailing punctuation", () => {
    for (const v of [`${TOKEN}.`, `${TOKEN}),`, `(${TOKEN})`, `"${TOKEN}"`, `<${TOKEN}>`, ` ${TOKEN}! `]) {
      expect(inviteTokenFrom(v)).toBe(TOKEN);
    }
    // `-` and `_` are token characters, never trimmed.
    expect(inviteTokenFrom(`${TOKEN}-`)).toBe(`${TOKEN}-`);
  });

  test("still malformed means the broken-link screen, not the invite-code one", () => {
    expect(isMalformedInviteParam(`${TOKEN}.`)).toBe(false);
    expect(isMalformedInviteParam("short")).toBe(true);
    expect(isMalformedInviteParam(`${TOKEN}<script>`)).toBe(true);
    // Present but blank (`?invite=%20%20`) is a broken link too.
    expect(isMalformedInviteParam("")).toBe(true);
    expect(isMalformedInviteParam("  ")).toBe(true);
    expect(isMalformedInviteParam(null)).toBe(false);
  });

  test("membership from the session roles", () => {
    expect(isOrgMember([{ org: { id: 7 } }], 7)).toBe(true);
    expect(isOrgMember([{ org: { id: 8 } }], 7)).toBe(false);
    expect(isOrgMember(undefined, 7)).toBe(false);
    expect(isOrgMember([{ org: { id: 7 } }], undefined)).toBe(false);
  });

  test("sign-up from sign-in links an invitation page directly", () => {
    const invite = `/signup?invite=${TOKEN}`;
    expect(isInviteSignupPath(invite)).toBe(true);
    expect(isInviteSignupPath("/signup?inviteCode=abc")).toBe(false);
    expect(isInviteSignupPath("/course/x")).toBe(false);
    expect(signupHrefFor(invite)).toBe(invite);
    expect(signupHrefFor("/course/x")).toBe("/signup?next=%2Fcourse%2Fx");
    expect(signupHrefFor(null)).toBe("/signup");
  });
});

describe("copy link", () => {
  test("a link still being fetched is written inside the click, as a promised item", async () => {
    const calls = [];
    class Item {
      constructor(data) {
        this.data = data;
      }
    }
    const clipboard = {
      write: async (items) => {
        calls.push("write");
        const blob = await items[0].data["text/plain"];
        calls.push(await blob.text());
      },
      writeText: async () => calls.push("writeText"),
    };
    let resolve;
    const url = new Promise((r) => (resolve = r));
    const done = copyTextFrom(url, clipboard, Item);
    expect(calls).toEqual(["write"]); // started before the link came back
    resolve("https://acme.test/signup?invite=x");
    expect(await done).toBe(true);
    expect(calls).toEqual(["write", "https://acme.test/signup?invite=x"]);
  });

  test("falls back to writeText, and reports failure instead of 'Copied'", async () => {
    const texts = [];
    const ok = await copyTextFrom(Promise.resolve("x"), { writeText: async (t) => texts.push(t) }, undefined);
    expect(ok).toBe(true);
    expect(texts).toEqual(["x"]);
    const refused = { writeText: async () => Promise.reject(new Error("denied")) };
    expect(await copyTextFrom("x", refused)).toBe(false);
    expect(await copyTextFrom(Promise.reject(new Error("network")), refused, undefined)).toBe(false);
    expect(await copyTextFrom("x", undefined)).toBe(false);
  });
});

describe("invitee errors", () => {
  test("a full org gets invitee wording, whatever the MEMBER_LIMIT variant", () => {
    expect(isMemberLimitError({ code: "MEMBER_LIMIT_REACHED" })).toBe(true);
    expect(isMemberLimitError({ code: "MEMBER_LIMIT_REACHED_INVITEE" })).toBe(true);
    expect(isMemberLimitError({ code: "ADMIN_SEAT_LIMIT_REACHED" })).toBe(false);
    expect(isMemberLimitError("Usage Limit has been reached for Members")).toBe(false);
    for (const p of ["../app/auth/signup/InviteLinkSignup.tsx", "../app/auth/callback/google/page.tsx"]) {
      expect(read(p)).toContain("t('auth.invite_link.org_full')");
    }
  });

  test("the plain-string invite-only refusal is translated", () => {
    const t = (k) => `T:${k}`;
    expect(getErrorMessage("You need an invite to join this organization", "x", t)).toBe("T:auth.errors.invite_required");
    expect(getErrorMessage("You need an invite to join this organization", "x")).toBe("You need an invite to join this organization");
  });
});

describe("call sites", () => {
  test("invite-only signup offers the invited-by-email path (form + Google)", () => {
    const src = read("../app/auth/signup/signup.tsx");
    expect(src).toContain("t('auth.invited_by_email_cta')");
    expect(src).toContain("<OpenSignUpComponent org={activeOrg} />");
    expect(read("../app/auth/signup/OpenSignup.tsx")).toContain("!message.invitation_pending");
  });

  test("set-password after verifying keeps the address and landing", () => {
    const src = read("../app/auth/verify-email/verify-email.tsx");
    expect(src).toContain("withNextParam('/forgot', landing)");
    expect(src).toContain("setLoginHint(verifiedEmail)");
    expect(read("../app/auth/forgot/forgot.tsx")).toContain("takeLoginHint()");
  });

  test("password reset sends next and lands on the returned one", () => {
    expect(read("../services/auth/auth.ts")).toContain("RequestBody('POST', { email, ...(next ? { next } : {}) }, null)");
    expect(read("../app/auth/forgot/forgot.tsx")).toContain("sendResetLink(values.email, next)");
    expect(read("../app/auth/reset/reset.tsx")).toContain("isSafeNextPath(data.next)");
  });

  test("an upgrade invitation for a member says Accept", () => {
    const src = read("../components/Onboarding/PendingInvites.tsx");
    expect(src).toContain("inv.already_member ? t('onb2.invites.accept') : t('onb2.invites.join')");
    expect(src).toContain("t('onb2.invites.new_role'");
  });

  test("Google from the invitation carries the token, and the callback sends it", () => {
    expect(read("../app/auth/signup/InviteLinkSignup.tsx")).toContain("inviteToken: token");
    const callback = read("../app/auth/callback/google/page.tsx");
    expect(callback).toContain("oauthParams.set('invite_token', inviteToken)");
    expect(callback).not.toContain("/auth/login?");
    expect(callback).not.toMatch(/href="\/(login)?"/);
  });

  test("Google entry points go through the cookie helper (which clears first)", () => {
    for (const p of ["../app/auth/login/login.tsx", "../app/auth/signup/OpenSignup.tsx", "../app/auth/signup/InviteLinkSignup.tsx"]) {
      const src = read(p);
      expect(src).toContain("setOAuthContextCookies(");
      expect(src).not.toContain("document.cookie = `LH_oauth_");
    }
  });

  test("magic link and password reset keep the invitation", () => {
    const login = read("../app/auth/login/login.tsx");
    expect(login).toContain("requestMagicLink(email, props.org?.slug, next)");
    expect(login).not.toContain('href="/forgot"');
    expect(read("../app/auth/forgot/forgot.tsx")).toContain("rememberPostAuthNext(next)");
    expect(read("../app/auth/reset/reset.tsx")).not.toContain('href="/login"');
  });

  test("an invite code on an open org reaches the signup form", () => {
    expect(read("../app/auth/signup/signup.tsx")).toContain("<OpenSignUpComponent org={props.org} inviteCode={inviteCode || undefined} />");
  });

  test("the invitation's org (not the host's) picks the form and the OAuth org", () => {
    const src = read("../app/auth/signup/InviteLinkSignup.tsx");
    expect(src).toContain("getAllowedAuthMethods(inviteOrg)");
    expect(src).toContain("readSignupFields(inviteOrg)");
    expect(src).toContain("orgId: info?.org.id || org?.id");
    expect(src).toContain("org.id === inviteOrgId");
  });

  test("copied-link signup comes back to the invitation after verifying", () => {
    const src = read("../app/auth/signup/InviteLinkSignup.tsx");
    expect(src.indexOf("rememberPostAuthNext(backHere)")).toBeLessThan(src.indexOf("await signupWithInviteLink("));
  });
});

describe("i18n", () => {
  const keys = [
    "errors.invite_required",
    "errors.invite_email_mismatch",
    "errors.invite_email_mismatch_hint",
    "errors.invite_verify_email",
    "google_callback.invite_mismatch_title",
    "google_callback.use_another_account",
    "invite_link.accepted_title",
    "invite_link.accepted_desc",
    "invite_link.retry_title",
    "invite_link.retry_desc",
    "invite_link.try_again",
    "invite_link.verify_desc",
    "invite_link.org_full",
    "invited_by_email_cta",
    "use_invite_code_instead",
    "password_reset_done",
  ];

  test("every locale has the strings", () => {
    const dir = new URL("../locales/", import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const auth = JSON.parse(readFileSync(new URL(file, dir), "utf8")).auth;
      for (const k of keys) {
        const [sec, key] = k.split(".");
        const value = key ? auth[sec]?.[key] : auth[sec];
        expect(typeof value, `${file} auth.${k}`).toBe("string");
      }
      const invites = JSON.parse(readFileSync(new URL(file, dir), "utf8")).onb2.invites;
      expect(typeof invites.accept, `${file} onb2.invites.accept`).toBe("string");
      expect(invites.new_role, file).toContain("{{role}}");
      expect(auth.errors.invite_email_mismatch_hint, file).toContain("{{email}}");
      expect(auth.invite_link.accepted_desc, file).toContain("{{org}}");
    }
  });

  test("the verify note no longer sends people to the home page", () => {
    const en = JSON.parse(read("../locales/en.json")).auth.invite_link.verify_desc;
    expect(en).not.toMatch(/home page/i);
  });
});
