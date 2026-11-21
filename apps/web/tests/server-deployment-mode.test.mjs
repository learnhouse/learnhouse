// The deployment mode drives plan/mode branches in client components that are
// also rendered on the server. Server renders have no document.cookie, so the
// root layout records the instance mode for the process; without it the server
// always rendered 'oss' and the browser re-rendered with the real mode (React
// hydration error #418 on the sign-in pages).

import { describe, expect, test } from "bun:test";

const { getDeploymentMode, setServerDeploymentMode } = await import("../services/config/config.ts");

describe("getDeploymentMode on the server", () => {
  test("falls back to oss before the layout records a mode", () => {
    delete globalThis.__LH_SERVER_DEPLOYMENT_MODE__;
    expect(getDeploymentMode()).toBe("oss");
  });

  test("returns the mode the root layout recorded", () => {
    setServerDeploymentMode("ee");
    expect(getDeploymentMode()).toBe("ee");
    setServerDeploymentMode("saas");
    expect(getDeploymentMode()).toBe("saas");
  });

  test("ignores anything that is not a known mode", () => {
    globalThis.__LH_SERVER_DEPLOYMENT_MODE__ = "enterprise";
    expect(getDeploymentMode()).toBe("oss");
    delete globalThis.__LH_SERVER_DEPLOYMENT_MODE__;
  });
});

describe("getDeploymentMode in the browser", () => {
  const fakeDocument = (htmlMode, cookie) => ({
    documentElement: { getAttribute: (name) => (name === "data-lh-mode" ? htmlMode : null) },
    cookie,
  });
  const withBrowser = (doc, fn) => {
    globalThis.window = {};
    globalThis.document = doc;
    try {
      fn();
    } finally {
      delete globalThis.window;
      delete globalThis.document;
    }
  };

  test("uses the mode the server wrote on <html>, even with cookies blocked", () => {
    withBrowser(fakeDocument("ee", ""), () => expect(getDeploymentMode()).toBe("ee"));
  });

  test("the <html> value wins over a different cookie", () => {
    withBrowser(fakeDocument("saas", "LH_mode=oss"), () => expect(getDeploymentMode()).toBe("saas"));
  });

  test("falls back to the LH_mode cookie, then oss", () => {
    withBrowser(fakeDocument(null, "LH_mode=ee"), () => expect(getDeploymentMode()).toBe("ee"));
    withBrowser(fakeDocument("bogus", "LH_mode=nope"), () => expect(getDeploymentMode()).toBe("oss"));
    withBrowser(fakeDocument(null, ""), () => expect(getDeploymentMode()).toBe("oss"));
  });
});
