import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

// `generateMetadata` runs during SSR with no error boundary above it. A service
// call that rejects there fails the whole render and is reported as an
// unhandled server error — even when the rejection is an entirely expected
// authorization outcome ("Resource is not public or not published" on a private
// course, a 404 org). But the opposite mistake is worse: swallowing every
// rejection into a `noindex` fallback means one API blip serves 200 + noindex
// for a live public page, which Googlebot reads as a removal request.
//
// So there are two things to pin, and this file pins both:
//   1. the behaviour, by unit-testing services/utils/ts/ssrMetadata.ts;
//   2. the routes, at source level — there is no renderer in this suite — by
//      DERIVING the list of risky calls from each file's own imports rather
//      than from a hardcoded list, so a new unguarded service call in
//      generateMetadata fails the test instead of registering zero tests.

const captured = [];
mock.module("@sentry/nextjs", () => ({
  captureException: (error, context) => captured.push({ error, context }),
}));

const { fallbackRobots, isAccessOutcome, ssrMetadataFetch } = await import(
  "../services/utils/ts/ssrMetadata.ts"
);

const apiError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

describe("fallbackRobots decides noindex on the failure class, not on failure", () => {
  test("an access outcome is noindex", () => {
    // A course the visitor may not see must never be published to the index.
    expect(fallbackRobots(apiError(403))).toEqual({
      robots: { index: false, follow: false },
    });
    expect(fallbackRobots(apiError(404))).toEqual({
      robots: { index: false, follow: false },
    });
  });

  test("a genuinely absent resource (no rejection at all) is noindex", () => {
    expect(fallbackRobots(null)).toEqual({ robots: { index: false, follow: false } });
    expect(fallbackRobots()).toEqual({ robots: { index: false, follow: false } });
  });

  // THE regression this file exists for. Before this change the fallback
  // emitted `robots: {index: false, follow: false}` unconditionally, so a
  // ten-minute 503 window served 200 + noindex for every published course —
  // an active de-indexing signal, where a 500 would only have said "retry".
  test("a 5xx emits NO robots directive so a blip cannot de-index a live page", () => {
    expect(fallbackRobots(apiError(503))).toEqual({});
    expect(fallbackRobots(apiError(500))).toEqual({});
    expect(fallbackRobots(apiError(502))).not.toHaveProperty("robots");
  });

  test("a network/parse failure carrying no status is treated as a backend fault", () => {
    expect(fallbackRobots(new TypeError("fetch failed"))).toEqual({});
    expect(fallbackRobots(new SyntaxError("Unexpected token <"))).toEqual({});
  });

  test("one backend fault among several access outcomes still suppresses noindex", () => {
    expect(fallbackRobots(apiError(403), apiError(503))).toEqual({});
  });

  test("isAccessOutcome only accepts 401/403/404", () => {
    expect(isAccessOutcome(apiError(401))).toBe(true);
    expect(isAccessOutcome(apiError(403))).toBe(true);
    expect(isAccessOutcome(apiError(404))).toBe(true);
    expect(isAccessOutcome(apiError(500))).toBe(false);
    expect(isAccessOutcome(apiError(429))).toBe(false);
    expect(isAccessOutcome(new Error("boom"))).toBe(false);
    expect(isAccessOutcome(null)).toBe(false);
  });
});

