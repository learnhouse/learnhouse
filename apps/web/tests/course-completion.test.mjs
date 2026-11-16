// course_completed was never sent: the activity page looked for
// run.course_uuid / step.activity_uuid, which trail payloads don't have.
// Synthetic trail shapes mirror TrailRunRead / TrailStep.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isCourseComplete, willCompleteCourse } from "../lib/courses/completion.ts";

const course = {
  course_uuid: "course_abc",
  chapters: [
    { activities: [{ id: 1 }, { id: 2 }] },
    { activities: [{ id: 3 }] },
  ],
};
const trail = (ids, uuid = "course_abc") => ({
  runs: [
    { course: { course_uuid: "course_other" }, steps: [{ activity_id: 1, complete: true }] },
    { course: { course_uuid: uuid }, steps: ids.map((id) => ({ activity_id: id, complete: true })) },
  ],
});

describe("willCompleteCourse", () => {
  test("true when the activity is the last one open, in any order", () => {
    expect(willCompleteCourse(trail([1, 3]), course, 2)).toBe(true);
    expect(willCompleteCourse(trail([2, 3]), course, 1)).toBe(true);
  });

  test("false while other activities are open", () => {
    expect(willCompleteCourse(trail([1]), course, 2)).toBe(false);
    expect(willCompleteCourse(undefined, course, 2)).toBe(false);
  });

  test("matches runs with or without the course_ prefix", () => {
    expect(willCompleteCourse(trail([1, 3], "abc"), course, 2)).toBe(true);
  });

  test("ignores incomplete steps and activities outside the course", () => {
    const t = { runs: [{ course: { course_uuid: "course_abc" }, steps: [{ activity_id: 1, complete: false }, { activity_id: 3, complete: true }] }] };
    expect(willCompleteCourse(t, course, 2)).toBe(false);
    expect(willCompleteCourse(trail([1, 2, 3]), course, 99)).toBe(false);
  });

  test("a one-activity course completes even with no run yet", () => {
    expect(willCompleteCourse({ runs: [] }, { course_uuid: "c", chapters: [{ activities: [{ id: 7 }] }] }, 7)).toBe(true);
  });
});

describe("isCourseComplete", () => {
  test("needs every activity complete", () => {
    expect(isCourseComplete(trail([1, 2, 3]), course)).toBe(true);
    expect(isCourseComplete(trail([1, 2]), course)).toBe(false);
    expect(isCourseComplete(trail([1, 2, 3]), { course_uuid: "x", chapters: [] })).toBe(false);
    expect(isCourseComplete(null, course)).toBe(false);
  });
});

describe("call sites", () => {
  test("the activity page and session completion use the shared check", () => {
    const page = readFileSync(new URL("../app/orgs/[orgslug]/(withmenu)/course/[courseuuid]/activity/[activityid]/activity.tsx", import.meta.url), "utf8");
    expect(page).toContain("willCompleteCourse(props.trailData, props.course, props.activity.id)");
    expect(page).not.toMatch(/run\.course_uuid === props\.course\.course_uuid/);
    const session = readFileSync(new URL("../components/Objects/Activities/ActivitySession/SessionCompletion.tsx", import.meta.url), "utf8");
    expect(session).toContain("AnalyticsEvent.CourseCompleted");
    expect(session).not.toContain("will_complete_course: false");
  });
});
