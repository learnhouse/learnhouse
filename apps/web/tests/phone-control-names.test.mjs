// On phones the activity controls live in MobileActivityBar. It was a plain
// div (desktop uses a named <nav>), and the chapter outline toggle lost its
// only text label below the sm breakpoint, leaving an unnamed button.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("activity bar accessibility on phones", () => {
  test("MobileActivityBar is the same named navigation landmark as the desktop bar", () => {
    const src = read("../components/Pages/Activity/MobileActivityBar.tsx");
    expect(src).toMatch(/<nav\s+\/\/[^\n]*\n\s+aria-label=\{t\('activities\.nav\.label', 'Activity navigation'\)\}/);
    expect(src).toContain("</nav>");
  });

  test("the chapter outline toggle has an accessible name at every width", () => {
    const src = read("../components/Pages/Courses/ActivityIndicators.tsx");
    expect(src).toMatch(/aria-haspopup="dialog"[\s\S]{0,200}aria-label=\{t\('activities\.progress\.all_chapters', 'All chapters'\)\}/);
  });

  test("the community reply button keeps its name when the text hides on phones", () => {
    const src = read("../components/Objects/Communities/CommentSection.tsx");
    expect(src).toMatch(/aria-label=\{t\('communities\.comments\.reply'\)\}\s*>\s*<span className="hidden sm:inline">\{t\('communities\.comments\.reply'\)\}/);
  });
});