describe("ssrMetadataFetch keeps the render alive without silencing telemetry", () => {
  test("a resolved fetch passes its value through and reports nothing", async () => {
    captured.length = 0;
    const result = await ssrMetadataFetch("/r", "getThing", Promise.resolve({ name: "x" }));
    expect(result).toEqual({ data: { name: "x" }, error: null });
    expect(captured).toHaveLength(0);
  });

  test("a 403 is absorbed silently — it is a normal authorization outcome", async () => {
    captured.length = 0;
    const error = apiError(403);
    const result = await ssrMetadataFetch("/r", "getThing", Promise.reject(error));
    expect(result.data).toBe(null);
    expect(result.error).toBe(error);
    expect(captured).toHaveLength(0);
  });

  // The other half of the reviewer's point: a backend regression that 500s
  // every course must not render titleless pages with zero server-side signal.
  test("a 5xx still reaches Sentry, at ERROR", async () => {
    captured.length = 0;
    const error = apiError(503);
    const result = await ssrMetadataFetch("/route", "getCourseMetadata", Promise.reject(error));
    expect(result.data).toBe(null);
    expect(captured).toHaveLength(1);
    expect(captured[0].error).toBe(error);
    // WARNING would not do: the Sentry logging integration captures at ERROR.
    expect(captured[0].context.level).toBe("error");
    expect(captured[0].context.tags).toMatchObject({
      ssr_metadata: "/route",
      ssr_metadata_fetch: "getCourseMetadata",
    });
  });

  test("a rejection with no status reaches Sentry too", async () => {
    captured.length = 0;
    await ssrMetadataFetch("/r", "getThing", Promise.reject(new TypeError("fetch failed")));
    expect(captured).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Source-level route checks
// ---------------------------------------------------------------------------

const ROUTES = [
  // The route in LEARNHOUSE-WEB-5P's payload: routePath '/orgs/[orgslug]',
  // frame 'generateMetadata'.
  "app/orgs/[orgslug]/(withmenu)/page.tsx",
  "app/orgs/[orgslug]/(withmenu)/account/[subpage]/page.tsx",
  "app/orgs/[orgslug]/(withmenu)/course/[courseuuid]/page.tsx",
  "app/orgs/[orgslug]/(withmenu)/course/[courseuuid]/activity/[activityid]/page.tsx",
];

// Public routes whose fallback must never hardcode noindex.
const PUBLIC_ROUTES = ROUTES.filter((r) => !r.includes("/account/"));

/**
 * Imported helpers that are known not to reject, so they need no guard.
 * Anything imported and NOT listed here must be wrapped — that is what makes
 * this check fail on a newly added, differently named service call.
 */
const SAFE_IMPORTS = new Set([
  // Pure string builders.
  "getOrgSeoConfig",
  "buildPageTitle",
  "buildBreadcrumbJsonLd",
  "getCanonicalUrl",
  "getOrgThumbnailMediaDirectory",
  "getOrgOgImageMediaDirectory",
  "getCourseThumbnailMediaDirectory",
  "getActivityBlockMediaDirectory",
  // lib/seo/utils.server.ts:18-38 — the whole body is inside try/catch and
  // falls back to getCanonicalUrl.
  "getServerCanonicalUrl",
  // lib/auth/server.ts:45-84 — same, catch returns null.
  "getServerSession",
  // The guards themselves.
  "ssrMetadataFetch",
  "fallbackRobots",
  "isAccessOutcome",
]);

/** Blank out comments and string/template literals, preserving offsets. */
const strip = (source) => {
  const out = source.split("");
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") j += 2;
        else if (source[j] === ch) break;
        else j++;
      }
      blank(i, Math.min(j + 1, source.length));
      i = Math.min(j + 1, source.length);
      continue;
    }
    i++;
  }
  return out.join("");
};

/**
 * Identifiers this file imports from our own service / lib / component paths.
 *
 * Read from the RAW source, not the stripped one: strip() blanks the module
 * specifier, and `from\s+` would then swallow the newline and pair each import
 * with the NEXT line's path — an off-by-one that quietly emptied the set and
 * made the whole check vacuous.
 */
const importedIdentifiers = (rawSource) => {
  const names = new Set();
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(rawSource))) {
    if (!/^(@services\/|@\/services\/|@\/lib\/|@components\/|\.\/|\.\.\/)/.test(m[2])) continue;
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  return names;
};

/** The stripped body of generateMetadata, found by brace matching. */
const metadataBody = (stripped) => {
  const at = stripped.indexOf("export async function generateMetadata");
  expect(at).toBeGreaterThan(-1);
  const open = stripped.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < stripped.length; i++) {
    if (stripped[i] === "{") depth++;
    else if (stripped[i] === "}" && --depth === 0) return stripped.slice(at, i + 1);
  }
  throw new Error("generateMetadata body never closed");
};

/** Index just past the `)` closing the call opened at `open`. */
const endOfCall = (body, open) => {
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === "(") depth++;
    else if (body[i] === ")" && --depth === 0) return i + 1;
  }
  return -1;
};

/**
 * Every unsafe imported call inside `body` that is neither wrapped in
 * ssrMetadataFetch(...) nor followed by `.catch(`.
 */
