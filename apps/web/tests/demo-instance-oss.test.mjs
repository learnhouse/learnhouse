// Demo instances are Enterprise Edition only. The open-source build resolves
// @ee/* to ee-stub: the banner renders nothing and the demo pages 404, and
// every module the OSS routes import from EE has a stub with the same path.

import { describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "..");

class NotFound extends Error {}
mock.module("next/navigation", () => ({ notFound: () => { throw new NotFound("NEXT_NOT_FOUND"); } }));

const IMPORTS = {
  "app/orgs/[orgslug]/layout.tsx": "components/DemoInstance/DemoInstanceBar",
  "app/auth/layout.tsx": "components/DemoInstance/DemoInstanceBar",
  "app/orgs/[orgslug]/demo-access/page.tsx": "app/demo/DemoAccessPage",
  "app/orgs/[orgslug]/demo-ended/page.tsx": "app/demo/DemoEndedPage",
  "app/admin/(dashboard)/demos/page.tsx": "components/Demos/DemosPage",
  "app/admin/(dashboard)/demos/[uuid]/page.tsx": "components/Demos/DemoDetailPage",
};

describe("demo instances in the OSS build", () => {
  test("every EE module the routes import has a stub", () => {
    for (const [route, mod] of Object.entries(IMPORTS)) {
      expect(readFileSync(join(WEB, route), "utf8")).toContain(`@ee/${mod}`);
      expect(existsSync(join(WEB, "ee-stub", `${mod}.tsx`))).toBe(true);
    }
  });

  test("the banner stub renders nothing", async () => {
    const { default: Bar } = await import("../ee-stub/components/DemoInstance/DemoInstanceBar.tsx");
    expect(Bar()).toBeNull();
  });

  test("the demo pages 404 without EE", async () => {
    for (const mod of ["app/demo/DemoAccessPage", "app/demo/DemoEndedPage", "components/Demos/DemosPage", "components/Demos/DemoDetailPage"]) {
      const { default: Page } = await import(`../ee-stub/${mod}.tsx`);
      expect(() => Page({ demoUuid: "x" })).toThrow(NotFound);
    }
  });
});
