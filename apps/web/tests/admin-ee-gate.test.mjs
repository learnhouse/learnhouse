// Contract tests for the superadmin surface's EE gate.
//
// The failure direction here is the whole point. Blocking on anything other
// than a definitive 'oss' would show live SaaS superadmins a licence screen
// during an API blip — precisely when they need the dashboard. If someone
// later "hardens" this into a fail-closed check, these fail.

import { describe, expect, test } from "bun:test";

// `server-only` is a Next build-time alias rather than an installed package, so
// it has to be stubbed before importing any module that declares it.
import { mock } from "bun:test";
mock.module("server-only", () => ({}));

const { isSuperadminSurfaceBlocked } = await import("../lib/eeGate.ts");

describe("isSuperadminSurfaceBlocked", () => {
  test("blocks OSS", () => {
    expect(isSuperadminSurfaceBlocked("oss")).toBe(true);
  });

  test("never blocks SaaS", () => {
    expect(isSuperadminSurfaceBlocked("saas")).toBe(false);
  });

  test("never blocks self-hosted EE", () => {
    expect(isSuperadminSurfaceBlocked("ee")).toBe(false);
  });

  test("fails open when the mode is unknown", () => {
    // null means the instance/info lookup failed or timed out. Rendering the
    // dashboard is deliberate: the API-side check still denies every request,
    // so the worst case is empty panels rather than a locked-out operator.
    expect(isSuperadminSurfaceBlocked(null)).toBe(false);
  });
});
