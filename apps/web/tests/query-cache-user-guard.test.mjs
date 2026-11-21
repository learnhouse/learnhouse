// When the signed-in user changes, the guard clears cached queries and
// refreshes the router. On sign-in pages that refresh raced the page's own
// full load; Safari then reloaded the refreshed URL (a spent magic link).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../components/Contexts/QueryCacheUserGuard.tsx", import.meta.url), "utf8");
const re = new RegExp(src.match(/const LEAVES_WITH_FULL_LOAD = \/(.+)\/\n/)[1]);

describe("QueryCacheUserGuard", () => {
  test("always clears the query cache on a user change", () => {
    expect(src).toMatch(/queryClient\.clear\(\)\n\s+if \(!LEAVES_WITH_FULL_LOAD\.test\(pathname \|\| ''\)\) router\.refresh\(\)/);
  });

  test("skips the router refresh on sign-in routes", () => {
    for (const p of ["/auth/magic", "/auth/callback/google", "/login", "/signup", "/redirect_from_auth"]) {
      expect(re.test(p), p).toBe(true);
    }
  });

  test("still refreshes everywhere else", () => {
    for (const p of ["/", "/courses", "/course/abc", "/trail", "/authors", "/login-help", "/signups"]) {
      expect(re.test(p), p).toBe(false);
    }
  });
});
