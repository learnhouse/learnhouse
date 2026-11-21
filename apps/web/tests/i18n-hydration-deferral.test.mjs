// The server renders English. A visitor's locale bundle that loads before
// React hydrates made the first client render differ from the server HTML
// (React #418 on /login and /signup in every non-English locale). Bundles that
// arrive early now wait until I18nProvider says the tree has hydrated.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const i18n = readFileSync(new URL("../lib/i18n.ts", import.meta.url), "utf8");
const provider = readFileSync(new URL("../components/Contexts/I18nContext.tsx", import.meta.url), "utf8");

describe("locale bundles wait for hydration", () => {
  test("lib/i18n queues bundles until markHydrated", () => {
    expect(i18n).toMatch(/let hydrated = typeof window === 'undefined'/);
    expect(i18n).toMatch(/export function markHydrated\(\)/);
    expect(i18n).toMatch(/if \(hydrated\) add\(\);\s*else pendingBundles\.push\(add\);/);
  });

  test("the queue is released once the browser is idle (Suspense boundaries hydrate late)", () => {
    expect(i18n).toMatch(/idle\(releasePendingBundles, \{ timeout: 1500 \}\)/);
    expect(i18n).toMatch(/else window\.setTimeout\(releasePendingBundles, 300\)/);
  });

  test("addResourceBundle only runs through the queued callback", () => {
    const calls = i18n.match(/addResourceBundle\(/g) ?? [];
    expect(calls.length).toBe(1);
    expect(i18n).toMatch(/const add = \(\) => i18n\.addResourceBundle\(/);
  });

  test("I18nProvider releases the queue after it mounts", () => {
    expect(provider).toMatch(/import i18n, \{ markHydrated \} from '\.\.\/\.\.\/lib\/i18n'/);
    expect(provider).toMatch(/useEffect\(\(\) => \{[\s\S]*?markHydrated\(\)/);
  });
});
