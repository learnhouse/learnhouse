// Funnel steps that were not measurable: opening the "new course" chooser, and
// the whole migration wizard (its courses never sent course_created).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AnalyticsEvent, featureGroupOf } from "../services/analytics/events.ts";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("course creation analytics", () => {
  test("events are registered with object_action names in the course group", () => {
    expect(AnalyticsEvent.CourseCreateModalOpened).toBe("course_create_modal_opened");
    expect(AnalyticsEvent.CourseMigrationOrganized).toBe("course_migration_organized");
    expect(AnalyticsEvent.CourseMigrationFailed).toBe("course_migration_failed");
    expect(featureGroupOf(AnalyticsEvent.CourseMigrationFailed)).toBe("course");
  });

  test("the chooser tracks opening once per open", () => {
    const src = read("../app/orgs/[orgslug]/dash/courses/_components/CourseCreationModals.tsx");
    expect(src).toMatch(/if \(open && !wasOpen\.current\) track\(AnalyticsEvent\.CourseCreateModalOpened/);
  });

  test("a finished migration counts as course_created", () => {
    const src = read("../app/orgs/[orgslug]/dash/courses/migrate/client.tsx");
    expect(src).toMatch(/track\(AnalyticsEvent\.CourseCreated, \{\s*creation_type: 'migrate'/);
    expect(src.match(/AnalyticsEvent\.CourseMigrationFailed/g).length).toBeGreaterThanOrEqual(3);
  });
});

describe("empty courses page", () => {
  test("shows the start options inline and hands the pick to the creation flows", () => {
    const page = read("../app/orgs/[orgslug]/dash/courses/client.tsx");
    expect(page).toContain('data-testid="courses-empty-start"');
    expect(page).toMatch(/onSelectType=\{\(type\) => setStartRequest\(\{ type, id: Date\.now\(\) \}\)\}/);
    expect(page).toContain("startRequest={startRequest}");
    const modals = read("../app/orgs/[orgslug]/dash/courses/_components/CourseCreationModals.tsx");
    expect(modals).toContain("onSelectCreation(startRequest.type, 'empty_state')");
    expect(modals).toContain("handledStart.current === startRequest.id");
  });
});
