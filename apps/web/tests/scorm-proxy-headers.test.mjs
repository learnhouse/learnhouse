import { describe, expect, test } from "bun:test";

import { forwardedRequestHeaders } from "../ee/services/scorm/proxyHeaders.ts";

/**
 * SCORM content is authorized by the launch token in its URL. A package runs
 * sandboxed and can trigger requests through the proxy, so the viewer's
 * credentials must never ride along to the API.
 */

describe("forwardedRequestHeaders", () => {
  test("the session cookie stays behind", () => {
    const headers = new Headers({ cookie: "LH_access=abc; other=1" });
    expect(forwardedRequestHeaders(headers).cookie).toBeUndefined();
  });

  test("a bearer token stays behind", () => {
    const headers = new Headers({ authorization: "Bearer abc" });
    expect(forwardedRequestHeaders(headers).authorization).toBeUndefined();
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
