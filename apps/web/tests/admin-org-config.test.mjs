// Helpers behind the platform console's org Branding and Configuration tabs:
// image paths, URL / color validation, menu ordering, draft comparison and the
// change-history rows.

import { describe, expect, test } from "bun:test";
import {
  IMAGE_FOLDERS,
  IMAGE_SLOTS,
  changeCount,
  changeRows,
  formatValue,
  isHttpUrl,
  isMenuUrl,
  moveItem,
  normalizeHex,
  orgImagePath,
  readablePath,
  sameValue,
  sortedMenu,
} from "../components/Admin/OrgDetail/orgConfig.ts";

describe("orgImagePath", () => {
  test("builds the storage path per slot", () => {
    expect(orgImagePath("logo", "org_1", "a_logo.png")).toBe("content/orgs/org_1/logos/a_logo.png");
    expect(orgImagePath("auth_background", "org_1", "bg.jpg")).toBe("content/orgs/org_1/auth_backgrounds/bg.jpg");
    expect(orgImagePath("preview", "org_1", "p.png")).toBe("content/orgs/org_1/previews/p.png");
  });
  test("passes absolute URLs through and returns null when unset", () => {
    expect(orgImagePath("og_image", "org_1", "https://cdn.test/x.png")).toBe("https://cdn.test/x.png");
    expect(orgImagePath("logo", "org_1", "")).toBeNull();
    expect(orgImagePath("logo", undefined, "a.png")).toBeNull();
  });
  test("every displayed slot has a folder", () => {
    for (const { slot } of IMAGE_SLOTS) expect(IMAGE_FOLDERS[slot]).toBeTruthy();
  });
});

describe("validation", () => {
  test("isHttpUrl", () => {
    expect(isHttpUrl("https://x.com/acme")).toBe(true);
    expect(isHttpUrl(" http://a.test ")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("https://a b")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
  test("isMenuUrl allows internal paths and http(s), not protocol-relative", () => {
    expect(isMenuUrl("")).toBe(true);
    expect(isMenuUrl("/about")).toBe(true);
    expect(isMenuUrl("https://blog.test")).toBe(true);
    expect(isMenuUrl("//evil.test")).toBe(false);
    expect(isMenuUrl("javascript:alert(1)")).toBe(false);
  });
  test("normalizeHex", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("1D4ED8")).toBe("#1d4ed8");
    expect(normalizeHex("  ")).toBe("");
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
  });
});

describe("menu", () => {
  const item = (type, order) => ({ type, order, enabled: true, label: "", url: "", icon: "" });
  test("sortedMenu orders and renumbers", () => {
    expect(sortedMenu([item("b", 5), item("a", 2)]).map((i) => [i.type, i.order])).toEqual([["a", 0], ["b", 1]]);
  });
  test("moveItem swaps neighbours and ignores out-of-range moves", () => {
    const list = [item("a", 0), item("b", 1), item("c", 2)];
    expect(moveItem(list, 1, -1).map((i) => i.type)).toEqual(["b", "a", "c"]);
    expect(moveItem(list, 1, 1).map((i) => [i.type, i.order])).toEqual([["a", 0], ["c", 1], ["b", 2]]);
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 2, 1)).toBe(list);
  });
});

describe("drafts and history", () => {
  test("sameValue ignores key order", () => {
    expect(sameValue({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue(undefined, null)).toBe(true);
  });
  test("changeRows makes paths readable and values short", () => {
    const rows = changeRows({
      "customization.theme.radius": { from: "soft", to: "round" },
      "org.logo_image": { from: null, to: "x_logo.png" },
      "admin_toggles.live_sessions.org_disabled": { from: false, to: true },
    });
    expect(rows).toEqual([
      { path: "theme › radius", from: "soft", to: "round" },
      { path: "logo", from: "—", to: "x_logo.png" },
      { path: "live sessions › org disabled", from: "false", to: "true" },
    ]);
    expect(changeRows(null)).toEqual([]);
    expect(changeRows({ a: {}, b: {}, c: {} }, 2)).toHaveLength(2);
  });
  test("formatValue clips long values", () => {
    expect(formatValue("")).toBe("—");
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(formatValue("x".repeat(80), 10)).toBe("xxxxxxxxx…");
  });
  test("readablePath and changeCount", () => {
    expect(readablePath("customization.general.favicon_image")).toBe("general › favicon");
    expect(changeCount({ a: 1, b: 2 })).toBe(2);
    expect(changeCount(null)).toBe(0);
  });
});
