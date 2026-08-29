import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { asArray } from "../services/utils/ts/requests.ts";

const SOURCE = readFileSync(
  join(import.meta.dir, "../components/Objects/Editor/ActivitySwitcher.tsx"),
  "utf8",
);

/**
 * "TypeError: w.map is not a function" on the activity editor. `?? []` reads as
 * a guard and is not one: it only substitutes null and undefined, so any other
 * shape the metadata endpoint returns for `chapters` / `chapter.activities` — a
 * string, an error body, an object — passes straight through to `.map` and the
 * whole editor page unmounts. `asArray` is the guard.
 */
describe("ActivitySwitcher coerces fetched lists before mapping", () => {
  test("chapters comes from asArray, not ?? []", () => {
    expect(SOURCE).toContain("asArray(data?.chapters)");
    expect(SOURCE).not.toContain("data?.chapters ?? []");
  });

  test("nested activities come from asArray too", () => {
    expect(SOURCE).toContain("asArray(chapter.activities)");
  });

  test("no ?? [] / || [] survives in front of a list operation", () => {
    const offenders = [
      ...SOURCE.matchAll(/\?\?\s*\[\]\)\s*\.(map|filter|forEach)/g),
      ...SOURCE.matchAll(/\|\|\s*\[\]\)\s*\.(map|filter|forEach)/g),
    ].map((m) => m[0]);
    expect(offenders).toEqual([]);
  });
});

describe("asArray refuses the shapes ?? [] let through", () => {
  test("a non-array object does not reach .map", () => {
    expect(asArray({ detail: "Not found" })).toEqual([]);
  });

  test("a string does not reach .map, even though it has a length", () => {
    // This is the shape `chapters.length > 0` fails to catch.
    expect(asArray("chapter one")).toEqual([]);
  });
});