const unguardedCalls = (body, imported) => {
  const bad = [];
  // Stack of the identifier that opened each currently-open paren.
  const stack = [];
  const idBefore = (at) => {
    let end = at;
    while (end > 0 && /\s/.test(body[end - 1])) end--;
    let start = end;
    while (start > 0 && /[A-Za-z0-9_$]/.test(body[start - 1])) start--;
    return body.slice(start, end);
  };
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "(") {
      const name = idBefore(i);
      if (name && !SAFE_IMPORTS.has(name) && imported.has(name)) {
        const insideGuard = stack.includes("ssrMetadataFetch");
        const after = body.slice(endOfCall(body, i)).trimStart();
        if (!insideGuard && !after.startsWith(".catch(")) bad.push(name);
      }
      stack.push(name);
    } else if (body[i] === ")") {
      stack.pop();
    }
  }
  return bad;
};

const analyse = (file) => {
  const raw = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  return {
    body: metadataBody(strip(raw)),
    imported: importedIdentifiers(raw),
  };
};

describe("the detector itself", () => {
  const imported = new Set(["getOrganizationContextInfo", "getSomethingBrandNew"]);

  test("flags an unguarded call", () => {
    expect(unguardedCalls("const a = await getOrganizationContextInfo(x, { y: 1 })", imported))
      .toEqual(["getOrganizationContextInfo"]);
  });

  test("accepts a .catch-guarded call", () => {
    expect(
      unguardedCalls("await getOrganizationContextInfo(x).catch(() => null)", imported)
    ).toEqual([]);
  });

  test("accepts a call wrapped in ssrMetadataFetch", () => {
    expect(
      unguardedCalls("await ssrMetadataFetch(R, N, getOrganizationContextInfo(x, { a: 1 }))", imported)
    ).toEqual([]);
  });

  // The reviewer's point: a hardcoded name list registers zero tests for a
  // service that did not exist when the list was written.
  test("flags a service it has never heard of, because the list is derived", () => {
    expect(unguardedCalls("await getSomethingBrandNew(x)", imported)).toEqual([
      "getSomethingBrandNew",
    ]);
  });

  test("ignores calls that are not imported service functions", () => {
    expect(unguardedCalls("await props.params; JSON.stringify(x); helper(y)", imported)).toEqual([]);
  });

  test("brace matching survives a nested object literal in the body", () => {
    const src = [
      "export async function generateMetadata(p) {",
      "  if (x) { return { a: { b: 1 } } }",
      "  return {}",
      "}",
      "const after = 1",
    ].join("\n");
    expect(metadataBody(strip(src))).toContain("return {}");
    expect(metadataBody(strip(src))).not.toContain("const after");
  });

  // Written after the first version of this detector silently returned the
  // wrong names (it paired each import with the following line's path), which
  // made every route check below pass vacuously.
  test("importedIdentifiers collects own-path imports and nothing else", () => {
    const src = [
      "import { Metadata } from 'next'",
      "import { getOrganizationContextInfo } from '@services/organizations/orgs'",
      "import { getOrgSeoConfig, buildPageTitle } from '@/lib/seo/utils'",
      "import Client from './client'",
    ].join("\n");
    expect([...importedIdentifiers(src)].sort()).toEqual([
      "buildPageTitle",
      "getOrgSeoConfig",
      "getOrganizationContextInfo",
    ]);
  });

  test("strip() blanks a comment containing an unbalanced paren", () => {
    const src = "// a stray ( in prose\nfoo()";
    expect(strip(src)).not.toContain("stray");
    expect(strip(src)).toContain("foo()");
  });
});

describe.each(ROUTES)("%s generateMetadata", (file) => {
  const { body, imported } = analyse(file);

  test("every service call it imports is guarded", () => {
    expect(unguardedCalls(body, imported)).toEqual([]);
  });

  test("it actually calls at least one guarded fetch", () => {
    // Guards against the above passing because nothing was detected at all.
    expect(body).toContain("ssrMetadataFetch(");
  });
});

describe.each(PUBLIC_ROUTES)("%s robots on failure", (file) => {
  const { body } = analyse(file);

  test("the failure fallback goes through fallbackRobots", () => {
    expect(body).toContain("fallbackRobots(");
  });

  // The literal is what the previous sweep shipped, and it is exactly the
  // de-indexing bug: it cannot tell a 403 from a 503.
  test("no hardcoded noindex fallback survives", () => {
    expect(body).not.toMatch(/robots:\s*\{\s*index:\s*false/);
  });
});
