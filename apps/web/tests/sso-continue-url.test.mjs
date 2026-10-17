import { describe, expect, test } from "bun:test";

import { SSOError, ssoContinueUrl } from "../services/auth/sso.ts";

const err = (continue_url, error_code = "continue_on_login_host") =>
  new SSOError({ error: error_code, error_code, error_description: "", continue_url });

describe("ssoContinueUrl", () => {
  test("follows an https callback URL on the login host", () => {
    const url = "https://learn.example.test/auth/sso/callback?code=c&state=s";
    expect(ssoContinueUrl(err(url), "https:")).toBe(url);
  });

  test("allows http only when the page itself is on http", () => {
    const url = "http://localhost:3000/auth/sso/callback?code=c&state=s";
    expect(ssoContinueUrl(err(url), "http:")).toBe(url);
    expect(ssoContinueUrl(err(url), "https:")).toBeNull();
  });

  test("refuses anything that isn't the SSO callback", () => {
    expect(ssoContinueUrl(err("https://evil.test/login"), "https:")).toBeNull();
    expect(ssoContinueUrl(err("javascript:alert(1)//auth/sso/callback"), "https:")).toBeNull();
    expect(ssoContinueUrl(err("https://u:p@learn.example.test/auth/sso/callback"), "https:")).toBeNull();
    expect(ssoContinueUrl(err("not a url"), "https:")).toBeNull();
  });

  test("ignores other errors and a missing URL", () => {
    const url = "https://learn.example.test/auth/sso/callback";
    expect(ssoContinueUrl(err(url, "invalid_state"), "https:")).toBeNull();
    expect(ssoContinueUrl(err(undefined), "https:")).toBeNull();
  });
});
