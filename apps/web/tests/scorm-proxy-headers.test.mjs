import { describe, expect, test } from "bun:test";

import { forwardedRequestHeaders } from "../ee/services/scorm/proxyHeaders.ts";

/**
 * The API only knows who is loading a SCORM file from the credentials the proxy
 * passes on. Drop them and every learner looks anonymous, so private and draft
 * courses answer 401 and the player stays blank.
 */

describe("forwardedRequestHeaders", () => {
  test("the session cookie reaches the API", () => {
    const headers = new Headers({ cookie: "LH_access=abc; other=1" });
    expect(forwardedRequestHeaders(headers).cookie).toBe("LH_access=abc; other=1");
  });

  test("a bearer token reaches the API", () => {
    const headers = new Headers({ authorization: "Bearer abc" });
    expect(forwardedRequestHeaders(headers).authorization).toBe("Bearer abc");
  });

  test("range and cache validators still pass through", () => {
    const headers = new Headers({
      range: "bytes=0-99",
      "if-none-match": '"etag"',
      "if-modified-since": "Wed, 07 Oct 2026 20:02:42 GMT",
    });
    expect(forwardedRequestHeaders(headers)).toEqual({
      range: "bytes=0-99",
      "if-none-match": '"etag"',
      "if-modified-since": "Wed, 07 Oct 2026 20:02:42 GMT",
    });
  });

  test("hop-specific headers stay behind", () => {
    const headers = new Headers({
      host: "org.example.com",
      "accept-encoding": "gzip",
      "x-forwarded-for": "1.2.3.4",
    });
    expect(forwardedRequestHeaders(headers)).toEqual({});
  });
});
