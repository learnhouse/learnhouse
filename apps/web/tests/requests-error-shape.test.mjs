import { afterEach, describe, expect, test } from "bun:test";

import {
  apiFetch,
  asArray,
  uploadFormWithProgress,
} from "../services/utils/ts/requests.ts";
import { getUserGroups } from "../services/usergroups/usergroups.ts";
import { getUserEnrollments } from "../services/payments/offers.ts";

const API = "http://localhost/api/v1/";

const response = (status, body, { text = null } = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  statusText: status === 403 ? "Forbidden" : status === 200 ? "OK" : "Error",
  json: async () => {
    if (text !== null) throw new SyntaxError("Unexpected token < in JSON");
    return body;
  },
});

const realFetch = globalThis.fetch;
const realXHR = globalThis.XMLHttpRequest;

const stubFetch = (res) => {
  globalThis.fetch = async () => res;
};

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.XMLHttpRequest = realXHR;
});

// A minimal XHR that fires onload with a canned status/body as soon as send()
// is called — enough to drive uploadFormWithProgress's resolve/reject branches.
const stubXHR = (status, responseText) => {
  globalThis.XMLHttpRequest = class {
    constructor() {
      this.upload = {};
      this.status = 0;
      this.responseText = "";
    }
    open() {}
    setRequestHeader() {}
    send() {
      this.status = status;
      this.responseText = responseText;
      this.onload();
    }
  };
};

describe("uploadFormWithProgress", () => {
  test("resolves with the parsed block object on a 2xx", async () => {
    stubXHR(200, JSON.stringify({ block_uuid: "b1", content: { file_id: "f1" } }));
    const block = await uploadFormWithProgress(`${API}blocks/image`, new FormData(), "tok");
    expect(block.content.file_id).toBe("f1");
  });

  test("rejects a 2xx whose body cannot be parsed", async () => {
    // Used to resolve `{}`, which the Image/PDF NodeViews then persisted into
    // the document and crashed on at `blockObject.content.file_id`.
    stubXHR(200, "<html>gateway</html>");
    await expect(
      uploadFormWithProgress(`${API}blocks/image`, new FormData(), "tok")
    ).rejects.toThrow("unreadable response");
  });

  test("still reports the backend detail on a failure", async () => {
    stubXHR(422, JSON.stringify({ detail: "Unsupported file format" }));
    await expect(
      uploadFormWithProgress(`${API}blocks/image`, new FormData(), "tok")
    ).rejects.toThrow("Unsupported file format");
  });
});

describe("asArray", () => {
  test("returns nothing for a failed request, whatever its body", () => {
    expect(asArray({ success: false, data: { detail: "nope" } })).toEqual([]);
    // A failed request never carries a result — not even an array-shaped one.
    expect(asArray({ success: false, data: ["stale"] })).toEqual([]);
  });

  test("still unwraps a successful envelope", () => {
    expect(asArray({ success: true, data: [1, 2] })).toEqual([1, 2]);
  });
});

describe("getUserGroups", () => {
  test("resolves a plain list on success", async () => {
    stubFetch(response(200, [{ id: 1, name: "Group" }]));
    const groups = await getUserGroups(1, "tok");
    expect(Array.isArray(groups)).toBe(true);
    expect(groups[0].name).toBe("Group");
  });

  test("rejects on a non-2xx instead of returning the error body as data", async () => {
    // The whole point: react-query must land in `error` with `data` undefined.
    // While this resolved a {success:false, data:{detail}} envelope, whichever
    // component last wrote the shared ['usergroups', orgId] cache entry decided
    // its shape, and the next reader crashed on `usergroups.map`.
    stubFetch(response(403, { detail: "Not allowed" }));
    await expect(getUserGroups(1, "tok")).rejects.toThrow("Not allowed");
  });

  test("produces the same shape as a raw apiFetch on the same endpoint", async () => {
    // Both queryFns write the ['usergroups', orgId] key. One cache entry, one
    // shape — this is the contract that made the crash possible when broken.
    const body = [{ id: 1 }, { id: 2 }];
    stubFetch(response(200, body));
    const viaService = await getUserGroups(1, "tok");
    stubFetch(response(200, body));
    const viaApiFetch = await apiFetch(`${API}usergroups/org/1?org_id=1`, "tok");
    expect(viaService).toEqual(viaApiFetch);
  });
});

