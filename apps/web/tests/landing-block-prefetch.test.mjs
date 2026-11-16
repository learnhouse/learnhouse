import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { landingCoursesQuery, lazyBlockGroups } from "../components/LandingPages/render/blockQueries.ts";

describe("lazyBlockGroups", () => {
  test("finds data, form and rich blocks at any depth", () => {
    const doc = {
      root: [
        { type: "section", children: [{ type: "columns", children: [{ type: "courses" }] }] },
        { type: "newsletter" },
      ],
      symbols: { s1: { root: { type: "html" } } },
    };
    expect(lazyBlockGroups(doc)).toEqual({ data: true, forms: true, rich: true, courses: true });
  });

  test("a page of plain elements needs none of them", () => {
    const doc = { root: [{ type: "section", children: [{ type: "heading" }, { type: "text" }] }] };
    expect(lazyBlockGroups(doc)).toEqual({ data: false, forms: false, rich: false, courses: false });
  });

  test("a featured course counts as a course list, paths only as data", () => {
    expect(lazyBlockGroups({ root: [{ type: "course" }] }).courses).toBe(true);
    const paths = lazyBlockGroups({ root: [{ type: "paths" }] });
    expect(paths.data).toBe(true);
    expect(paths.courses).toBe(false);
  });

  test("survives cycles and junk", () => {
    const a = { type: "section", children: [] };
    a.children.push(a);
    expect(lazyBlockGroups(a).data).toBe(false);
    expect(lazyBlockGroups(null).data).toBe(false);
    expect(lazyBlockGroups("courses").courses).toBe(false);
  });
});

describe("landingCoursesQuery", () => {
  test("keys on the org and on signed-in vs signed-out only", () => {
    expect(landingCoursesQuery("acme").queryKey).toEqual(["landing-block", "courses", "acme", false]);
    expect(landingCoursesQuery("acme", "tok").queryKey).toEqual(["landing-block", "courses", "acme", true]);
  });

  test("the courses block and the home prefetch share it", () => {
    const blocks = readFileSync(new URL("../components/LandingPages/render/dataBlocks.tsx", import.meta.url), "utf8");
    const home = readFileSync(new URL("../app/orgs/[orgslug]/(withmenu)/home-client.tsx", import.meta.url), "utf8");
    expect(blocks).toContain("landingCoursesQuery(orgslug, accessToken)");
    expect(home).toContain("landingCoursesQuery(orgslug, accessToken)");
  });
});
