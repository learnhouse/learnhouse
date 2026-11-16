import { describe, expect, test } from "bun:test";

import { findCourseRun, getCourseEndProgress } from "../components/Pages/Activity/courseEndProgress.ts";

const activity = (id, extra = {}) => ({ id, activity_uuid: `activity_a${id}`, name: `Lesson ${id}`, ...extra });
const course = {
  course_uuid: "course_abc",
  chapters: [
    { id: 1, name: "Intro", activities: [activity(1), activity(2)] },
    { id: 2, name: "Deep dive", activities: [activity(3), activity(4)] },
  ],
};
const trail = (steps, uuid = "abc") => ({ runs: [{ course: { course_uuid: uuid }, steps }] });
const step = (activity_id, update_date, complete = true) => ({ activity_id, complete, update_date });

describe("course-end progress", () => {
  test("finds the run with or without the course_ prefix", () => {
    expect(findCourseRun(trail([], "course_abc"), "abc")).not.toBeNull();
    expect(findCourseRun(trail([], "abc"), "course_abc")).not.toBeNull();
    expect(findCourseRun(trail([], "other"), "abc")).toBeNull();
    expect(findCourseRun(null, "abc")).toBeNull();
  });

  test("counts per chapter and points at the first unfinished activity", () => {
    const p = getCourseEndProgress(course, trail([step(1), step(2), step(4)]));
    expect(p).toMatchObject({ done: 3, total: 4, percent: 75, completed: false, completedAt: null });
    expect(p.chapters.map((c) => [c.name, c.done, c.total])).toEqual([
      ["Intro", 2, 2],
      ["Deep dive", 1, 2],
    ]);
    expect(p.next).toEqual({ name: "Lesson 3", chapterName: "Deep dive", chapterIndex: 1, activityId: "a3" });
  });

  test("ignores incomplete steps and skips drip-locked activities", () => {
    const locked = { ...course, chapters: [{ id: 1, name: "A", activities: [activity(1, { is_locked: true }), activity(2)] }] };
    const p = getCourseEndProgress(locked, trail([step(1, null, false)]));
    expect(p.done).toBe(0);
    expect(p.next?.activityId).toBe("a2");
  });

  test("no next activity when only locked ones remain", () => {
    const locked = { ...course, chapters: [{ id: 1, name: "A", activities: [activity(1), activity(2, { is_locked: true })] }] };
    expect(getCourseEndProgress(locked, trail([step(1)])).next).toBeNull();
  });

  test("completed: no next, and the date of the last finished activity", () => {
    const p = getCourseEndProgress(
      course,
      trail([step(1, "2026-11-01 10:00:00"), step(2, "2026-11-03 09:30:00.5"), step(3, "2026-11-02 08:00:00"), step(4, null)]),
    );
    expect(p.completed).toBe(true);
    expect(p.percent).toBe(100);
    expect(p.next).toBeNull();
    expect(p.completedAt?.getDate()).toBe(3);
  });

  test("no trail and no chapters", () => {
    const p = getCourseEndProgress(course, null);
    expect(p).toMatchObject({ done: 0, total: 4, percent: 0, completed: false });
    expect(p.next?.activityId).toBe("a1");
    expect(getCourseEndProgress({}, null)).toMatchObject({ done: 0, total: 0, percent: 0, completed: false, next: null });
  });
});
