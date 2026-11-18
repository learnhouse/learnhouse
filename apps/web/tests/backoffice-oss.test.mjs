// LearnHouse Backoffice (the platform console) is Enterprise Edition only. The
// open-source build resolves @ee/* to ee-stub: every Backoffice page 404s,
// the support auto-entry renders nothing, and every module the OSS routes
// import from EE has a stub with the same path.

import { describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WEB = join(import.meta.dir, "..");

class NotFound extends Error {}
mock.module("next/navigation", () => ({ notFound: () => { throw new NotFound("NEXT_NOT_FOUND"); } }));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const ROUTE_FILES = walk(join(WEB, "app/backoffice")).filter((p) => p.endsWith(".tsx"));
const EE_IMPORT = /from '@ee\/(components\/Backoffice\/[^']+)'/g;

describe("Backoffice in the OSS build", () => {
  test("the routes live under /backoffice and import the console from EE only", () => {
    expect(ROUTE_FILES.length).toBeGreaterThan(20);
    for (const file of ROUTE_FILES) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toContain("@components/Admin/");
      expect(src).not.toContain("@services/ee/platform");
    }
    expect(existsSync(join(WEB, "components/Admin"))).toBe(false);
    expect(existsSync(join(WEB, "app/admin"))).toBe(false);
  });

  test("every EE module the routes import has a stub", () => {
    const mods = new Set();
    for (const file of [...ROUTE_FILES, join(WEB, "components/Providers.tsx")]) {
      for (const m of readFileSync(file, "utf8").matchAll(EE_IMPORT)) mods.add(m[1]);
    }
    expect(mods.size).toBeGreaterThan(20);
    for (const mod of mods) {
      expect(existsSync(join(WEB, "ee-stub", `${mod}.tsx`)), `${mod} has no stub`).toBe(true);
    }
  });

  test("the Backoffice pages, shell and login 404 without EE", async () => {
    const stubs = walk(join(WEB, "ee-stub/components/Backoffice")).filter(
      (p) => p.endsWith(".tsx") && !p.endsWith("ImpersonationAutoEntry.tsx"),
    );
    for (const file of stubs) {
      const { default: Page } = await import(file);
      expect(() => Page({}), relative(WEB, file)).toThrow(NotFound);
    }
  });

  test("the support auto-entry renders nothing", async () => {
    const { default: AutoEntry } = await import("../ee-stub/components/Backoffice/Impersonation/ImpersonationAutoEntry.tsx");
    expect(AutoEntry()).toBeNull();
  });
});
