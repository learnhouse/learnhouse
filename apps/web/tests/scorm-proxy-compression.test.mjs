import { describe, expect, test } from "bun:test";

import {
  acceptsGzip,
  bodyWasDecoded,
  canRecompress,
} from "../ee/services/scorm/proxyCompression.ts";

/**
 * The SCORM proxy carries every file of a package — hundreds of them — so the
 * encoding decision it makes is worth more than one asset. Get it too cautious
 * and megabytes of JS cross the last mile uncompressed; get it wrong and the
 * browser is handed bytes its headers contradict.
 */

const gzipped = (status = 200) =>
  new Response(null, { status, headers: { "content-encoding": "gzip" } });

describe("bodyWasDecoded", () => {
  test("a compressed upstream response is flagged", () => {
    expect(bodyWasDecoded(gzipped())).toBe(true);
  });

  test("no content-encoding means nothing was unpacked", () => {
    expect(bodyWasDecoded(new Response(null))).toBe(false);
  });

  test("identity is not compression", () => {
    const response = new Response(null, {
      headers: { "content-encoding": "identity" },
    });
    expect(bodyWasDecoded(response)).toBe(false);
  });
});

describe("acceptsGzip", () => {
  test("a plain gzip offer is accepted", () => {
    expect(acceptsGzip("gzip")).toBe(true);
  });

  test("gzip among other encodings is found", () => {
    expect(acceptsGzip("br, gzip, deflate")).toBe(true);
  });

  test("a positive q value is still an offer", () => {
    expect(acceptsGzip("gzip;q=0.5")).toBe(true);
  });

  test("gzip weighted to zero is a refusal, not an offer", () => {
    expect(acceptsGzip("gzip;q=0")).toBe(false);
    expect(acceptsGzip("br, gzip;q=0")).toBe(false);
  });

  test("a wildcard covers gzip", () => {
    expect(acceptsGzip("*")).toBe(true);
  });

  test("a wildcard does not override gzip refused by name", () => {
    expect(acceptsGzip("*, gzip;q=0")).toBe(false);
  });

  test("encodings that merely contain 'gzip' are not gzip", () => {
    expect(acceptsGzip("x-gzip-ish")).toBe(false);
  });

  test("a missing or empty header is not an offer", () => {
    expect(acceptsGzip(null)).toBe(false);
    expect(acceptsGzip("")).toBe(false);
  });
});

describe("canRecompress", () => {
  test("a decoded 200 for a gzip-capable client is re-compressed", () => {
    expect(canRecompress(gzipped(), "gzip")).toBe(true);
  });

  test("a body that was never compressed is left alone", () => {
    expect(canRecompress(new Response(null), "gzip")).toBe(false);
  });

  test("a client that cannot read gzip gets plaintext", () => {
    expect(canRecompress(gzipped(), null)).toBe(false);
  });

  test("a 206 is left alone — its content-range describes identity bytes", () => {
    expect(canRecompress(gzipped(206), "gzip")).toBe(false);
  });
});

describe("the bytes the browser actually receives", () => {
  test("a re-compressed stream round-trips back to the original body", async () => {
    const original = "console.log('scorm');".repeat(500);

    const compressed = new Response(original).body.pipeThrough(
      new CompressionStream("gzip")
    );
    const restored = await new Response(
      compressed.pipeThrough(new DecompressionStream("gzip"))
    ).text();

    expect(restored).toBe(original);
  });

  test("compressing shrinks a typical text asset", async () => {
    const original = "console.log('scorm');".repeat(500);

    const compressed = await new Response(
      new Response(original).body.pipeThrough(new CompressionStream("gzip"))
    ).arrayBuffer();

    expect(compressed.byteLength).toBeLessThan(original.length);
  });
});
