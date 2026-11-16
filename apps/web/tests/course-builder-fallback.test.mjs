import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// The AI option opens the course builder (Atlas engine, EE) when EE is
// present. Community builds resolve @ee to ee-stub, whose flag is false, so
// they keep the classic AI course creator and its /ai/courseplanning API.
describe("AI course creation fallback", () => {
  test("the stub turns the course builder off", () => {
    expect(read("ee-stub/components/Atlas/CourseBuilder/availability.ts")).toMatch(/COURSE_BUILDER_AVAILABLE = false/);
    expect(read("ee-stub/components/Atlas/CourseBuilder/CourseBuilderModal.tsx")).toMatch(/return null/);
  });

  test("the courses page keeps the classic creator behind the flag", () => {
    const source = read("app/orgs/[orgslug]/dash/courses/_components/CourseCreationModals.tsx");
    expect(source).toMatch(/COURSE_BUILDER_AVAILABLE \?/);
    expect(source).toMatch(/<AICourseCreationModal/);
    expect(source).toMatch(/<CourseBuilderModal/);
  });
});
