import { describe, expect, test } from "bun:test";

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(
  import.meta.dir,
  "../components/Dashboard/Pages/Course/EditCourseStructure/DraggableElements",
);

/**
 * Chrome and Edge page translation replaces a text node with a <font> wrapper it
 * inserts into the DOM. When that text node is a bare sibling of an element,
 * React's next commit tries to insert before a node that is no longer a child of
 * the container and throws NotFoundError: Failed to execute 'insertBefore'. The
 * whole dashboard page unmounts mid-edit.
 *
 * Giving every label its own element removes the hazard: the translator swaps
 * the text inside the span and React's sibling structure stays intact.
 */
describe("course structure labels are translation-safe", () => {
  const files = readdirSync(DIR).filter((name) => name.endsWith(".tsx"));

  test.each(files)("%s has no bare text sibling after an element", (name) => {
    const lines = readFileSync(join(DIR, name), "utf8").split("\n");
    const offenders = [];

    for (let i = 1; i < lines.length; i++) {
      const previous = lines[i - 1].trimEnd();
      const current = lines[i].trim();
      // Only a COMPLETED sibling element is the hazard: a self-closing tag or a
      // closing tag. A line ending in an opening tag means the text is that
      // element's only child, which the translator handles fine.
      const previousIsElement =
        previous.endsWith("/>") || /<\/[A-Za-z][\w.]*>$/.test(previous);
      const currentIsBareExpression =
        current.startsWith("{") && !current.startsWith("{/*") && !current.includes("<");

      if (previousIsElement && currentIsBareExpression && current.includes("t(")) {
        offenders.push(`${name}:${i + 1}: ${current}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
