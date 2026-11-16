import { beforeEach, describe, expect, mock, test } from "bun:test";

// The runtime's DOM touch points, enough for it to run headless
globalThis.document ??= {
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  visibilityState: "visible",
  documentElement: { style: {} },
};
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

// A provider whose server events the test fires by hand
const providers = [];
class FakeAwareness {
  constructor() {
    this.state = {};
  }
  setLocalStateField(k, v) {
    this.state = { ...this.state, [k]: v };
  }
  setLocalState(s) {
    this.state = s;
  }
  getLocalState() {
    return this.state;
  }
  getStates() {
    return new Map();
  }
  on() {}
  off() {}
}
class FakeProvider {
  constructor(config) {
    this.config = config;
    this.awareness = new FakeAwareness();
    this.destroyed = false;
    this.disconnected = false;
    providers.push(this);
  }
  disconnect() {
    this.disconnected = true;
  }
  destroy() {
    this.destroyed = true;
  }
  sendStateless() {}
}
mock.module("@hocuspocus/provider", () => ({ HocuspocusProvider: FakeProvider }));
mock.module("@services/media/media", () => ({ getUserAvatarMediaDirectory: () => "" }));

const { startCollabSession } = await import("../components/Objects/Editor/Collab/collabRuntime.ts");

const start = (extra = {}) =>
  startCollabSession({
    url: "ws://collab.invalid",
    activityUuid: "activity_x",
    user: { id: 1, name: "Ada", color: "#112233", avatar: null, uuid: null },
    getToken: async () => "t",
    syncTimeoutMs: 50,
    ...extra,
  });
const settle = (p) =>
  p.then(
    () => ({ ok: true }),
    (err) => ({ ok: false, kind: err.kind, name: err.name, message: err.message }),
  );

beforeEach(() => {
  providers.length = 0;
});

describe("collab runtime failure states", () => {
  test("refused by the room: rejects 'refused' and cleans up", async () => {
    const { ready } = start();
    providers[0].config.onAuthenticationFailed({ reason: "access-refused" });
    expect(await settle(ready)).toEqual({
      ok: false,
      kind: "refused",
      name: "CollabStartError",
      message: "authentication failed: access-refused",
    });
    expect(providers[0].destroyed).toBe(true);
  });

  test("auth service unavailable: rejects 'unavailable' (worth a retry)", async () => {
    const { ready } = start();
    providers[0].config.onAuthenticationFailed({ reason: "auth-unavailable" });
    const result = await settle(ready);
    expect(result.kind).toBe("unavailable");
    expect(providers[0].destroyed).toBe(true);
  });

  test("no sync in time: rejects 'unavailable' instead of waiting forever", async () => {
    const { ready } = start();
    const result = await settle(ready);
    expect(result.kind).toBe("unavailable");
    expect(result.message).toBe("sync timed out");
    expect(providers[0].destroyed).toBe(true);
  });

  test("closed for good before the first sync: settles too", async () => {
    const revoked = start();
    providers[0].config.onClose({ event: { code: 4403, reason: "Access revoked" } });
    expect((await settle(revoked.ready)).kind).toBe("refused");
    expect(revoked.session.getSnapshot().terminal).toBe("access_revoked");

    const off = start();
    providers[1].config.onClose({ event: { code: 4409, reason: "Live editing disabled" } });
    expect((await settle(off.ready)).kind).toBe("disabled");

    // An ordinary close (server restart) is not final: the provider reconnects
    const blip = start({ syncTimeoutMs: 10_000 });
    providers[2].config.onClose({ event: { code: 1006, reason: "" } });
    providers[2].config.onSynced({ state: true });
    expect(await settle(blip.ready)).toEqual({ ok: true });
    blip.session.destroy();
  });

  test("synced: resolves, and the timeout never fires afterwards", async () => {
    const { ready, session } = start({ syncTimeoutMs: 20 });
    providers[0].config.onSynced({ state: true });
    expect(await settle(ready)).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 40));
    expect(providers[0].destroyed).toBe(false);
    // A refusal after the sync is a revoke, handled by the room, not `ready`
    providers[0].config.onAuthenticationFailed({ reason: "access-refused" });
    expect(session.getSnapshot().terminal).toBe("access_revoked");
    expect(providers[0].disconnected).toBe(true);
    session.destroy();
    expect(providers[0].destroyed).toBe(true);
  });

  test("destroyed while connecting: no late rejection", async () => {
    const { ready, session } = start({ syncTimeoutMs: 20 });
    session.destroy();
    let settled = false;
    ready.then(() => (settled = true), () => (settled = true));
    await new Promise((r) => setTimeout(r, 40));
    expect(settled).toBe(false);
  });
});
