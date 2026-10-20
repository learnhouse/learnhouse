import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const dir = new URL("../components/Objects/Modals/Activities/Create/NewActivityModal/", import.meta.url);

// Activities have no description field, so a modal that asks for one throws
// the text away and leaves nothing to edit later (#1165).
describe("activity create modals", () => {
  for (const name of ["DynamicActivityModal", "MarkdownActivityModal", "EmbedActivityModal"]) {
    test(`${name} does not ask for a description it never saves`, () => {
      const source = readFileSync(new URL(`${name}.tsx`, dir), "utf8");
      expect(source).not.toMatch(/activityDescription|Optional description/);
    });
  }
});
