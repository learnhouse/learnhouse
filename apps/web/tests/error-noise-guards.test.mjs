import { afterEach, describe, expect, mock, test } from "bun:test";

import { isClientNoise, isServerNoise } from "../lib/errors/sentryNoise.ts";
import { createMemoryStorage, installStorageGuard } from "../lib/errors/storageGuard.ts";
import { installDomMutationGuard } from "../lib/errors/domMutationGuard.ts";
import { detailMessage, fetchWithRetry } from "../services/utils/ts/requests.ts";

describe("isClientNoise", () => {
  test("drops dropped connections in every browser's wording", () => {
    expect(isClientNoise("Failed to fetch")).toBe(true);
    expect(isClientNoise("TypeError: Failed to fetch (api.learnhouse.io)")).toBe(true);
    expect(isClientNoise("Load failed")).toBe(true);
    expect(isClientNoise("NetworkError when attempting to fetch resource.")).toBe(true);
    expect(isClientNoise("NetworkError: A network error occurred.")).toBe(true);
  });

  test("keeps failures that only look like network errors", () => {
    // A stale chunk is real, and handled by the reload path.
    expect(isClientNoise("Failed to fetch dynamically imported module: /x.js")).toBe(false);
    expect(isClientNoise("eC?.map is not a function")).toBe(false);
  });

  test("drops DOM Event rejections from failed asset loads", () => {
    expect(isClientNoise("Event `Event` (type=error) captured as promise rejection")).toBe(true);
  });

  test("drops Session Replay's own worker handshake crash only", () => {
    const msg = "Cannot read properties of null (reading 'success')";
    expect(isClientNoise(msg, [{ function: "_worker.addEventListener.once" }])).toBe(true);
    expect(isClientNoise(msg, [{ function: "CourseClient" }])).toBe(false);
    expect(isClientNoise(msg)).toBe(false);
  });
});

describe("isServerNoise", () => {
  test("drops uploads the browser abandoned", () => {
    expect(isServerNoise("missing final boundary while parsing FormData")).toBe(true);
    expect(isServerNoise("Service Unavailable")).toBe(false);
  });
});

describe("storage guard", () => {
  test("memory storage behaves like Storage", () => {
    const s = createMemoryStorage();
    s.setItem("a", 1);
    expect(s.getItem("a")).toBe("1");
    expect(s.length).toBe(1);
    expect(s.key(0)).toBe("a");
    expect(s.key(5)).toBe(null);
    s.removeItem("a");
    expect(s.getItem("a")).toBe(null);
    s.setItem("b", "2");
    s.clear();
    expect(s.length).toBe(0);
  });

  test("replaces storage that throws on access", () => {
    const win = {};
    Object.defineProperty(win, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: Access is denied for this document.");
      },
    });
    Object.defineProperty(win, "sessionStorage", { configurable: true, get: () => null });
    installStorageGuard(win);
    win.localStorage.setItem("theme", "dark");
    expect(win.localStorage.getItem("theme")).toBe("dark");
    expect(win.sessionStorage.getItem("x")).toBe(null);
  });

  test("leaves working storage alone", () => {
    const real = createMemoryStorage();
    const win = { localStorage: real, sessionStorage: real };
    installStorageGuard(win);
    expect(win.localStorage).toBe(real);
  });

  test("survives a window it can't patch", () => {
    const win = {};
    Object.defineProperty(win, "localStorage", {
      configurable: false,
      get() {
        throw new Error("blocked");
      },
    });
    Object.defineProperty(win, "sessionStorage", { configurable: false, get: () => null });
    expect(() => installStorageGuard(win)).not.toThrow();
    expect(() => installStorageGuard(undefined)).not.toThrow();
  });
});

describe("DOM mutation guard", () => {
  const makeProto = () => {
    const calls = [];
    return {
      calls,
      removeChild(child) {
        calls.push(["remove", child]);
        return child;
      },
      insertBefore(node, ref) {
        calls.push(["insert", node, ref]);
        return node;
      },
    };
  };

  test("skips removing a node a translator already moved", () => {
    const proto = makeProto();
    installDomMutationGuard(proto);
    const parent = Object.create(proto);
    const stray = { parentNode: {} };
    expect(parent.removeChild(stray)).toBe(stray);
    expect(proto.calls).toEqual([]);
    const own = { parentNode: parent };
    parent.removeChild(own);
    expect(proto.calls).toEqual([["remove", own]]);
  });

  test("skips inserting before a node that's no longer a child", () => {
    const proto = makeProto();
    installDomMutationGuard(proto);
    const parent = Object.create(proto);
    const node = {};
    expect(parent.insertBefore(node, { parentNode: {} })).toBe(node);
    expect(proto.calls).toEqual([]);
    parent.insertBefore(node, null);
    parent.insertBefore(node, { parentNode: parent });
    expect(proto.calls.length).toBe(2);
  });

  test("installs once", () => {
    const proto = makeProto();
    installDomMutationGuard(proto);
    const patched = proto.removeChild;
    installDomMutationGuard(proto);
    expect(proto.removeChild).toBe(patched);
    expect(() => installDomMutationGuard(undefined)).not.toThrow();
  });
});

describe("detailMessage", () => {
  test("pulls the readable message out of every FastAPI detail shape", () => {
    expect(detailMessage("Nope", "fallback")).toBe("Nope");
    expect(detailMessage({ code: "AI_UNAVAILABLE", message: "AI is down" }, "fallback")).toBe("AI is down");
    expect(detailMessage([{ msg: "field required" }], "fallback")).toBe("field required");
    expect(detailMessage({ code: "X" }, "fallback")).toBe("fallback");
    expect(detailMessage("", "fallback")).toBe("fallback");
    expect(detailMessage(undefined, "fallback")).toBe("fallback");
  });
});

describe("fetchWithRetry", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("rides out a 503 during a backend restart", async () => {
    const statuses = [503, 502, 200];
    globalThis.fetch = mock(async () => ({ status: statuses.shift() }));
    const res = await fetchWithRetry("http://api/x", {}, { delayMs: 0 });
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  test("returns the last response once retries run out", async () => {
    globalThis.fetch = mock(async () => ({ status: 503 }));
    const res = await fetchWithRetry("http://api/x", {}, { retries: 1, delayMs: 0 });
    expect(res.status).toBe(503);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  test("does not retry real answers", async () => {
    globalThis.fetch = mock(async () => ({ status: 404 }));
    const res = await fetchWithRetry("http://api/x", {}, { delayMs: 0 });
    expect(res.status).toBe(404);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("retries a refused connection, then gives up", async () => {
    let n = 0;
    globalThis.fetch = mock(async () => {
      n++;
      if (n === 1) throw new TypeError("ECONNREFUSED");
      return { status: 200 };
    });
    expect((await fetchWithRetry("http://api/x", {}, { delayMs: 0 })).status).toBe(200);

    globalThis.fetch = mock(async () => {
      throw new TypeError("ECONNREFUSED");
    });
    await expect(fetchWithRetry("http://api/x", {}, { retries: 1, delayMs: 0 })).rejects.toThrow("ECONNREFUSED");
  });
});
