import { describe, expect, test } from "bun:test";

import { sortLibrary } from "../lib/library/sort.ts";

// Content items carry their display fields under `.resource` — courses expose
// `name`, some resources only a `title`.
const item = (resource_uuid, resource) => ({ resource_uuid, resource });
const names = (list) => list.map((x) => x.name ?? x.resource?.name ?? x.resource?.title);

describe("sortLibrary", () => {
  test("name_asc sorts folders and items alphabetically", () => {
    const folders = [{ name: "Zeta" }, { name: "Alpha" }, { name: "Mango" }];
    const items = [
      item("course_z", { name: "Zebra course" }),
      item("media_a", { title: "Anatomy slides" }),
      item("course_m", { name: "Mango course" }),
    ];

    const sorted = sortLibrary(folders, items, "name_asc");

    expect(names(sorted.folders)).toEqual(["Alpha", "Mango", "Zeta"]);
    expect(names(sorted.items)).toEqual([
      "Anatomy slides",
      "Mango course",
      "Zebra course",
    ]);
  });

  test("name_asc is the default for an unknown mode", () => {
    const items = [item("course_b", { name: "B" }), item("course_a", { name: "A" })];
    expect(names(sortLibrary([], items, "wat").items)).toEqual(["A", "B"]);
  });

  test("name_desc reverses the alphabetical order", () => {
    const folders = [{ name: "Alpha" }, { name: "Zeta" }];
    const items = [
      item("media_a", { title: "Anatomy slides" }),
      item("course_z", { name: "Zebra course" }),
    ];

    const sorted = sortLibrary(folders, items, "name_desc");

    expect(names(sorted.folders)).toEqual(["Zeta", "Alpha"]);
    expect(names(sorted.items)).toEqual(["Zebra course", "Anatomy slides"]);
  });

  test("name sorting is case-insensitive across name and title fields", () => {
    const items = [
      item("course_c", { name: "cherry" }),
      item("media_b", { title: "Banana" }),
      item("course_a", { name: "Apple" }),
    ];
    expect(names(sortLibrary([], items, "name_asc").items)).toEqual([
      "Apple",
      "Banana",
      "cherry",
    ]);
  });

  test("newest puts the most recently created first", () => {
    const items = [
      item("course_old", { name: "Old", creation_date: "2020-01-01T12:00:00Z" }),
      item("course_new", { name: "New", creation_date: "2024-06-01T12:00:00Z" }),
      item("course_mid", { name: "Mid", creation_date: "2022-03-01T12:00:00Z" }),
    ];
    expect(names(sortLibrary([], items, "newest").items)).toEqual([
      "New",
      "Mid",
      "Old",
    ]);
  });

  test("oldest puts the earliest created first", () => {
    const folders = [
      { name: "New", creation_date: "2024-06-01T12:00:00Z" },
      { name: "Old", creation_date: "2020-01-01T12:00:00Z" },
    ];
    expect(names(sortLibrary(folders, [], "oldest").folders)).toEqual([
      "Old",
      "New",
    ]);
  });

  test("newest uses the resource's creation date, not its last update", () => {
    // The real API payload: every course row carries BOTH dates, and editing a
    // course bumps update_date only. Preferring update_date here would put the
    // browser in permanent disagreement with the API's own newest/oldest order.
    const items = [
      item("course_old", {
        name: "Old",
        creation_date: "2020-01-01T12:00:00Z",
        update_date: "2024-12-01T12:00:00Z", // edited yesterday, still the oldest
      }),
      item("course_new", {
        name: "New",
        creation_date: "2024-06-01T12:00:00Z",
        update_date: "2024-06-02T12:00:00Z",
      }),
      item("course_mid", {
        name: "Mid",
        creation_date: "2022-03-01T12:00:00Z",
        update_date: "2022-03-02T12:00:00Z",
      }),
    ];

    expect(names(sortLibrary([], items, "newest").items)).toEqual([
      "New",
      "Mid",
      "Old",
    ]);
    expect(names(sortLibrary([], items, "oldest").items)).toEqual([
      "Old",
      "Mid",
      "New",
    ]);
  });

  test("update_date is only used when no creation date exists", () => {
    const items = [
      item("media_b", { title: "B", update_date: "2024-06-01T12:00:00Z" }),
      item("media_a", { title: "A", update_date: "2020-01-01T12:00:00Z" }),
    ];
    expect(names(sortLibrary([], items, "newest").items)).toEqual(["B", "A"]);
  });

  test("date sorting falls back to name when timestamps tie", () => {
    const items = [
      item("course_b", { name: "Bravo", creation_date: "2024-06-01T12:00:00Z" }),
      item("course_a", { name: "Alpha", creation_date: "2024-06-01T12:00:00Z" }),
    ];
    expect(names(sortLibrary([], items, "newest").items)).toEqual([
      "Alpha",
      "Bravo",
    ]);
  });

  test("manual returns the input arrays untouched", () => {
    const folders = [{ name: "Zeta" }, { name: "Alpha" }];
    const items = [item("course_z", { name: "Zebra" }), item("course_a", { name: "Apple" })];

    const sorted = sortLibrary(folders, items, "manual");

    // Same order AND the same array references — the drag order is trusted.
    expect(sorted.folders).toBe(folders);
    expect(sorted.items).toBe(items);
    expect(names(sorted.folders)).toEqual(["Zeta", "Alpha"]);
    expect(names(sorted.items)).toEqual(["Zebra", "Apple"]);
  });

  test("sorting does not mutate the arrays it is given", () => {
    const folders = [{ name: "Zeta" }, { name: "Alpha" }];
    sortLibrary(folders, [], "name_asc");
    expect(names(folders)).toEqual(["Zeta", "Alpha"]);
  });

  test("a numbered module list sorts the way an admin expects", () => {
    // The real-world case: zero-padded module numbers keep 10 after 09, and the
    // unnumbered final item lands where its name puts it.
    const items = [
      item("course_10", { name: "10 Module — Wrap up" }),
      item("course_02", { name: "02 Module — Basics" }),
      item("course_fin", { name: "Final Assessment" }),
      item("course_01", { name: "01 Module — Intro" }),
      item("course_09", { name: "09 Module — Review" }),
    ];

    expect(names(sortLibrary([], items, "name_asc").items)).toEqual([
      "01 Module — Intro",
      "02 Module — Basics",
      "09 Module — Review",
      "10 Module — Wrap up",
      "Final Assessment",
    ]);
  });
});
