import { describe, expect, test } from "bun:test";

import { asArray, getResponseMetadata } from "../services/utils/ts/requests.ts";
import { safePlay } from "../lib/media/safePlay.ts";

const response = (status, body, { throws = false } = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  statusText: status === 200 ? "OK" : "Error",
  json: async () => {
    if (throws) throw new SyntaxError("Unexpected end of JSON input");
    return body;
  },
});

describe("asArray", () => {
  test("passes an array straight through", () => {
    expect(asArray([1, 2])).toEqual([1, 2]);
  });

  test("unwraps the metadata envelope", () => {
    expect(asArray({ success: true, data: ["a"] })).toEqual(["a"]);
  });

  test("returns an empty list for an error body", () => {
    // The shape that crashed list components with ".map is not a function":
    // a failed request whose `data` is the API's error payload, not a list.
    expect(asArray({ success: false, data: { detail: "Not allowed" } })).toEqual([]);
    expect(asArray({ detail: "Not allowed" })).toEqual([]);
    expect(asArray(null)).toEqual([]);
    expect(asArray(undefined)).toEqual([]);
    expect(asArray("nope")).toEqual([]);
  });
});

describe("getResponseMetadata", () => {
  test("reports success for any 2xx", async () => {
    expect(await getResponseMetadata(response(201, { id: 1 }))).toEqual({
      success: true,
      data: { id: 1 },
      status: 201,
      HTTPmessage: "Error",
    });
  });

  test("reports failure without throwing on a body that is not JSON", async () => {
    const result = await getResponseMetadata(response(503, null, { throws: true }));
    expect(result.success).toBe(false);
    expect(result.data).toBe(null);
    expect(result.status).toBe(503);
  });
});

describe("safePlay", () => {
  test("swallows a rejected play()", async () => {
    let rejected = false;
    const el = {
      play: () => {
        rejected = true;
        return Promise.reject(new Error("NotAllowedError"));
      },
    };
    // Would surface as an unhandled rejection without the catch.
    await safePlay(el);
    expect(rejected).toBe(true);
  });

  test("is a no-op without an element", () => {
    expect(safePlay(null)).toBeUndefined();
    expect(safePlay(undefined)).toBeUndefined();
  });

  test("tolerates a play() that returns nothing (older elements)", () => {
    expect(safePlay({ play: () => undefined })).toBeUndefined();
  });
});
