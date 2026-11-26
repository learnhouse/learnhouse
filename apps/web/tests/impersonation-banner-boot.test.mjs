import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

// The banner mounted on an org page (no impersonation) must never send the tab
// to the console because of an "ended" signal: only a tab the server confirmed
// was impersonating may go back.

const win = new Window({ url: "https://acme.example.com/" });
globalThis.window = win;
globalThis.document = win.document;
globalThis.navigator = win.navigator;
globalThis.CustomEvent = win.CustomEvent;
globalThis.HTMLElement = win.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let sessionValue = { data: null, status: "unauthenticated" };
mock.module("@components/Contexts/LHSessionContext", () => ({ useLHSession: () => sessionValue }));

const fetchCalls = [];
const assigned = [];

let React, act, createRoot, Banner, imp;
beforeAll(async () => {
  React = (await import("react")).default;
  ({ act } = await import("react"));
  ({ createRoot } = await import("react-dom/client"));
  Banner = (await import("../components/Impersonation/ImpersonationBanner.tsx")).default;
  imp = await import("../lib/auth/impersonation.ts");
  globalThis.fetch = async (url, init) => {
    fetchCalls.push(`${init?.method || "GET"} ${url}`);
    return new Response(JSON.stringify({ ended: true, return_url: null }), { status: 200 });
  };
  win.location.assign = (url) => assigned.push(String(url));
});

afterEach(() => {
  imp.resetImpersonationTabState();
  fetchCalls.length = 0;
  assigned.length = 0;
  sessionValue = { data: null, status: "unauthenticated" };
});

async function mountBanner() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(React.createElement(Banner)));
  return root;
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe("impersonation banner on a page that never impersonated", () => {
  test("an ended event at boot does not leave the page", async () => {
    const root = await mountBanner();
    await act(async () => imp.dispatchImpersonationEnded("ended"));
    await flush();
    expect(fetchCalls).toEqual([]);
    expect(assigned).toEqual([]);
    await act(async () => root.unmount());
  });

  test("an end announced before the banner mounted is ignored too", async () => {
    imp.dispatchImpersonationEnded("ended");
    const root = await mountBanner();
    await flush();
    expect(fetchCalls).toEqual([]);
    expect(assigned).toEqual([]);
    await act(async () => root.unmount());
  });

  test("a tab the server confirmed was impersonating still goes back", async () => {
    imp.setActiveImpersonation({ session_uuid: "imp_1", return_url: "/backoffice/organizations/1", scope: "platform" });
    const root = await mountBanner();
    await act(async () => imp.dispatchImpersonationEnded("ended"));
    await flush();
    expect(fetchCalls).toContain("DELETE /api/auth/impersonation");
    expect(assigned.length).toBe(1);
    expect(assigned[0]).toContain("impersonation=ended");
    await act(async () => root.unmount());
  });
});

describe("token refresh 410", () => {
  const res = (status, body = {}) => new Response(JSON.stringify(body), { status });

  test("never read from the HTTP cache", async () => {
    const seen = [];
    await imp.fetchAuthRefresh(async (url, init) => { seen.push(init); return res(200, { access_token: "t" }); });
    expect(seen[0].cache).toBe("no-store");
    expect(seen[0].credentials).toBe("include");
  });

  test("a tab that never impersonated asks again and stays signed in", async () => {
    const replies = [res(410, { code: "impersonation_ended" }), res(200, { access_token: "t" })];
    let calls = 0;
    const out = await imp.fetchAuthRefresh(async () => { calls++; return replies.shift(); }, { "X-Test": "1" });
    expect(calls).toBe(2);
    expect(out.status).toBe(200);
    const events = [];
    window.addEventListener(imp.IMPERSONATION_ENDED_EVENT, (e) => events.push(e.detail.reason));
    imp.impersonationRefreshGone({ code: "impersonation_ended" });
    expect(events).toEqual([]);
  });

  test("an impersonating tab takes the 410 as the end", async () => {
    imp.setActiveImpersonation({ session_uuid: "imp_1" });
    let calls = 0;
    const out = await imp.fetchAuthRefresh(async () => { calls++; return res(410, { reason: "revoked" }); });
    expect(calls).toBe(1);
    expect(out.status).toBe(410);
    const events = [];
    window.addEventListener(imp.IMPERSONATION_ENDED_EVENT, (e) => events.push(e.detail.reason));
    imp.impersonationRefreshGone({ code: "impersonation_ended", reason: "revoked" });
    expect(events).toEqual(["revoked"]);
  });
});

describe("auth replies are never cached", () => {
  test("noStore marks a reply", async () => {
    const { noStore } = await import("../lib/auth/noStore.ts");
    const res = noStore(new Response("{}", { status: 410 }));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("the auth proxy and the impersonation status mark every reply", async () => {
    const { readFileSync } = await import("node:fs");
    const proxy = readFileSync(new URL("../app/api/auth/[...path]/route.ts", import.meta.url), "utf8");
    for (const verb of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      expect(proxy).toContain(`return noStore(await proxyRequest(request, '${verb}'))`);
    }
    const status = readFileSync(new URL("../app/api/auth/impersonation/route.ts", import.meta.url), "utf8");
    expect(status).toContain("return noStore(await impersonationStatus(request))");
  });
});
