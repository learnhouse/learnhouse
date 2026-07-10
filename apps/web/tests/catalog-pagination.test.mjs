import { describe, expect, test } from "bun:test";

import {
  getCatalogPageNumbers,
} from "../components/Objects/Catalog/catalogPagination.ts";

describe("getCatalogPageNumbers", () => {
  test("returns no pages when there are no results", () => {
    expect(getCatalogPageNumbers(1, 0)).toEqual([]);
  });

  test("returns every page when the list fits in the visible window", () => {
    expect(getCatalogPageNumbers(1, 1)).toEqual([1]);
    expect(getCatalogPageNumbers(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  test("keeps the first pages visible near the beginning", () => {
    expect(getCatalogPageNumbers(1, 10)).toEqual([1, 2, 3, 4, "...", 10]);
    expect(getCatalogPageNumbers(3, 10)).toEqual([1, 2, 3, 4, "...", 10]);
  });

  test("keeps the current page centered in the middle", () => {
    expect(getCatalogPageNumbers(5, 10)).toEqual([1, "...", 4, 5, 6, "...", 10]);
  });

  test("keeps the last pages visible near the end", () => {
    expect(getCatalogPageNumbers(8, 10)).toEqual([1, "...", 7, 8, 9, 10]);
    expect(getCatalogPageNumbers(10, 10)).toEqual([1, "...", 7, 8, 9, 10]);
  });
});