// Ordering matters here and the two tests must stay in this order:
// dispatchAuthExpired debounces for 1500ms on a module-level timestamp, so if
// the positive control ran first the negative one would pass vacuously.
describe("a 401 on usergroups must not evict the user", () => {
  const withBrowser = (fn) => async () => {
    const events = [];
    const target = new EventTarget();
    target.addEventListener("learnhouse:auth-expired", (e) => events.push(e));
    globalThis.window = target;
    globalThis.window.location = { pathname: "/course/abc" };
    globalThis.document = { cookie: "LH_session=1" };
    try {
      await fn(events);
    } finally {
      delete globalThis.window;
      delete globalThis.document;
    }
  };

  test(
    "getUserGroups rejects WITHOUT firing authExpired",
    withBrowser(async (events) => {
      // Under getResponseMetadata this 401 was swallowed entirely. Routing the
      // service through plain `errorHandling` to fix the response shape would
      // have added a forced logout to eleven surfaces that never had one —
      // including the learner-facing org course list and the LockPopover — while
      // an unexplained-logout investigation is still open. The throw is wanted;
      // the redirect is not.
      stubFetch(response(401, { detail: "Could not validate credentials" }));
      await expect(getUserGroups(1, "tok")).rejects.toThrow("Could not validate credentials");
      expect(events).toHaveLength(0);
    })
  );

  test(
    "control: a plain apiFetch 401 still does fire it",
    withBrowser(async (events) => {
      // Proves the harness above can observe the event at all, so the negative
      // assertion is not passing for the wrong reason.
      stubFetch(response(401, { detail: "Could not validate credentials" }));
      await expect(apiFetch(`${API}users/profile`, "tok")).rejects.toThrow();
      expect(events).toHaveLength(1);
    })
  );
});

describe("getUserEnrollments", () => {
  test("treats a 403 as no enrollments rather than a server error", async () => {
    // Payments disabled / not entitled is a routine answer. Throwing it out of
    // a Server Action reported "Forbidden" as an unhandled SSR error on every
    // /account/purchases view.
    stubFetch(response(403, { detail: "Forbidden" }));
    const result = await getUserEnrollments(1, "tok");
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  test("treats a 404 the same way", async () => {
    stubFetch(response(404, { detail: "Not Found" }));
    expect((await getUserEnrollments(1, "tok")).data).toEqual([]);
  });

  test("surfaces the API detail, never the bare HTTP reason phrase", async () => {
    stubFetch(response(500, { detail: "Provider unreachable" }));
    await expect(getUserEnrollments(1, "tok")).rejects.toThrow("Provider unreachable");
  });

  test("falls back to the status when there is no detail", async () => {
    stubFetch(response(502, null, { text: "<html>bad gateway</html>" }));
    await expect(getUserEnrollments(1, "tok")).rejects.toThrow("HTTP 502");
  });

  test("there is exactly one of it, and it is the guarded one", async () => {
    // services/payments/payments.ts carried an unimported second copy on the
    // same endpoint, through plain errorHandling, in a 'use server' module — a
    // 403 with no detail threw Error('Forbidden') out of a Server Action, the
    // precise failure the tests above exist to prevent. One autocomplete away
    // from undoing all of it.
    const src = await Bun.file(
      new URL("../services/payments/payments.ts", import.meta.url)
    ).text();
    expect(src).not.toMatch(/export\s+async\s+function\s+getUserEnrollments/);
  });
});
