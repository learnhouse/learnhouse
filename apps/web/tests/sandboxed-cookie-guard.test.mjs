// In an iframe sandboxed without allow-same-origin, reading document.cookie
// throws a SecurityError. The language detector's cookie lookup didn't catch
// it, so i18n init failed and embedded activities rendered an empty frame.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("cookie access in sandboxed frames", () => {
  test("i18n leaves the cookie detector out when cookies can't be read", () => {
    const src = read("../lib/i18n.ts");
    expect(src).toMatch(/function cookiesReadable\(\): boolean \{[\s\S]*?try \{\s*void document\.cookie\s*return true\s*\} catch \{\s*return false/);
    expect(src).toMatch(/order: canUseCookies\s*\?\s*\['localStorage', 'cookie',/);
    expect(src).toMatch(/: \['localStorage', 'querystring', 'navigator', 'path', 'subdomain'\]/);
    expect(src).toMatch(/caches: canUseCookies \? \['localStorage', 'cookie'\] : \['localStorage'\]/);
  });

  for (const file of ["../public/dir-init.js", "../lib/direction.ts"]) {
    test(`${file.replace("../", "")} reads the language cookie inside try`, () => {
      const src = read(file);
      expect(src).toMatch(/try \{\s*cookie = document\.cookie\.match\(/);
    });
  }
});
