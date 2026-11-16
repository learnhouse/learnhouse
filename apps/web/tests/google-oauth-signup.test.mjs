// Google sign-up from /signup silently did nothing after the authorize route
// started signing OAuth state: the signup pages still sent a pre-encoded string
// `state`, the route answered 400 and the error was dropped. Every entry point
// now builds its body with buildGoogleAuthorizeBody; these tests pin that body
// to what the route accepts. Synthetic values only.

import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

process.env.LEARNHOUSE_GOOGLE_CLIENT_ID = "client-id.test";
process.env.LEARNHOUSE_GOOGLE_CLIENT_SECRET = "client-secret.test";

let POST;
let buildGoogleAuthorizeBody;
beforeAll(async () => {
  ({ POST } = await import("../app/api/auth/google/authorize/route.ts"));
  ({ buildGoogleAuthorizeBody } = await import("../lib/auth/googleAuthorizeBody.ts"));
});

function authorize(body, origin = "https://learnhouse.test") {
  return POST(
    new NextRequest("https://learnhouse.test/api/auth/google/authorize", {
      method: "POST",
      headers: { "content-type": "application/json", origin, host: "learnhouse.test" },
      body: JSON.stringify(body),
    }),
  );
}

const redirectUri = "https://learnhouse.test/auth/callback/google";

describe("Google authorize request body", () => {
  test("the shared body is accepted and yields a Google URL with signed state", async () => {
    const res = await authorize(
      buildGoogleAuthorizeBody({ redirectUri, callbackUrl: "/redirect_from_auth", csrf: "nonce" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toStartWith("https://accounts.google.com/");
    expect(data.state.split(".")).toHaveLength(2);
  });

  test("returnOrigin is only sent when given", () => {
    const plain = buildGoogleAuthorizeBody({ redirectUri, callbackUrl: "/", csrf: "n", now: 1 });
    expect(plain).toEqual({ redirect_uri: redirectUri, state: { callbackUrl: "/", csrf: "n", timestamp: 1 } });
    const custom = buildGoogleAuthorizeBody({
      redirectUri, callbackUrl: "/", csrf: "n", now: 1, returnOrigin: "https://learn.acme.test",
    });
    expect(custom.returnOrigin).toBe("https://learn.acme.test");
  });

  test("the old pre-encoded string state is what the route rejects", async () => {
    const legacy = btoa(JSON.stringify({ callbackUrl: "/", csrf: "n", timestamp: Date.now() }));
    const res = await authorize({ redirect_uri: redirectUri, state: legacy });
    expect(res.status).toBe(400);
  });
});

describe("sign-in entry points", () => {
  const source = readFileSync(new URL("../components/Contexts/AuthContext.tsx", import.meta.url), "utf8");

  test("both signIn paths go through startGoogleOAuth", () => {
    expect(source.match(/return startGoogleOAuth\(/g)).toHaveLength(2);
    expect(source).not.toMatch(/btoa\(JSON\.stringify\(stateData\)\)/);
  });

  for (const page of ["OpenSignup", "InviteLinkSignup"]) {
    test(`${page} shows a failed Google start instead of dropping it`, () => {
      const src = readFileSync(new URL(`../app/auth/signup/${page}.tsx`, import.meta.url), "utf8");
      expect(src).toMatch(/signIn\('google'[\s\S]{0,200}\.then\(\(res\) => \{[\s\S]{0,120}!res\.ok/);
    });
  }
});
