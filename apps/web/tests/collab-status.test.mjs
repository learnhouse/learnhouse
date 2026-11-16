import { describe, expect, test } from "bun:test";

const {
  INITIAL_SNAPSHOT,
  createThrottle,
  deriveStatus,
  editsSaved,
  hasUnsyncedEdits,
  initials,
  presenceList,
  samePeers,
  terminalCloseOf,
} = await import("../components/Objects/Editor/Collab/collabStatus.ts");

const live = { ...INITIAL_SNAPSHOT, connection: "connected", synced: true };

describe("collab status pill", () => {
  test("follows connection, permissions and saves", () => {
    expect(deriveStatus(INITIAL_SNAPSHOT)).toBe("reconnecting");
    expect(deriveStatus({ ...live, synced: false })).toBe("reconnecting");
    expect(deriveStatus(live)).toBe("live");
    expect(deriveStatus({ ...live, unsynced: 2 })).toBe("saving");
    expect(deriveStatus({ ...live, unsaved: true })).toBe("saving");
    expect(deriveStatus({ ...live, saveFailed: true })).toBe("saving");
    expect(deriveStatus({ ...live, lastSavedAt: 1 })).toBe("saved");
    expect(deriveStatus({ ...live, readOnly: true, unsaved: true })).toBe("readonly");
    expect(deriveStatus({ ...live, connection: "disconnected", unsaved: true })).toBe("reconnecting");
    expect(deriveStatus({ ...live, terminal: "access_revoked" })).toBe("error");
  });

  test("guards leaving only while edits are not on the server", () => {
    expect(hasUnsyncedEdits(live)).toBe(false);
    expect(hasUnsyncedEdits({ ...live, unsynced: 1 })).toBe(true);
    // On the server, not saved yet: the server saves it when everyone leaves
    expect(hasUnsyncedEdits({ ...live, unsaved: true })).toBe(false);
    // Offline with local edits
    expect(hasUnsyncedEdits({ ...live, connection: "disconnected", unsaved: true })).toBe(true);
    expect(hasUnsyncedEdits({ ...live, readOnly: true, unsynced: 3 })).toBe(false);
  });

  test("knows when its own edits are in a save", () => {
    expect(editsSaved(10, 10)).toBe(true);
    expect(editsSaved(11, 10)).toBe(true);
    expect(editsSaved(9, 10)).toBe(false);
    expect(editsSaved(undefined, 0)).toBe(true);
    expect(editsSaved(undefined, 1)).toBe(false);
  });

  test("recognizes closes that reconnecting can't fix", () => {
    expect(terminalCloseOf({ code: 4403 })).toBe("access_revoked");
    expect(terminalCloseOf({ reason: "Access revoked" })).toBe("access_revoked");
    expect(terminalCloseOf({ code: 4413 })).toBe("too_large");
    expect(terminalCloseOf({ code: 4401, reason: "Token expired" })).toBe(null);
    expect(terminalCloseOf({ code: 1006 })).toBe(null);
    expect(terminalCloseOf(undefined)).toBe(null);
  });
});

describe("presence list", () => {
  const states = new Map([
    [1, { user: { id: 10, name: "Me", color: "#000" } }],
    [2, { user: { id: 20, name: "Zoe", color: "#f00", avatar: "z.png", uuid: "user_z" } }],
    [3, { user: { id: 30, name: "Ada", color: "#0f0" }, idle: true }],
    [4, { user: { id: 20, name: "Zoe", color: "#f00" }, idle: true }],
    [5, { user: { id: 10, name: "Me again" } }],
    [6, {}],
    [7, { user: { id: 0, name: "anon" } }],
  ]);

  test("one entry per other user, sorted, idle only when all tabs are", () => {
    const peers = presenceList(states, 1, 10);
    expect(peers.map((p) => [p.name, p.clientIds, p.idle])).toEqual([
      ["Ada", [3], true],
      ["Zoe", [2, 4], false],
    ]);
    expect(peers[1].avatar).toBe("z.png");
    expect(peers[1].uuid).toBe("user_z");
  });

  test("compares lists cheaply", () => {
    const a = presenceList(states, 1, 10);
    const b = presenceList(states, 1, 10);
    expect(samePeers(a, b)).toBe(true);
    expect(samePeers(a, a.slice(1))).toBe(false);
    expect(samePeers(a, [{ ...a[0], idle: false }, a[1]])).toBe(false);
  });

  test("initials", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("  grace  ")).toBe("G");
    expect(initials("")).toBe("?");
    expect(initials("Jean Luc Picard")).toBe("JP");
  });
});

describe("caret throttle", () => {
  test("at most one call per interval, always delivering the latest value", () => {
    let now = 0;
    const timers = [];
    const calls = [];
    const throttled = createThrottle(
      (v) => calls.push([now, v]),
      100,
      () => now,
      (fn, ms) => {
        timers.push({ fn, at: now + ms });
        return timers.length;
      },
      () => {},
    );
    throttled("a"); // immediate
    now = 10;
    throttled("b");
    now = 50;
    throttled("c"); // replaces b
    expect(calls).toEqual([[0, "a"]]);
    now = 100;
    timers.shift().fn();
    expect(calls).toEqual([[0, "a"], [100, "c"]]);
    now = 150;
    throttled("d"); // within the interval of the trailing call
    now = 200;
    timers.shift().fn();
    expect(calls.at(-1)).toEqual([200, "d"]);
    now = 400;
    throttled("e"); // idle long enough: immediate
    expect(calls.at(-1)).toEqual([400, "e"]);
    throttled("f");
    throttled.cancel();
    expect(timers.length).toBe(1);
  });
});

describe("autosave rules", async () => {
  const { nextAutosaveDelay, autosaveIndicatorStatus } = await import(
    "../components/Objects/Editor/Autosave/autosaveTiming.ts"
  );

  test("retries back off from 2 s to at most 30 s", () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(nextAutosaveDelay)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(nextAutosaveDelay(0)).toBe(2000);
  });

  test("maps to the shared save indicator", () => {
    const base = { connecting: false, readOnly: false, dirty: false };
    expect(autosaveIndicatorStatus("saved", base)).toBe("saved");
    expect(autosaveIndicatorStatus("saved", { ...base, dirty: true })).toBe("saving");
    expect(autosaveIndicatorStatus("saving", base)).toBe("saving");
    expect(autosaveIndicatorStatus("failed", base)).toBe("failed");
    expect(autosaveIndicatorStatus("conflict", base)).toBe("failed");
    expect(autosaveIndicatorStatus("offline", base)).toBe("offline");
    expect(autosaveIndicatorStatus("saved", { ...base, connecting: true })).toBe("connecting");
    expect(autosaveIndicatorStatus("saved", { ...base, connecting: true, savedOnce: true })).toBe("saved");
    expect(autosaveIndicatorStatus("saved", { ...base, readOnly: true, connecting: true })).toBe("connecting");
    expect(autosaveIndicatorStatus("saved", { ...base, readOnly: true })).toBe("readonly");
  });
});
