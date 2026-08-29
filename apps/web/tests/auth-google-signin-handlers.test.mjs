import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

/**
 * LEARNHOUSE-WEB-5Z ("TypeError: Failed to fetch") and -63 ("TypeError: Load
 * failed") both have culprit `/signup`. Their source was a Google button whose
 * click handler called `signIn('google', ...)` and threw the promise away: the
 * module-level `signIn` in components/Contexts/AuthContext.tsx awaits a fetch to
 * /api/auth/google/authorize before it redirects, so on a dead connection the
 * rejection escaped as an unhandled rejection AND the button sat there doing
 * nothing, with no error and no redirect.
 *
 * Three components have that button and two of them render the SAME route:
 * /signup renders OpenSignup for an open org and InviteOnlySignUp for an
 * invite-only one, so fixing only the first left the reported route still able
 * to produce the reported error. /login has the same dead-button shape (its
 * `signIn` comes from useAuth(), which catches internally and returns
 * `{ ok: false }`, so no rejection escapes there — but the result was still
 * discarded).
 *
 * These are source-shape assertions rather than render tests because apps/web's
 * bun suite has no DOM. They are written to fail on the exact regression that
 * matters: an un-awaited signIn, a handler that stops being async, or a
 * discarded result. Verified by reverting each file's handler to its previous
 * form and watching this file go red.
 */

const WEB_ROOT = path.resolve(import.meta.dirname, "..");

const HANDLER_FILES = [
  "app/auth/signup/OpenSignup.tsx",
  "app/auth/signup/InviteOnlySignUp.tsx",
  "app/auth/login/login.tsx",
];

const read = (rel) => fs.readFileSync(path.join(WEB_ROOT, rel), "utf8");

/** The body of `handleGoogleSignIn`, from its declaration to its closing `};`. */
function handlerBody(src, rel) {
  const start = src.indexOf("const handleGoogleSignIn");
  expect(start, `${rel} has no handleGoogleSignIn`).toBeGreaterThan(-1);
  const end = src.indexOf("\n  };", start);
  expect(end, `${rel}'s handleGoogleSignIn is not closed as expected`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("every Google sign-in handler awaits signIn and handles the result", () => {
  for (const rel of HANDLER_FILES) {
    describe(rel, () => {
      const src = read(rel);
      const body = handlerBody(src, rel);

      test("the handler is async", () => {
        expect(body).toMatch(/const handleGoogleSignIn\s*=\s*async\s*\(\s*\)\s*=>/);
      });

      test("every signIn('google') call in the file is awaited", () => {
        // The regression is a bare `signIn('google', { ... });` statement, which
        // is what all three files shipped. Any occurrence not immediately
        // preceded by `await ` is that bug coming back.
        const calls = [...src.matchAll(/signIn\(\s*'google'/g)];
        expect(calls.length).toBeGreaterThan(0);
        for (const m of calls) {
          expect(src.slice(Math.max(0, m.index - 6), m.index)).toBe("await ");
        }
      });

      test("a failed sign-in surfaces an error and re-enables the button", () => {
        // Discarding the result is the dead-button half of the bug: signIn
        // resolves `{ ok: false }` when Google OAuth is not configured, or (in
        // login.tsx) when the transport failed.
        expect(body).toMatch(/result\s*&&\s*result\.ok === false/);
        expect(body).toMatch(/setError\(/);
        // Once on the failure branch, once in the catch.
        expect([...body.matchAll(/setIsSubmitting\(false\)/g)].length).toBeGreaterThanOrEqual(2);
      });

      test("the awaited call is wrapped in try/catch", () => {
        const awaitAt = body.indexOf("await signIn(");
        expect(awaitAt).toBeGreaterThan(-1);
        // The nearest `try {` BEFORE the await, and a `} catch` after it. The
        // handlers also open a small try/catch around the analytics call, so
        // the search has to be anchored on the await, not on the first `try`.
        const tryAt = body.lastIndexOf("try {", awaitAt);
        const catchAt = body.indexOf("} catch", awaitAt);
        expect(tryAt).toBeGreaterThan(-1);
        expect(catchAt).toBeGreaterThan(awaitAt);
      });

      test("the button is only left disabled on a path that actually navigates", () => {
        // The handler disables the form before `await signIn(...)` and clears
        // it on the failure branches only, so every non-navigating outcome MUST
        // come back as `{ ok: false }`. See the AuthContext describe below for
        // the other half of that contract — without it this is a page lockout,
        // not a dead button.
        const awaitAt = body.indexOf("await signIn(");
        const after = body.slice(awaitAt);
        expect(after).toMatch(/setIsSubmitting\(false\)/);
        expect(body).not.toMatch(/setIsSubmitting\(true\)[\s\S]*setIsSubmitting\(true\)/);
      });

      test("analytics is not 'guarded' by a promise wrapper that cannot catch it", () => {
        // `track` from useLHAnalytics is a synchronous useCallback returning
        // void. `Promise.resolve(track(...)).catch(...)` attaches the handler
        // AFTER the argument has already thrown, so in an async handler it
        // manufactures the unhandled rejection it looks like it prevents.
        expect(body).not.toContain("Promise.resolve(track(");
      });
    });
  }
});

/**
 * The other half of that contract. Each handler above calls
 * setIsSubmitting(true) before awaiting signIn and clears it only on the
 * failure branches, so a resolved `undefined` is read as "the document is
 * navigating away". That is only true if signIn returns an explicit failure on
 * every path that does NOT navigate.
 *
 * The path that used to break it: the server hands back an authorize URL,
 * safeExternalUrl() rejects it, and signIn fell through to a bare `return`.
 * Nothing navigated, the caller saw `undefined`, and isSubmitting stayed true
 * forever — which on /login also disables the password submit and the
 * magic-link button, and on the invite signup the account form. A dead Google
 * button would have become a dead page.
 */
describe("AuthContext signIn never resolves like a redirect without redirecting", () => {
  const src = read("components/Contexts/AuthContext.tsx");
  const sites = [...src.matchAll(/const safeGoogleUrl = safeExternalUrl\(googleAuthUrl\)/g)];

  test("both signIn implementations guard the rejected URL", () => {
    // One in the context provider's signIn, one in the exported module-level
    // signIn. Fixing only one leaves half the callers stranded.
    expect(sites.length).toBe(2);
    for (const site of sites) {
      const after = src.slice(site.index, site.index + 900);
      const guardAt = after.indexOf("if (!safeGoogleUrl)");
      expect(guardAt).toBeGreaterThan(-1);
      // The guard must RETURN a failure, not just log and fall through.
      expect(after.slice(guardAt)).toMatch(/return \{[\s\S]{0,200}ok: false/);
    }
  });

  test("the silent-fallthrough form is gone", () => {
    // `if (safeGoogleUrl) window.location.href = safeGoogleUrl` followed by a
    // bare `return` is the exact regression.
    expect(src).not.toMatch(/if \(safeGoogleUrl\)\s*window\.location\.href/);
  });
});
